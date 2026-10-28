import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEngineDeps,
  DataPaths,
  JobLibrary,
  openEngineStore,
  RunController,
  type Clock,
  type EngineHostDeps,
  type EngineStore,
  type RuntimeMeter,
} from '@architect/engine';
import {
  EpisodeKindSchema,
  ExperimentDispositionSchema,
  InterventionTypeSchema,
  ScoreSchema,
  StopReasonRunSchema,
  TypeScoreSchema,
  type ExperimentDisposition,
  type FindingDraft,
  type MentorCompletionRequest,
  type RunEvent,
} from '@architect/shared';
import { z } from 'zod';
import { job } from './helpers';
import {
  agentsWith,
  appendTurnOf,
  categoryIdOf,
  failedAt,
  firstDayLeftOut,
  harnessFileOf,
  PICKUP_MISREADING,
  pickupFromSkipped,
  REFUND_HABIT,
  refundProcedure,
  ScriptedGlimmer,
  ScriptedSpark,
  ScriptedSparkAgent,
  turnOf,
  type Diagnosis,
  type Habit,
  type RoundReply,
  type ShownAttempt,
} from './scripted-models';

/**
 * One Architect run on the returns desk, recorded with the real engine and scripted models, for
 * the evidence screens, their hidden e2e specs and their screenshots. The data folder is laid out
 * as the desktop app lays out its own, so the app's engine can open it as its user data. Every
 * record comes from the real loop: five rounds (kept, rejected, reverted, invalid, and stopped by
 * the wall clock), the locked test of the kept version, and Spark as a reference on dev. Time
 * runs on a clock the recording moves as the scripted models take their turns, so two recordings
 * give the same numbers; only ids differ.
 */

/** When the recording's clock starts. */
const START = Date.UTC(2026, 10, 24, 14, 0, 0);
/** The run's seed. */
export const RECORDED_SEED = 20261124;
/**
 * The wall-clock budget: rounds 1 to 4 and round 5 up to its first verified correction take
 * about 42 minutes on the recording's clock, which leaves round 5's estimate room to be taken.
 */
const WALL_MINUTES = 45;
/** How far past the budget the clock is when round 5's first correction is verified. */
const OVERRUN_MS = 30_000;
/** The round the wall clock ends, between its corrections. */
const LAST_ROUND = 5;
/** Spark's dollar cap as a reference on dev, disclosed before it starts. */
export const REFERENCE_CAP_USD = 0.25;
/** The summary's file, at the root of the data folder. */
export const SUMMARY_FILE = 'recorded-run.json';
/** How the five rounds end, in order. */
export const SCENARIO: readonly ExperimentDisposition[] = [
  'kept',
  'rejected',
  'reverted',
  'invalid',
  'stopped',
];
/** The scripted models take no key; the job's mentor still names the one it would use. */
const NO_KEY = 'scripted-models-take-no-key';

/**
 * The shipped job with a smaller panel, so it records in seconds, and a template start, so round
 * 1 diagnoses. Under the split's seed, the 12 train tasks are 4 of each type, all of them every
 * round's batch: 4 refunds fail before round 1 (one to repair, one to practice), and 4 pickups
 * fail in every round, a new one for each of rounds 2, 3 and 5 and one left for round 5's
 * practice. The 9 dev tasks are 3 of each type: round 1 gains the 3 refunds, and round 2 fixes
 * the 2 pickups that fail but loses the 3 order questions, so dev falls. The 6 test tasks are 2
 * of each type.
 */
function recordedJob(definition: Record<string, unknown>): Record<string, unknown> {
  return {
    ...definition,
    splits: { seed: 20261124, calibration: 0, train: 12, dev: 9, test: 6 },
    evaluation: {
      trainBatch: 12,
      minDevGain: 2,
      maxTypeRegression: 1,
      devRepeats: 1,
      patience: 4,
    },
    budget: { maxRounds: 8, maxMentorUsd: 5, maxWallMinutes: WALL_MINUTES },
    startingHarness: { kind: 'template', template: 'ops-analyst' },
  };
}

