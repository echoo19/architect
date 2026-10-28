import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEngineDeps,
  DataPaths,
  JobLibrary,
  openEngineStore,
  RunController,
  type EngineHostDeps,
  type EngineStore,
} from '@architect/engine';
import type {
  ActorAdapter,
  ChatMessage,
  JsonValue,
  MentorAdapter,
  MentorCompletion,
  MentorCompletionRequest,
  StudentChatRequest,
  StudentStreamEvent,
  Task,
  Usage,
} from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerOrder, solvePickup, solveReturn } from '../src/reference/solver';
import type { OrderQuestion } from '../src/reference/orders';
import type { PickupRequest, ReturnRequest } from '../src/reference/solver';
import { AgentTools } from '../src/reference/tools';
import { BUSINESS_DATE, job, paramsOf } from './helpers';

/**
 * One whole chain of failure-specific mentoring on the returns desk, with the engine's real
 * tools, sandbox, checker, vault and loop, and scripted models in place of Glimmer and Spark: a
 * recorded failure, a finding that names its turn, a correction replayed from that turn and
 * verified by the checker, the lesson kept, a procedure that uses it, a paired dev measurement,
 * the experiment record, and a related practice case verified on its own. No model is called.
 */

/** What the procedure adds; the scripted student gets refunds right once its harness says it. */
const RULE =
  'Refunds: the refund is the list price times the quantity, less any fee the policy names.';
const WRONG_BY = 500;

interface Solution {
  calls: { name: string; arguments: Record<string, JsonValue> }[];
  answer: JsonValue;
}

/** A task's calls and answer, the way the reference solution works them out. */
function solve(task: Task): Solution {
  const tools = new AgentTools(job.data());
  let answer: JsonValue;
  if (task.type === 'refund') {
    const request = task.meta?.request as unknown as ReturnRequest;
    const { decision, refund_cents, refund_to } = solveReturn(tools, request, BUSINESS_DATE).result;
    answer = { decision, refund_cents, refund_to };
  } else if (task.type === 'pickup') {
    const request = task.meta?.request as unknown as PickupRequest;
    const { carrier, pickup_date } = solvePickup(tools, request, BUSINESS_DATE).result;
    answer = { pickup_id: String(paramsOf(task).pickup_id), carrier, pickup_date };
  } else {
    answer = answerOrder(tools, task.meta?.question as unknown as OrderQuestion).result;
  }
  return {
    calls: tools.calls.map(({ name, arguments: args }) => ({ name, arguments: args })),
    answer,
  };
}

/** The refund solution with the refund off by `WRONG_BY` cents, in the row and the answer. */
function mistaken(solution: Solution): Solution {
  const columns = job.data().columns('returns.csv');
  const at = columns.indexOf('refund_cents');
  const calls = solution.calls.map((call) => {
    if (call.name !== 'append') return call;
    const cells = String(call.arguments['text']).replace(/\n$/, '').split(',');
    cells[at] = String(Number(cells[at]) + WRONG_BY);
    return { ...call, arguments: { ...call.arguments, text: `${cells.join(',')}\n` } };
  });
  const answer = solution.answer as Record<string, JsonValue>;
  return { calls, answer: { ...answer, refund_cents: Number(answer['refund_cents']) + WRONG_BY } };
}

/** The model turn a solution writes its row on: one call per turn, the first turn 1. */
function appendTurn(solution: Solution): number {
  return solution.calls.findIndex((call) => call.name === 'append') + 1;
}

const USAGE: Usage = { inputTokens: 400, outputTokens: 60 };

/** Plays a solution one call per model turn, then the answer, from wherever the request is. */
async function* play(
  solution: Solution | undefined,
  messages: readonly ChatMessage[],
): AsyncGenerator<StudentStreamEvent> {
  const turn = messages.filter((message) => message.role === 'assistant').length;
  const call = solution?.calls[turn];
  if (call) {
    yield {
      type: 'tool_call',
      call: { id: `call_${turn}`, name: call.name, arguments: call.arguments },
    };
    yield { type: 'done', usage: USAGE, finish: 'tool_calls' };
    return;
  }
  yield { type: 'text', delta: `ANSWER: ${JSON.stringify(solution?.answer ?? {})}` };
  yield { type: 'done', usage: USAGE, finish: 'stop' };
}

/** The train or dev task a request is about; a locked test task is one it doesn't know. */
function taskOf(known: readonly Task[], messages: readonly ChatMessage[]): Task | undefined {
  const user = messages.find((message) => message.role === 'user')?.content ?? '';
  return known.find((task) => user.includes(task.prompt));
}

class ScriptedGlimmer {
  readonly label: string = 'Glimmer';
  readonly model: string = 'muse-glimmer:30b';
  readonly baseUrl: string = 'http://127.0.0.1:11434';
  readonly isLocal: boolean = true;
  known: Task[] = [];
  private readonly solutions = new Map<string, Solution>();

