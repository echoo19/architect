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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { job } from './helpers';
import {
  appendTurn,
  REFUND_HABIT,
  refundProcedure,
  ScriptedGlimmer,
  ScriptedSpark,
  ScriptedSparkAgent,
} from './scripted-models';

/**
 * One whole chain of failure-specific mentoring on the returns desk, with the engine's real
 * tools, sandbox, checker, vault and loop, and scripted models in place of Glimmer and Spark: a
 * recorded failure, a finding that names its turn, a correction replayed from that turn and
 * verified by the checker, the lesson kept, a procedure that uses it, a paired dev measurement,
 * the experiment record, and a related practice case verified on its own. No model is called.
 * The scripted student gets refunds wrong until its harness holds the refund rule.
 */

let root: string;
let store: EngineStore;
let controller: RunController;
let jobs: JobLibrary;
const glimmer = new ScriptedGlimmer([REFUND_HABIT]);
const agent = new ScriptedSparkAgent([REFUND_HABIT]);
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
    spark.replies.set(1, (request) =>
      refundProcedure(request, { taskId: first.id, failureTurn: turn }),
    );

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