/** The pickup rule; the student books from pickup_from once its system prompt holds it. */
const PICKUP_RULE = "Never book a pickup before the return's pickup_from date in returns.csv.";
/** A line of round 2's skill that the policy contradicts: a period counts its first day. */
const DATE_RANGE_RULE = 'A date range starts on the day after the date it names.';

/**
 * How the scripted student goes wrong: refunds until AGENTS.md holds the refund rule, pickups
 * until its system prompt holds the pickup rule, and order questions whenever it holds the
 * date-range line.
 */
const HABITS: readonly Habit[] = [
  REFUND_HABIT,
  { type: 'pickup', fixedBy: PICKUP_RULE, mistake: pickupFromSkipped },
  { type: 'order', brokenBy: DATE_RANGE_RULE, mistake: firstDayLeftOut },
];

const DATES_SKILL = `---
name: pickup-dates
description: The first day a pickup can go, and how to count the days of a date range.
---
1. Read the return's row in returns.csv. ${PICKUP_RULE}
2. Booked before 14:00, the first possible day is tomorrow; booked from 14:00, the day after tomorrow.
3. Skip days the carrier doesn't pick up, Thanksgiving (2026-11-26), and days that already have 3 pickups in pickups.csv.
4. ${DATE_RANGE_RULE}
`;

/** Round 2's rule: the dates skill for pickups and for every request that names a day. */
const DATES_RULE = [
  '  - when_any:',
  '      - pickup',
  '      - november',
  '    load_skills:',
  '      - pickup-dates',
].join('\n');

/** retrieval.yaml as the view shows it, with one more rule at the end of its list. */
function withRule(current: string, rule: string): string {
  const text = current.trimEnd();
  const empty = 'rules: []';
  const listed = text.endsWith(empty) ? text.slice(0, -' []'.length) : text;
  return `${listed}\n${rule}\n`;
}

const PICKUP_DAYS_MANIFEST = `${JSON.stringify(
  {
    name: 'pickup_days',
    description: 'The weekdays a carrier picks up returns, as the policy lists them.',
    parameters: {
      type: 'object',
      properties: {
        carrier: {
          type: 'string',
          description: 'Cedarline Parcel, Kettlepoint Courier or Basalt Freight.',
        },
      },
      required: ['carrier'],
    },
  },
  null,
  2,
)}\n`;

const PICKUP_DAYS_CODE = `function run(args, ctx) {
  const days = {
    'Cedarline Parcel': ['Mon', 'Tue', 'Thu', 'Fri'],
    'Kettlepoint Courier': ['Mon', 'Wed', 'Fri', 'Sat'],
    'Basalt Freight': ['Tue', 'Thu'],
  };
  return { carrier: args.carrier, days: days[args.carrier] || [] };
}
`;

const PICKUP_PROCEDURE = `Pickups: ${PICKUP_RULE} Booked before 14:00, the first possible day is tomorrow, and from 14:00 the day after; then take the carrier's first pickup day that isn't Thanksgiving and has fewer than 3 pickups.`;

const PICKUP_DATE = { slug: 'pickup-date', label: 'Pickup date' };
const READY_DATE = { slug: 'pickup-ready-date', label: 'Ready date' };

function category(request: MentorCompletionRequest, named: { slug: string; label: string }) {
  return { id: categoryIdOf(request, named.slug), ...named };
}

/** A finding at the turn a pickup attempt wrote its row. */
function bookedTooSoon(
  request: MentorCompletionRequest,
  attempt: ShownAttempt,
  named: { slug: string; label: string },
): FindingDraft {
  const turn = appendTurnOf(attempt);
  return {
    taskId: attempt.taskId,
    failureTurn: turn,
    evidence: [
      { turn, note: 'The row it appended books the pickup before the return can be handed over.' },
    ],
    cause: "It booked the carrier's earliest day and never read the return's pickup_from date.",
    category: category(request, named),
    taskType: 'pickup',
  };
}