  solution(task: Task): Solution {
    let found = this.solutions.get(task.id);
    if (!found) this.solutions.set(task.id, (found = solve(task)));
    return found;
  }

  chat(request: StudentChatRequest): AsyncIterable<StudentStreamEvent> {
    const task = taskOf(this.known, request.messages);
    const system = request.messages[0]?.content ?? '';
    const right = task === undefined ? undefined : this.solution(task);
    const wrong = task?.type === 'refund' && !system.includes(RULE);
    return play(wrong && right ? mistaken(right) : right, request.messages);
  }

  async describe() {
    return { model: this.model };
  }
  async testConnection() {
    return { ok: true as const, latencyMs: 1, detail: 'scripted' };
  }
  async release() {}
}

/** Spark as the agent: it carries a task on from wherever its request leaves off, correctly. */
class ScriptedSparkAgent extends ScriptedGlimmer implements ActorAdapter {
  override readonly label = 'Spark';
  override readonly model = 'muse-spark-1.3';
  override readonly baseUrl = 'https://api.meta.ai/v1';
  override readonly isLocal = false;
  readonly requests: StudentChatRequest[] = [];

  override chat(request: StudentChatRequest): AsyncIterable<StudentStreamEvent> {
    this.requests.push(request);
    const task = taskOf(this.known, request.messages);
    return play(task === undefined ? undefined : this.solution(task), request.messages);
  }

  estimateCostUsd(usage: Usage): number {
    return (usage.inputTokens * 1.25 + usage.outputTokens * 4.25) / 1_000_000;
  }
}

/** Spark as the mentor: one diagnosis naming the first failed refund at the turn it wrote its row. */
class ScriptedSpark implements MentorAdapter {
  readonly kind = 'model' as const;
  readonly label = 'Spark';
  readonly model = 'muse-spark-1.3';
  readonly provider = 'meta';
  readonly requests: MentorCompletionRequest[] = [];
  finding: { taskId: string; failureTurn: number } | undefined;

  async complete(request: MentorCompletionRequest): Promise<MentorCompletion> {
    this.requests.push(request);
    if (request.json?.name !== 'diagnosis' || !this.finding) {
      throw new Error(`No reply was scripted for ${request.json?.name ?? 'a text request'}.`);
    }
    const { taskId, failureTurn } = this.finding;
    const json = {
      title: 'Work out the refund from the policy',
      diagnosis: 'The agent wrote the refund before applying the policy to the price.',
      causeTaskIds: [taskId],
      edits: [
        { op: 'write', path: 'AGENTS.md', content: `You are the Returns desk agent.\n\n${RULE}\n` },
      ],
      predicted: { devDeltaMin: 2, devDeltaMax: 4, rationale: 'Every dev refund turns on it.' },
      readyClaim: false,
      findings: [
        {
          taskId,
          failureTurn,
          evidence: [
            { turn: failureTurn, note: 'The row it appended has the wrong refund_cents.' },
          ],
          cause: 'It never applied the refund rule to the list price.',
          category: { id: '', slug: 'refund-amount', label: 'Refund amount' },
          taskType: 'refund',
        },
      ],
      intervention: {
        type: 'procedure',
        hypothesis: 'A written refund rule, with a worked example, fixes the amount.',
        workedExamples: ['refund'],
        practicePerFinding: 1,
        question: '',
        estimatedCost: { mentorUsd: 0.5, computeUsd: 0, minutes: 5 },
        verificationPlan: 'Replay from the turn that wrote the row; the checker grades the row.',
      },
    };
    const usage = { inputTokens: 3000, outputTokens: 800 };
    return {
      text: JSON.stringify(json),
      json,
      usage,
      costUsd: this.estimateCostUsd(usage),
      model: this.model,
      latencyMs: 5,
    };
  }

  estimateCostUsd(usage: Usage): number {
    return (usage.inputTokens * 1.25 + usage.outputTokens * 4.25) / 1_000_000;
  }

  async testConnection() {
    return { ok: true as const, latencyMs: 1, detail: 'scripted' };
  }
}

