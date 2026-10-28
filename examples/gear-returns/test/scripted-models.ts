import type {
  ActorAdapter,
  ChatMessage,
  FileEdit,
  FindingDraft,
  InterventionPlan,
  JsonValue,
  MentorAdapter,
  MentorCompletion,
  MentorCompletionRequest,
  Prediction,
  StudentAdapter,
  StudentChatRequest,
  StudentStreamEvent,
  Task,
  Usage,
} from '@architect/shared';
import { PICKUP_CAPACITY } from '../src/policy/rules';
import type { OrderQuestion } from '../src/reference/orders';
import { earliestPickup } from '../src/reference/pickups';
import { answerOrder, solvePickup, solveReturn } from '../src/reference/solver';
import type { PickupRequest, ReturnRequest } from '../src/reference/solver';
import { AgentTools } from '../src/reference/tools';
import type { Carrier } from '../src/shop/types';
import { BUSINESS_DATE, job, paramsOf } from './helpers';

/**
 * Scripted stand-ins for Glimmer and Spark on the returns desk, so mentoring runs end to end with
 * the engine's real tools, sandbox, checker, vault and loop and no model is called. The student
 * works a task the way the reference solution does, one tool call per model turn, and goes wrong
 * in the ways its habits say unless its system prompt holds what fixes them. Spark as the agent
 * carries a task on from wherever its request leaves off. Spark as the mentor answers each round
 * from its request alone, with the reply scripted for that round.
 */

/** One tool call as a solution makes it. */
export interface SolutionCall {
  name: string;
  arguments: Record<string, JsonValue>;
}

/** How a task is worked: one call per model turn, then the answer. */
export interface Solution {
  calls: SolutionCall[];
  answer: JsonValue;
  /** What the model says beside its call, by the turn's place from 0. */
  notes?: Readonly<Record<number, string>>;
}