/** A finding at the turn a pickup attempt summed up the rules without pickup_from. */
function rulesMisread(
  request: MentorCompletionRequest,
  attempt: ShownAttempt,
  named: { slug: string; label: string },
): FindingDraft {
  const turn = turnOf(
    attempt,
    'it sums up the pickup rules',
    (line) => line === `model: ${PICKUP_MISREADING}`,
  );
  return {
    taskId: attempt.taskId,
    failureTurn: turn,
    evidence: [
      { turn, note: "It sums up the pickup rules without the return's pickup_from date." },
      { turn: appendTurnOf(attempt), note: 'The row it appended follows that summary.' },
    ],
    cause: 'It booked from its own summary of the pickup rules, which leaves out pickup_from.',
    category: category(request, named),
    taskType: 'pickup',
  };
}

/** Round 1, kept: the refund rule as a procedure, from a repair and a practice case. */
function refundRound(request: MentorCompletionRequest): Diagnosis {
  const refund = failedAt(request, 'refund', 0);
  return refundProcedure(request, { taskId: refund.taskId, failureTurn: appendTurnOf(refund) });
}

/**
 * Round 2, rejected: a dates skill and a rule that loads it for every request naming a day. It
 * fixes pickups, but its date-range line breaks order questions.
 */
function datesSkillRound(request: MentorCompletionRequest): Diagnosis {
  const pickup = failedAt(request, 'pickup', 0);
  return {
    title: 'Load a dates skill for pickups',
    diagnosis:
      'Pickups go out on the wrong day: the agent counts from the day of the request instead of from the dates the records give.',
    causeTaskIds: [pickup.taskId],
    edits: [
      { op: 'write', path: 'skills/pickup-dates/SKILL.md', content: DATES_SKILL },
      {
        op: 'write',
        path: 'retrieval.yaml',
        content: withRule(harnessFileOf(request, 'retrieval.yaml'), DATES_RULE),
      },
    ],
    predicted: {
      devDeltaMin: 1,
      devDeltaMax: 3,
      rationale: 'Every pickup turns on its first possible day.',
    },
    readyClaim: false,
    findings: [bookedTooSoon(request, pickup, PICKUP_DATE)],
    intervention: {
      type: 'retrieval',
      hypothesis:
        'A dates skill, loaded for every request that names a day, keeps the agent counting from the right one.',
      workedExamples: ['pickup'],
      practicePerFinding: 0,
      question: '',
      estimatedCost: { mentorUsd: 0.5, computeUsd: 0, minutes: 6 },
      verificationPlan: 'Replay from the turn that wrote the row; the checker grades the booking.',
    },
  };
}

/** Round 3, reverted: a helper the student never needed, measured as no change. */
function helperRound(request: MentorCompletionRequest): Diagnosis {
  const pickup = failedAt(request, 'pickup', 1);
  return {
    title: 'Give the agent a pickup days helper',
    diagnosis:
      "The agent sums up the pickup rules on its second turn, before it has the return's row, and books from that summary.",
    causeTaskIds: [pickup.taskId],
    edits: [
      { op: 'write', path: 'tools/pickup_days.json', content: PICKUP_DAYS_MANIFEST },
      { op: 'write', path: 'tools/pickup_days.js', content: PICKUP_DAYS_CODE },
    ],
    predicted: {
      devDeltaMin: 0,
      devDeltaMax: 2,
      rationale: 'With fewer rules to hold at once, the agent reads the return before it books.',
    },
    readyClaim: false,
    findings: [rulesMisread(request, pickup, PICKUP_DATE)],
    intervention: {
      type: 'helper',
      hypothesis:
        "A helper that gives a carrier's pickup days leaves the agent less of the policy to keep in mind.",
      workedExamples: ['pickup'],
      practicePerFinding: 0,
      question: '',
      estimatedCost: { mentorUsd: 0.5, computeUsd: 0, minutes: 6 },
      verificationPlan:
        'Replay from the turn that summed up the rules; the checker grades the booking.',
    },
  };
}