let root: string;
let store: EngineStore;
let controller: RunController;
let jobs: JobLibrary;
const glimmer = new ScriptedGlimmer();
const agent = new ScriptedSparkAgent();
const spark = new ScriptedSpark();

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gear-returns-chain-'));
  const source = join(root, 'source');
  cpSync(job.dir, source, { recursive: true });
  const file = join(source, 'job.json');
  const definition = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeFileSync(
    file,
    JSON.stringify({
      ...definition,
      // A smaller panel than the shipped job's, and a template start so round 1 diagnoses.
      splits: { seed: 20261124, calibration: 0, train: 6, dev: 9, test: 6 },
      evaluation: {
        trainBatch: 6,
        minDevGain: 2,
        maxTypeRegression: 1,
        devRepeats: 1,
        patience: 4,
      },
      budget: { maxRounds: 1, maxMentorUsd: 5, maxWallMinutes: 60 },
      startingHarness: { kind: 'template', template: 'ops-analyst' },
    }),
  );
  const dataDir = join(root, 'data');
  mkdirSync(dataDir, { recursive: true });
  const real = createEngineDeps({ dataDir, getSecret: async () => 'not-a-real-key' });
  const deps: EngineHostDeps = {
    ...real,
    adapters: {
      ...real.adapters,
      createMentor: () => spark,
      createStudent: () => glimmer,
      createActor: () => agent,
    },
  };
  const paths = new DataPaths(dataDir);
  store = openEngineStore(paths.database);
  const clock = { now: () => Date.now(), timeout: (ms: number) => AbortSignal.timeout(ms) };
  jobs = new JobLibrary(store, paths, deps, clock);
  controller = new RunController({ store, paths, jobs, deps, clock });
  const imported = await jobs.importFile(file);
  // The scripted models know the train and dev tasks the runner shows; never the locked test.
  const known = [
    ...(await jobs.tasks(imported.id, 'train')),
    ...(await jobs.tasks(imported.id, 'dev')),
  ];
  glimmer.known = known;
  agent.known = known;
}, 120_000);

afterAll(async () => {
  await controller.close();
  store.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('failure-specific mentoring on the returns desk', () => {
  it('goes from a recorded failure to a kept procedure through verified lessons', async () => {
    const train = await jobs.tasks('sample-gear-returns', 'train');
    const refunds = train.filter((task) => task.type === 'refund');
    expect(refunds.length).toBeGreaterThanOrEqual(2);
    const [first] = refunds;
    if (!first) throw new Error('No train refund.');
    const turn = appendTurn(glimmer.solution(first));
    expect(turn).toBeGreaterThan(1);
    spark.finding = { taskId: first.id, failureTurn: turn };

    const run = await controller.start('sample-gear-returns', 'architect', 11);
    await controller.idle();
    const record = store.runs.get(run.id);
    expect(record?.run.error).toBeUndefined();

    // The recorded failure: the train attempt the finding names, graded by the real checker.
    const failed = store.attempts
      .list({ runId: run.id, split: 'train' })
      .find((attempt) => attempt.taskId === first.id);
    expect(failed?.check.pass).toBe(false);

    // The finding names that attempt and its turn.
    const [intervention] = store.interventions.list(run.id);
    expect(intervention?.findings).toEqual([
      expect.objectContaining({ attemptId: failed?.id, taskId: first.id, failureTurn: turn }),
    ]);

    // The correction replayed every call before that turn and passed the checker and the audit.
    const lessons = store.lessons.list({ runId: run.id });
    const repair = lessons.find((lesson) => lesson.kind === 'replay_correction');
    expect(repair).toMatchObject({
      status: 'verified',
      checkpoint: { turn, replayedCalls: turn - 1, fallback: 'none' },
      check: { pass: true },
      audit: { ok: true },
    });
    expect(repair?.episode).not.toBeNull();

    // Related practice: another train refund of another family, demonstrated whole and verified.
    const practice = lessons.find((lesson) => lesson.kind === 'practice');
    expect(practice).toMatchObject({
      status: 'verified',
      taskType: 'refund',
      check: { pass: true },
    });
    const practiced = train.find(
      (task) => practice?.source.kind === 'practice' && task.id === practice.source.taskId,
    );
    expect(practiced?.id).not.toBe(first.id);
    expect(practiced?.family).not.toBe(first.family);

    // Spark as the agent saw the task and the replayed prefix, never an expected value.
    const asked = JSON.stringify(agent.requests);
    expect(agent.requests.length).toBeGreaterThan(0);
    expect(asked).not.toContain('return_recorded');
    expect(asked).not.toContain('"expected"');

    // The procedure used the lesson: the rule and a worked example from it.
    const round = store.rounds.get(run.id, 1)?.round;
    expect(round?.decision).toBe('kept');
    const [experiment] = store.experiments.list(run.id);
    expect(experiment).toMatchObject({
      kind: 'harness',
      disposition: 'kept',
      inputs: { lessonIds: expect.arrayContaining([repair?.id]) },
    });
    // A paired dev measurement: incumbent and candidate on the same seeds.
    const incumbent = experiment?.measurements.find((item) => item.label === 'incumbent');
    const candidate = experiment?.measurements.find((item) => item.label === 'candidate');
    expect(incumbent?.seeds).toEqual(candidate?.seeds);
    expect(candidate?.score.pass ?? 0).toBeGreaterThan(incumbent?.score.pass ?? 0);
    expect(experiment?.budget.mentorUsd).toBeGreaterThan(0);
  }, 300_000);
});