/** A task's calls and answer, the way the reference solution works them out. */
export function solve(task: Task): Solution {
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

/** The model turn a solution writes its row on: one call per turn, the first turn 1. */
export function appendTurn(solution: Solution): number {
  return solution.calls.findIndex((call) => call.name === 'append') + 1;
}

/** How far off a scripted mistake puts an amount, in cents. */
export const WRONG_BY = 500;

/** The solution with one cell of the row it appends to `table` set to `value`. */
function withCell(
  solution: Solution,
  table: string,
  column: string,
  value: string,
): SolutionCall[] {
  const at = job.data().columns(table).indexOf(column);
  return solution.calls.map((call) => {
    if (call.name !== 'append') return call;
    const cells = String(call.arguments['text']).replace(/\n$/, '').split(',');
    cells[at] = value;
    return { ...call, arguments: { ...call.arguments, text: `${cells.join(',')}\n` } };
  });
}

/** The refund solution with the refund off by `WRONG_BY` cents, in the row and the answer. */
export function refundOff(solution: Solution): Solution {
  const answer = solution.answer as Record<string, JsonValue>;
  const refund = Number(answer['refund_cents']) + WRONG_BY;
  return {
    calls: withCell(solution, 'returns.csv', 'refund_cents', String(refund)),
    answer: { ...answer, refund_cents: refund },
  };
}

/** What the student says as it starts a booking when it reads the pickup rules without pickup_from. */
export const PICKUP_MISREADING =
  'From the policy: the earliest pickup is tomorrow, or the day after tomorrow when booked from 14:00.';

/**
 * The pickup booked as if the return's pickup_from date didn't count: the earliest day every
 * other rule allows, in the row and the answer, with the reading that leads there said on the
 * turn the booking starts. Where pickup_from doesn't decide the day, this is the right booking.
 */
export function pickupFromSkipped(solution: Solution, task: Task): Solution {
  const params = paramsOf(task);
  const full = params['full_dates'] as string[];
  const date = earliestPickup(
    {
      carrier: String(params['carrier']) as Carrier,
      today: BUSINESS_DATE,
      bookedAt: String(params['booked_at']),
      readyFrom: params['pickup_from'] === null ? null : String(params['pickup_from']),
      bookedOn: (day) => (full.includes(day) ? PICKUP_CAPACITY : 0),
    },
    'not_ready',
  );
  const answer = solution.answer as Record<string, JsonValue>;
  return {
    calls: withCell(solution, 'pickups.csv', 'pickup_date', date),
    answer: { ...answer, pickup_date: date },
    notes: { [solution.calls.findIndex((call) => call.name === 'run')]: PICKUP_MISREADING },
  };
}

/** One value of an answer, wrong: a list without its first id, an amount or a count off. */
function offValue(key: string, value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.length > 0 ? value.slice(1) : ['ORD-10000'];
  if (typeof value !== 'number') return value;
  if (key.endsWith('_cents')) return value >= WRONG_BY ? value - WRONG_BY : value + WRONG_BY;
  return value > 0 ? value - 1 : value + 1;
}

/** The order answer as it comes out when the first day of the period is left out. */
export function firstDayLeftOut(solution: Solution): Solution {
  const answer = solution.answer as Record<string, JsonValue>;
  const [key] = Object.keys(answer);
  if (key === undefined) return solution;
  return { ...solution, answer: { ...answer, [key]: offValue(key, answer[key] ?? null) } };
}

/** A way the scripted student goes wrong on one task type, and what in its system prompt changes it. */
export interface Habit {
  type: string;
  /** It gets the type right only when its system prompt holds this text. */
  fixedBy?: string;
  /** It gets the type wrong whenever its system prompt holds this text. */
  brokenBy?: string;
  /** The wrong attempt: the right solution, changed where the student goes wrong. */
  mistake(solution: Solution, task: Task): Solution;
}

function goesWrong(habit: Habit, system: string): boolean {
  if (habit.brokenBy !== undefined && system.includes(habit.brokenBy)) return true;
  return habit.fixedBy !== undefined && !system.includes(habit.fixedBy);
}

/** How long a scripted call takes on a recording's clock. */
export const STUDENT_TURN_MS = 3_000;
export const ACTOR_TURN_MS = 8_000;
export const MENTOR_REPLY_MS = 40_000;

/** Moves a recording's clock on by the time a scripted call took. */
export type Tick = (ms: number) => void;

const TURN_USAGE: Usage = { inputTokens: 400, outputTokens: 60 };

/** Plays a solution one call per model turn, then the answer, from wherever the request is. */
export async function* play(
  solution: Solution | undefined,
  messages: readonly ChatMessage[],
): AsyncGenerator<StudentStreamEvent> {
  const turn = messages.filter((message) => message.role === 'assistant').length;
  const call = solution?.calls[turn];
  if (call) {
    const note = solution?.notes?.[turn];
    if (note !== undefined) yield { type: 'text', delta: note };
    yield {
      type: 'tool_call',
      call: { id: `call_${turn}`, name: call.name, arguments: call.arguments },
    };
    yield { type: 'done', usage: TURN_USAGE, finish: 'tool_calls' };
    return;
  }
  yield { type: 'text', delta: `ANSWER: ${JSON.stringify(solution?.answer ?? {})}` };
  yield { type: 'done', usage: TURN_USAGE, finish: 'stop' };
}

/** The known task a request is about; one it doesn't know gets an empty answer. */
export function taskOf(known: readonly Task[], messages: readonly ChatMessage[]): Task | undefined {
  const user = messages.find((message) => message.role === 'user')?.content ?? '';
  return known.find((task) => user.includes(task.prompt));
}

/** Prices a usage record at Spark's rates. */
function sparkCost(usage: Usage): number {
  return (usage.inputTokens * 1.25 + usage.outputTokens * 4.25) / 1_000_000;
}

/**
 * Glimmer, scripted: it works every task it knows as the reference solution does, unless one of
 * its habits makes it go wrong under the system prompt it was given.
 */
export class ScriptedGlimmer implements StudentAdapter {
  readonly label: string = 'Glimmer';
  readonly model: string = 'muse-glimmer:30b';
  readonly baseUrl: string = 'http://127.0.0.1:11434';
  readonly isLocal: boolean = true;
  known: readonly Task[] = [];
  private readonly solutions = new Map<string, Solution>();

  constructor(
    protected readonly habits: readonly Habit[] = [],
    protected readonly tick?: Tick,
  ) {}

  solution(task: Task): Solution {
    let found = this.solutions.get(task.id);
    if (!found) this.solutions.set(task.id, (found = solve(task)));
    return found;
  }

  chat(request: StudentChatRequest): AsyncIterable<StudentStreamEvent> {
    this.tick?.(STUDENT_TURN_MS);
    const task = taskOf(this.known, request.messages);
    if (task === undefined) return play(undefined, request.messages);
    const system = request.messages[0]?.content ?? '';
    const right = this.solution(task);
    const habit = this.habits.find(
      (candidate) => candidate.type === task.type && goesWrong(candidate, system),
    );
    return play(habit ? habit.mistake(right, task) : right, request.messages);
  }

  async describe() {
    return { model: this.model };
  }
  async testConnection() {
    return { ok: true as const, latencyMs: 1, detail: 'scripted' };
  }
  async release() {}
}

/**
 * Spark as the agent: it carries a task on from wherever its request leaves off, correctly,
 * unless the conversation so far already states a wrong reading of the task, which it follows.
 */
export class ScriptedSparkAgent extends ScriptedGlimmer implements ActorAdapter {
  override readonly label = 'Spark';
  override readonly model = 'muse-spark-1.3';
  override readonly baseUrl = 'https://api.meta.ai/v1';
  override readonly isLocal = false;
  readonly requests: StudentChatRequest[] = [];

  override chat(request: StudentChatRequest): AsyncIterable<StudentStreamEvent> {
    this.requests.push(request);
    this.tick?.(ACTOR_TURN_MS);
    const task = taskOf(this.known, request.messages);
    if (task === undefined) return play(undefined, request.messages);
    return play(this.carriedOn(task, request.messages), request.messages);
  }

  /** The right solution, or a habit's mistake whose words the conversation already holds. */
  private carriedOn(task: Task, messages: readonly ChatMessage[]): Solution {
    const said = messages
      .flatMap((message) => (message.role === 'assistant' ? [message.content] : []))
      .join('\n');
    const right = this.solution(task);
    for (const habit of this.habits) {
      if (habit.type !== task.type) continue;
      const wrong = habit.mistake(right, task);
      if (Object.values(wrong.notes ?? {}).some((note) => said.includes(note))) return wrong;
    }
    return right;
  }

  estimateCostUsd(usage: Usage): number {
    return sparkCost(usage);
  }
}

/** A diagnosis reply as the mentor writes it, with findings and one intervention. */
export interface Diagnosis {
  title: string;
  diagnosis: string;
  causeTaskIds: string[];
  edits: FileEdit[];
  predicted: Prediction;
  readyClaim: boolean;
  findings: FindingDraft[];
  intervention: InterventionPlan;
}

/** A round's reply, written from the request the mentor was sent. */
export type RoundReply = (request: MentorCompletionRequest) => Diagnosis;

const MENTOR_USAGE: Usage = { inputTokens: 3000, outputTokens: 800 };

/**
 * Spark as the mentor: the reply scripted for each round's diagnosis, by the round's number. A
 * request to fix a reply the runner refused gets the same round's reply again.
 */
export class ScriptedSpark implements MentorAdapter {
  readonly kind = 'model' as const;
  readonly label = 'Spark';
  readonly model = 'muse-spark-1.3';
  readonly provider = 'meta';
  readonly requests: MentorCompletionRequest[] = [];
  readonly replies = new Map<number, RoundReply>();

  constructor(private readonly tick?: Tick) {}

  async complete(request: MentorCompletionRequest): Promise<MentorCompletion> {
    this.requests.push(request);
    const round = request.json?.name === 'diagnosis' ? roundOf(request) : undefined;
    const reply = round === undefined ? undefined : this.replies.get(round);
    if (reply === undefined) {
      const what =
        round === undefined ? (request.json?.name ?? 'a text request') : `round ${round}`;
      throw new Error(`No reply was scripted for ${what}.`);
    }
    this.tick?.(MENTOR_REPLY_MS);
    const json = reply(request);
    return {
      text: JSON.stringify(json),
      json,
      usage: MENTOR_USAGE,
      costUsd: this.estimateCostUsd(MENTOR_USAGE),
      model: this.model,
      latencyMs: MENTOR_REPLY_MS,
    };
  }

  estimateCostUsd(usage: Usage): number {
    return sparkCost(usage);
  }

  async testConnection() {
    return { ok: true as const, latencyMs: 1, detail: 'scripted' };
  }
}

/** The round's view as the mentor reads it: the first user message of its request. */
function viewOf(request: MentorCompletionRequest): string {
  return request.messages.find((message) => message.role === 'user')?.content ?? '';
}

/** The round a diagnosis request is for, from its view's heading. */
export function roundOf(request: MentorCompletionRequest): number | undefined {
  const match = /^# Round (\d+)$/m.exec(viewOf(request));
  return match ? Number(match[1]) : undefined;
}

/** One train attempt of the round, as the mentor's view shows it. */
export interface ShownAttempt {
  taskId: string;
  taskType: string;
  pass: boolean;
  /** Its section of the view: the checker's reason, the request, what was expected, the trace. */
  text: string;
}

const ATTEMPT_HEADING = /^## (\S+) \(([a-z0-9_-]+)\): (PASS|FAIL)$/;

/** The round's train attempts, in the order the view shows them. */
export function shownAttempts(request: MentorCompletionRequest): ShownAttempt[] {
  const lines = viewOf(request).split('\n');
  const start = lines.findIndex((line) => line.startsWith('# Train attempts this round'));
  const attempts: ShownAttempt[] = [];
  let open: { heading: RegExpExecArray; body: string[] } | undefined;
  const close = () => {
    if (open === undefined) return;
    const [, taskId = '', taskType = '', verdict] = open.heading;
    attempts.push({ taskId, taskType, pass: verdict === 'PASS', text: open.body.join('\n') });
    open = undefined;
  };
  for (const line of lines.slice(Math.max(0, start + 1))) {
    const heading = ATTEMPT_HEADING.exec(line);
    if (heading !== null || /^#{1,2} /.test(line)) {
      close();
      if (heading === null) continue;
      open = { heading, body: [] };
    } else {
      open?.body.push(line);
    }
  }
  close();
  return attempts;
}

/** The round's failed train attempts of one task type, by task id. */
export function failedOfType(request: MentorCompletionRequest, type: string): ShownAttempt[] {
  return shownAttempts(request)
    .filter((attempt) => !attempt.pass && attempt.taskType === type)
    .sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));
}