/** Round 4, invalid: weights, which this build can't train, refused before measurement. */
function weightsRound(request: MentorCompletionRequest): Diagnosis {
  const pickup = failedAt(request, 'pickup', 2);
  return {
    title: 'Train pickup bookings into the weights',
    diagnosis:
      'Two setup changes left pickups where they were; the habit of booking too soon may need training.',
    causeTaskIds: [pickup.taskId],
    edits: [],
    predicted: {
      devDeltaMin: 1,
      devDeltaMax: 2,
      rationale: 'The verified pickup examples show the booking done right.',
    },
    readyClaim: false,
    findings: [bookedTooSoon(request, pickup, PICKUP_DATE)],
    intervention: {
      type: 'weights',
      hypothesis: 'Weights trained on the verified pickup examples book from pickup_from.',
      workedExamples: [],
      practicePerFinding: 0,
      question: '',
      estimatedCost: { mentorUsd: 0.3, computeUsd: 1.5, minutes: 25 },
      verificationPlan: 'Measure the adapter on and off on the same dev seeds.',
    },
  };
}

/**
 * Round 5, stopped: the pickup rule as a procedure. Its finding in the stopped category is set
 * aside; its finding in a new category is repaired, and the wall clock runs out before practice.
 */
function pickupRuleRound(request: MentorCompletionRequest): Diagnosis {
  const stopped = failedAt(request, 'pickup', 0);
  const fresh = failedAt(request, 'pickup', 2);
  return {
    title: 'Book pickups from the ready date',
    diagnosis: "Every failed pickup was booked before the return's pickup_from date.",
    causeTaskIds: [stopped.taskId, fresh.taskId],
    edits: [agentsWith(request, PICKUP_PROCEDURE)],
    predicted: {
      devDeltaMin: 1,
      devDeltaMax: 2,
      rationale: 'Pickups fail in every round of practice, all of them booked too soon.',
    },
    readyClaim: false,
    findings: [
      bookedTooSoon(request, stopped, PICKUP_DATE),
      rulesMisread(request, fresh, READY_DATE),
    ],
    intervention: {
      type: 'procedure',
      hypothesis:
        'The pickup rule in AGENTS.md, with a worked example, makes the agent read pickup_from before it books.',
      workedExamples: ['pickup'],
      practicePerFinding: 1,
      question: '',
      estimatedCost: { mentorUsd: 0.5, computeUsd: 0, minutes: 2 },
      verificationPlan:
        'Replay from the turn that summed up the rules, then practice on another pickup.',
    },
  };
}

const REPLIES: ReadonlyMap<number, RoundReply> = new Map([
  [1, refundRound],
  [2, datesSkillRound],
  [3, helperRound],
  [4, weightsRound],
  [LAST_ROUND, pickupRuleRound],
]);

/**
 * The recording's clock: it moves only when a scripted model takes a turn or the scenario moves
 * it, and its timeouts, such as the run's wall-clock deadlines, fire as it passes them.
 */
class RecordingClock implements Clock {
  private readonly timers: { at: number; controller: AbortController }[] = [];

  constructor(private time: number) {}

  readonly now = (): number => this.time;

  readonly timeout = (ms: number): AbortSignal => {
    const controller = new AbortController();
    this.timers.push({ at: this.time + ms, controller });
    this.fire();
    return controller.signal;
  };

  readonly advance = (ms: number): void => {
    this.time += ms;
    this.fire();
  };

  private fire(): void {
    for (const timer of this.timers.filter(({ at }) => at <= this.time)) {
      this.timers.splice(this.timers.indexOf(timer), 1);
      timer.controller.abort(new DOMException('The time ran out.', 'TimeoutError'));
    }
  }
}

/**
 * Makes `performance.now` read the recording's clock until the returned function puts it back.
 * The agent loop times attempts and turns with it, so their latencies follow the scripted
 * models' turns rather than how fast this computer replays them.
 */
function timeAttemptsBy(clock: RecordingClock): () => void {
  const own = Object.getOwnPropertyDescriptor(performance, 'now');
  const origin = clock.now();
  Object.defineProperty(performance, 'now', {
    configurable: true,
    writable: true,
    value: () => clock.now() - origin,
  });
  return () => {
    if (own === undefined) Reflect.deleteProperty(performance, 'now');
    else Object.defineProperty(performance, 'now', own);
  };
}

/** Whether the event announces a verified lesson of the round the wall clock ends. */
function lastRoundTaught(event: RunEvent, store: EngineStore): boolean {
  if (event.type !== 'mentoring.updated' || event.record !== 'lesson') return false;
  return event.round === LAST_ROUND && store.lessons.get(event.id)?.status === 'verified';
}

const LessonSummarySchema = z.object({
  id: z.string(),
  kind: EpisodeKindSchema,
  status: z.enum(['verified', 'rejected']),
  /** How far down the ladder its correction started: the suspected turn, one earlier, the task. */
  fallback: z.enum(['none', 'earlier', 'full_task']).nullable(),
  /** The model turn its correction took first; 1 is the start of the task. */
  turn: z.number().int().positive().nullable(),
  taskId: z.string().nullable(),
  /** Its failure category, by slug. */
  category: z.string().nullable(),
});

const RoundSummarySchema = z.object({
  round: z.number().int().positive(),
  intervention: InterventionTypeSchema.nullable(),
  interventionStatus: z.enum(['accepted', 'invalid']).nullable(),
  experimentId: z.string(),
  disposition: ExperimentDispositionSchema,
  reason: z.string(),
  devBefore: ScoreSchema.nullable(),
  devAfter: ScoreSchema.nullable(),
  /** Minutes from the round's start to its end, on the recording's clock. */
  minutes: z.number().nonnegative(),
  lessons: z.array(LessonSummarySchema),
});