/** The round's failed train attempt of a type at a place in task id order. */
export function failedAt(request: MentorCompletionRequest, type: string, at: number): ShownAttempt {
  const failed = failedOfType(request, type);
  const attempt = failed[at];
  if (attempt === undefined) {
    throw new Error(
      `Round ${roundOf(request) ?? '?'} shows ${failed.length} failed ${type} attempts, not ${at + 1}.`,
    );
  }
  return attempt;
}

/**
 * The first model turn of a shown attempt with a trace line that matches, as the trace numbers
 * it; `matches` sees the line after its turn number, such as `call append {...}`.
 */
export function turnOf(
  attempt: ShownAttempt,
  what: string,
  matches: (line: string) => boolean,
): number {
  for (const match of attempt.text.matchAll(/^\[turn (\d+)\] (.*)$/gm)) {
    if (matches(match[2] ?? '')) return Number(match[1]);
  }
  throw new Error(`The trace of ${attempt.taskId} shows no turn where ${what}.`);
}

/** The turn a shown attempt wrote its row on. */
export function appendTurnOf(attempt: ShownAttempt): number {
  return turnOf(attempt, 'it appends a row', (line) => line.startsWith('call append '));
}

/** A file of the current harness, exactly as the view shows it. */
export function harnessFileOf(request: MentorCompletionRequest, path: string): string {
  const lines = viewOf(request).split('\n');
  const start = lines.indexOf('# Current harness');
  const heading = lines.indexOf(`## ${path}`, start);
  const fence = lines[heading + 1];
  if (start < 0 || heading < 0 || fence === undefined || !/^`{3,}$/.test(fence)) {
    throw new Error(`The view shows no ${path} in the current harness.`);
  }
  const end = lines.indexOf(fence, heading + 2);
  if (end < 0) throw new Error(`The view's ${path} doesn't end.`);
  return lines.slice(heading + 2, end).join('\n');
}

/** The id of the job's category with this slug, as the view lists them, or '' for a new one. */
export function categoryIdOf(request: MentorCompletionRequest, slug: string): string {
  const listed = new RegExp(`^- (cat_[a-z0-9]+): ${slug} \\(`, 'm').exec(viewOf(request));
  return listed?.[1] ?? '';
}

/** What a scripted refund procedure adds to AGENTS.md; the student gets refunds right once it's there. */
export const REFUND_RULE =
  'Refunds: work out item_cents from the order line (the quantity times the unit_price paid, never the list price), then take off the fees and add any shipping refund in the order the policy gives before you write the row.';

/** The student's refund habit: the amount is off until AGENTS.md holds the refund rule. */
export const REFUND_HABIT: Habit = { type: 'refund', fixedBy: REFUND_RULE, mistake: refundOff };

/** AGENTS.md as the view shows it, with a paragraph added at the end. */
export function agentsWith(request: MentorCompletionRequest, paragraph: string): FileEdit {
  const current = harnessFileOf(request, 'AGENTS.md').trimEnd();
  return { op: 'write', path: 'AGENTS.md', content: `${current}\n\n${paragraph}\n` };
}

/**
 * The refund round: one finding on a failed train refund at the turn it wrote its row, and a
 * procedure that adds the refund rule, taught with the verified repair as a worked example and
 * one related practice case.
 */
export function refundProcedure(
  request: MentorCompletionRequest,
  finding: { taskId: string; failureTurn: number },
): Diagnosis {
  const { taskId, failureTurn } = finding;
  return {
    title: 'Work out the refund from the policy',
    diagnosis: 'The agent wrote the refund before applying the policy to the price.',
    causeTaskIds: [taskId],
    edits: [agentsWith(request, REFUND_RULE)],
    predicted: { devDeltaMin: 2, devDeltaMax: 4, rationale: 'Every refund turns on it.' },
    readyClaim: false,
    findings: [
      {
        taskId,
        failureTurn,
        evidence: [{ turn: failureTurn, note: 'The row it appended has the wrong refund_cents.' }],
        cause: 'It never applied the refund rule to the price paid.',
        category: {
          id: categoryIdOf(request, 'refund-amount'),
          slug: 'refund-amount',
          label: 'Refund amount',
        },
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
}