/** What `recordRun` wrote, for the screens' specs to find their records by. */
export const RecordedRunSummarySchema = z.object({
  jobId: z.string(),
  runId: z.string(),
  graduateId: z.string().nullable(),
  seed: z.number().int(),
  stopReason: StopReasonRunSchema.nullable(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  wallMinutes: z.number().nonnegative(),
  mentorUsd: z.number().nonnegative(),
  dev: z.object({ baseline: ScoreSchema, current: ScoreSchema }),
  rounds: z.array(RoundSummarySchema),
  /** Round 1's repair: the failed train attempt, its task, the suspected turn and the lesson. */
  repair: z.object({
    attemptId: z.string(),
    taskId: z.string(),
    failureTurn: z.number().int().positive(),
    lessonId: z.string(),
  }),
  test: z.object({ score: ScoreSchema, perType: z.array(TypeScoreSchema) }),
  reference: z.object({
    split: z.enum(['dev', 'test']),
    status: z.enum(['running', 'paused', 'finished']),
    score: ScoreSchema.nullable(),
    perType: z.array(TypeScoreSchema),
    spentUsd: z.number().nonnegative(),
    maxUsd: z.number().nonnegative(),
  }),
});
export type RecordedRunSummary = z.infer<typeof RecordedRunSummarySchema>;

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing.`);
  return value;
}

/** Why the recorded run isn't the scenario, or nothing when it is. */
function scenarioProblems(store: EngineStore, runId: string): string[] {
  const { run } = must(store.runs.get(runId), 'The run');
  const problems: string[] = [];
  if (run.status !== 'finished') {
    problems.push(`it ended ${run.status}${run.error === undefined ? '' : `: ${run.error}`}`);
  }
  const ended = store.experiments.list(runId).map((experiment) => experiment.disposition);
  if (ended.join(', ') !== SCENARIO.join(', ')) {
    problems.push(`its rounds ended ${ended.join(', ') || 'with no experiment'}`);
  }
  if (run.stopReason !== 'wall_clock') {
    problems.push(`training ended for ${run.stopReason ?? 'no reason'}`);
  }
  const reference = store.references.get(runId, 'dev');
  if (reference?.status !== 'finished') {
    problems.push(
      `the reference on dev is ${reference?.status ?? 'missing'}${reference?.error === undefined ? '' : `: ${reference.error}`}`,
    );
  }
  return problems;
}

/** The summary of a recorded run, from its stored records. */
function summarize(store: EngineStore, runId: string): RecordedRunSummary {
  const record = must(store.runs.get(runId), 'The run');
  const { run } = record;
  const slugs = new Map(store.categories.list(run.jobId).map((item) => [item.id, item.slug]));
  const interventions = new Map(store.interventions.list(runId).map((item) => [item.round, item]));
  const lessons = store.lessons.list({ runId });
  const finding = must(interventions.get(1)?.findings[0], "Round 1's finding");
  const repair = must(
    lessons.find(
      (lesson) =>
        lesson.round === 1 &&
        lesson.kind === 'replay_correction' &&
        lesson.status === 'verified' &&
        lesson.source.kind === 'attempt' &&
        lesson.source.attemptId === finding.attemptId,
    ),
    "Round 1's verified repair",
  );
  const report = must(store.reports.get(runId, record.lockedTestOn), 'The report card');
  const reference = must(store.references.get(runId, 'dev'), 'The reference on dev');
  const typeScores = (scores: readonly { type: string; pass: number; total: number }[]) =>
    scores.map(({ type, pass, total }) => ({ type, pass, total }));
  return RecordedRunSummarySchema.parse({
    jobId: run.jobId,
    runId,
    graduateId: run.graduateId ?? null,
    seed: run.seed,
    stopReason: run.stopReason ?? null,
    startedAt: run.createdAt,
    endedAt: must(run.endedAt, 'The run end'),
    wallMinutes: run.totals.wallMs / 60_000,
    mentorUsd: run.totals.mentorUsd,
    dev: {
      baseline: must(run.devBaseline, 'The dev baseline'),
      current: must(run.devCurrent, 'The current dev score'),
    },
    rounds: store.experiments.list(runId).map((experiment) => {
      const intervention = interventions.get(experiment.round);
      return {
        round: experiment.round,
        intervention: intervention?.type ?? null,
        interventionStatus: intervention?.status ?? null,
        experimentId: experiment.id,
        disposition: experiment.disposition,
        reason: experiment.reason,
        devBefore: experiment.devBefore,
        devAfter: experiment.devAfter,
        minutes: experiment.budget.minutes,
        lessons: lessons
          .filter((lesson) => lesson.round === experiment.round)
          .map((lesson) => ({
            id: lesson.id,
            kind: lesson.kind,
            status: lesson.status,
            fallback: lesson.checkpoint?.fallback ?? null,
            turn: lesson.checkpoint?.turn ?? null,
            taskId: lesson.source.kind === 'correction' ? null : lesson.source.taskId,
            category: lesson.categoryId === null ? null : (slugs.get(lesson.categoryId) ?? null),
          })),
      };
    }),
    repair: {
      attemptId: finding.attemptId,
      taskId: finding.taskId,
      failureTurn: finding.failureTurn,
      lessonId: repair.id,
    },
    test: { score: report.test.score, perType: typeScores(report.test.perType) },
    reference: {
      split: reference.split,
      status: reference.status,
      score: reference.score,
      perType: typeScores(reference.perType),
      spentUsd: reference.spentUsd,
      maxUsd: reference.maxUsd,
    },
  });
}

/**
 * The meter on the final test (decision 045), with fixed readings it names as a fake's: nothing
 * here serves a model, so there is no memory to read.
 */
export const FAKE_METER_READING = {
  peakProcessBytes: 19 * 1024 ** 3,
  peakGpuBytes: 7 * 1024 ** 3,
  coldStartMs: 8_400,
  samples: 24,
  sampler: 'a fake meter for the recorded run, with fixed readings',
} as const;

const FAKE_METER: RuntimeMeter = {
  start: async () => ({ stop: async () => ({ ...FAKE_METER_READING }) }),
};

/**
 * Records the run into `dataDir`, which must be empty or not exist yet: the job imported with
 * `JobLibrary.importFile`, `architect.db` at the root, the run to its end, then Spark on dev as a
 * reference. The controller and the store are closed before it returns, so the folder can be
 * copied whole, and `recorded-run.json` beside the database holds the summary it returns.
 */
export async function recordRun(dataDir: string): Promise<RecordedRunSummary> {
  mkdirSync(dataDir, { recursive: true });
  if (readdirSync(dataDir).length > 0) {
    throw new Error(`${dataDir} isn't empty. Record into a new folder, so it holds only this run.`);
  }
  const clock = new RecordingClock(START);
  const glimmer = new ScriptedGlimmer(HABITS, clock.advance);
  const agent = new ScriptedSparkAgent(HABITS, clock.advance);
  const spark = new ScriptedSpark(clock.advance);
  for (const [round, reply] of REPLIES) spark.replies.set(round, reply);
  const real = createEngineDeps({ dataDir, getSecret: async () => NO_KEY });
  const deps: EngineHostDeps = {
    ...real,
    adapters: {
      ...real.adapters,
      createMentor: () => spark,
      createStudent: () => glimmer,
      createActor: () => agent,
    },
    meter: FAKE_METER,
  };
  const source = mkdtempSync(join(tmpdir(), 'gear-returns-recording-'));
  const paths = new DataPaths(dataDir);
  const store = openEngineStore(paths.database);
  const jobs = new JobLibrary(store, paths, deps, clock);
  const controller = new RunController({ store, paths, jobs, deps, clock });
  const restore = timeAttemptsBy(clock);
  try {
    cpSync(job.dir, source, { recursive: true });
    const file = join(source, 'job.json');
    const shipped = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, `${JSON.stringify(recordedJob(shipped), null, 2)}\n`);
    const imported = await jobs.importFile(file);
    // The student solves every task the job has, the locked test's included, as the reference
    // solution does; the mentor and Spark as the agent know only what the runner shows them.
    glimmer.known = job.allTasks();
    agent.known = [
      ...(await jobs.tasks(imported.id, 'train')),
      ...(await jobs.tasks(imported.id, 'dev')),
    ];
    // The wall clock runs out as round 5's first correction is verified, before its next one.
    const outOfTime = clock.now() + WALL_MINUTES * 60_000 + OVERRUN_MS;
    let ranOut = false;
    controller.onEvent((event) => {
      if (ranOut || !lastRoundTaught(event, store)) return;
      ranOut = true;
      clock.advance(Math.max(0, outOfTime - clock.now()));
    });
    const run = await controller.start(imported.id, 'architect', RECORDED_SEED);
    await controller.idle();
    if (store.runs.get(run.id)?.run.status === 'finished') {
      await controller.reference(run.id, 'dev', REFERENCE_CAP_USD);
      await controller.idle();
    }
    const problems = scenarioProblems(store, run.id);
    if (!ranOut)
      problems.push(`round ${LAST_ROUND} verified no correction for the clock to run out on`);
    if (problems.length > 0) {
      throw new Error(
        `The recorded run didn't follow the scenario: ${problems.join('; ')}. Its records are in ${dataDir}.`,
      );
    }
    const summary = summarize(store, run.id);
    writeFileSync(join(dataDir, SUMMARY_FILE), `${JSON.stringify(summary, null, 2)}\n`);
    return summary;
  } finally {
    await controller.close();
    store.close();
    restore();
    rmSync(source, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
