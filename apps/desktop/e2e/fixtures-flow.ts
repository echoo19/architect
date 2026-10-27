import type {
  Attempt,
  DraftTurn,
  FileDiff,
  GraduateSummary,
  Job,
  JobSummary,
  LineageEntry,
  Method,
  ReportCard,
  Round,
  Run,
  RunDetail,
  RunEvent,
  Trace,
  WorkspaceChat,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import type { EngineReplies } from './fixtures';

/*
 * Engine replies for the creation flow, built on the sample job from DECISIONS.md 005: a service
 * desk for Ferncliff Home Services that prices invoices, finds overdue balances and books urgent
 * calls. Training runs on a hosted copy of the student; the final test runs on this computer.
 */

const AT = '2026-10-27T15:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(AT) + minutes * 60_000).toISOString();

export const FLOW = {
  jobId: 'job_servicedesk',
  runId: 'run_servicedesk',
  graduateId: 'grd_servicedesk',
  chatId: 'cht_firstday',
  sessionId: 'drf_closeout',
  seed: 7,
};

export const DESCRIPTION =
  'Close out the day for our home-services office: price the jobs the technicians finished, ' +
  'find customers with overdue balances, and book the earliest technician for urgent calls.';

export const REPLY =
  'Pricing finished jobs, the overdue list and urgent bookings. Ask me before it books anything.';

export const ATTACHED = [
  'D:/Ferncliff/office/jobs.csv',
  'D:/Ferncliff/office/invoices.csv',
  'D:/Ferncliff/office/policy.md',
  'D:/Ferncliff/office/tasks.jsonl',
];

export const job: Job = {
  format: 1,
  id: FLOW.jobId,
  name: 'Service desk',
  description: DESCRIPTION,
  summary: 'Prices finished jobs, chases overdue balances and books the next urgent call.',
  does: [
    'Prices a finished job from the rate card',
    'Finds overdue balances after partial payments',
    'Books the earliest technician with the right license',
    'Shows the line items behind every invoice',
  ],
  doesNot: [
    'Changes a booking without asking',
    'Reads files outside the office folder',
    'Guesses when the records disagree',
  ],
  createdAt: AT,
  taskTypes: [
    { id: 'invoice', label: 'Invoices' },
    { id: 'overdue', label: 'Overdue balances' },
    { id: 'scheduling', label: 'Scheduling' },
  ],
  data: {
    files: [
      { name: 'jobs.csv', kind: 'table', access: 'read' },
      { name: 'invoices.csv', kind: 'table', access: 'write' },
      { name: 'technicians.csv', kind: 'table', access: 'read' },
      { name: 'bookings.csv', kind: 'table', access: 'write' },
      { name: 'policy.md', kind: 'text', access: 'read' },
    ],
  },
  permissions: { writes: 'ask', unseenFiles: 'ask' },
  checker: { kind: 'builtin' },
  requirements: { passRate: 0.9, p95LatencyMs: 45_000 },
  budget: { maxRounds: 12, maxMentorUsd: 5, maxWallMinutes: 180 },
  mentor: {
    kind: 'model',
    provider: 'meta',
    label: 'Muse Spark 1.3',
    baseUrl: 'https://api.meta.ai/v1',
    model: 'muse-spark-1.3',
    reasoningEffort: 'medium',
    secretRef: 'meta',
  },
  student: {
    label: 'Glimmer',
    local: {
      runtime: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'muse-glimmer:30b',
      contextLength: 16_384,
    },
    trainOn: 'local',
    hosted: {
      runtime: 'openai_compatible',
      baseUrl: 'https://api.together.ai/v1',
      model: 'meta-models/Muse-Glimmer-30B',
      secretRef: 'together',
      contextLength: 16_384,
    },
  },
  startingHarness: { kind: 'blank' },
  splits: { seed: FLOW.seed, calibration: 10, train: 60, dev: 40, test: 60 },
  evaluation: { trainBatch: 12, minDevGain: 2, maxTypeRegression: 1, devRepeats: 1, patience: 3 },
};

export const turns: { start: DraftTurn; replies: DraftTurn[] } = {
  start: {
    sessionId: FLOW.sessionId,
    message:
      "Got it. I'll build an agent that works from the office files and closes out the day. " +
      'Which of those jobs should it take on by itself?',
    options: [],
  },
  replies: [
    {
      sessionId: FLOW.sessionId,
      message: 'Last one. When it prices a job, should it show the line items or just the total?',
      options: ['Show the line items', 'Just the total'],
    },
    { sessionId: FLOW.sessionId, message: '', options: [], draft: job },
  ],
};

const summaries: JobSummary[] = [
  { id: FLOW.jobId, name: 'Service desk', summary: job.summary, createdAt: AT, taskCount: 170 },
];

function makeRun(overrides: Partial<Run>): Run {
  return {
    id: FLOW.runId,
    jobId: FLOW.jobId,
    method: 'architect',
    seed: FLOW.seed,
    status: 'running',
    phase: 'evaluating',
    createdAt: AT,
    updatedAt: at(72),
    currentVersion: 3,
    devBaseline: { pass: 16, total: 40 },
    devCurrent: { pass: 31, total: 40 },
    totals: {
      mentorUsd: 0.23,
      mentorInputTokens: 112_000,
      mentorOutputTokens: 21_000,
      studentInputTokens: 1_900_000,
      studentOutputTokens: 210_000,
      rounds: 4,
      attempts: 236,
      wallMs: 72 * 60_000,
    },
    ...overrides,
  };
}

export const startedRun = makeRun({
  status: 'running',
  phase: 'preparing',
  updatedAt: AT,
  devBaseline: null,
  devCurrent: null,
  currentVersion: 0,
  totals: { ...makeRun({}).totals, mentorUsd: 0, rounds: 0, attempts: 0, wallMs: 0 },
});

function round(index: number, fields: Partial<Round>): Round {
  return {
    runId: FLOW.runId,
    index,
    status: 'decided',
    train: { pass: 7, total: 12 },
    files: [],
    costUsd: 0.06,
    startedAt: at(index * 15),
    ...fields,
  };
}

const rounds: Round[] = [
  round(1, {
    title: 'Read the rate card first',
    diagnosis:
      'Glimmer prices labor from memory instead of the rate card in policy.md, so tier rates ' +
      'come out wrong on 5 of 12 practice invoices.',
    predicted: { devDeltaMin: 4, devDeltaMax: 8, rationale: 'Most invoice failures share it.' },
    files: ['system.md', 'skills/price-a-job.md'],
    devBefore: { pass: 16, total: 40 },
    devAfter: { pass: 23, total: 40 },
    decision: 'kept',
    decisionReason: 'Check 16/40 → 23/40, and no task type lost more than one. Kept.',
  }),
  round(2, {
    title: 'Shorter tool descriptions',
    diagnosis: 'It calls read_table without filters and runs out of steps on the larger files.',
    predicted: { devDeltaMin: 2, devDeltaMax: 4, rationale: 'Fewer wasted steps.' },
    files: ['system.md'],
    devBefore: { pass: 23, total: 40 },
    devAfter: { pass: 22, total: 40 },
    decision: 'reverted',
    decisionReason: 'Check 23/40 → 22/40. A change needs at least 2 more right. Reverted.',
  }),
  round(3, {
    title: 'Cents, not dollars',
    diagnosis:
      'Totals drift by a cent or more because it rounds every line in dollars. The policy ' +
      'says to work in integer cents and round once, at the end.',
    predicted: { devDeltaMin: 5, devDeltaMax: 9, rationale: 'Every invoice total depends on it.' },
    files: ['system.md', 'skills/price-a-job.md'],
    devBefore: { pass: 23, total: 40 },
    devAfter: { pass: 31, total: 40 },
    decision: 'kept',
    decisionReason: 'Check 23/40 → 31/40, and no task type lost more than one. Kept.',
  }),
  round(4, {
    status: 'evaluating',
    train: { pass: 8, total: 12 },
    title: 'Check the zone travel time',
    diagnosis:
      'Bookings start too early: it ignores the drive between zones, so 3 of 4 scheduling ' +
      "failures pick a slot the technician can't reach in time.",
    predicted: { devDeltaMin: 3, devDeltaMax: 6, rationale: 'Scheduling is the weakest type.' },
    files: ['skills/book-urgent-calls.md', 'tools/travel_minutes.js', 'tools/travel_minutes.json'],
  }),
];

function attempt(
  id: string,
  fields: Partial<Attempt> & Pick<Attempt, 'taskType' | 'check'>,
  prompt: string,
): Attempt & { prompt: string } {
  return {
    id,
    runId: FLOW.runId,
    round: 4,
    taskId: `task_${id}`,
    split: 'train',
    harnessVersion: 3,
    latencyMs: 13_200,
    usage: { inputTokens: 8_400, outputTokens: 380 },
    ...fields,
    prompt,
  };
}

const failedBooking = attempt(
  'att_0412',
  {
    taskType: 'scheduling',
    check: {
      pass: false,
      reason:
        'Starts at 08:00, but Priya N. needs 90 minutes to drive from zone A to zone C. The ' +
        'earliest start anyone can make is 09:30.',
    },
    answerSummary: 'Tue 08:00, Priya N.',
    expectedSummary: 'Tue 09:30, Priya N.',
    latencyMs: 11_600,
  },
  'Book the earliest licensed electrician for an urgent panel repair at 14 Alder St, zone C.',
);

const recentAttempts: (Attempt & { prompt: string })[] = [
  failedBooking,
  attempt(
    'att_0411',
    {
      taskType: 'invoice',
      check: { pass: true, reason: 'Line items and total match.' },
      answerSummary: '$486.20',
    },
    'Price job J-4410: 2.5 hours for a senior technician, parts $186.40, plan member.',
  ),
  attempt(
    'att_0410',
    {
      taskType: 'overdue',
      check: { pass: true, reason: 'Customers and amounts match.' },
      answerSummary: '3 customers, $2,915.00',
      latencyMs: 9_800,
    },
    'Which customers are more than 30 days overdue after partial payments?',
  ),
  attempt(
    'att_0409',
    {
      taskType: 'invoice',
      check: {
        pass: false,
        reason: 'Total is $1,248.50; expected $1,284.50. The after-hours rate applies to labor.',
      },
      answerSummary: '$1,248.50',
      expectedSummary: '$1,284.50',
      latencyMs: 16_100,
    },
    'Price job J-4412: after-hours callout, 3 hours for a journeyman, parts $412.00.',
  ),
  attempt(
    'att_0398',
    {
      split: 'dev',
      round: 3,
      taskType: 'overdue',
      check: { pass: true, reason: 'Balance and date match.' },
      answerSummary: '$640.00, Aug 14',
      latencyMs: 10_400,
    },
    "What is Oakridge Dental's oldest unpaid balance?",
  ),
];

function lineage(source: Round, perType: LineageEntry['measured']['perType']): LineageEntry {
  const before = source.devBefore ?? { pass: 0, total: 40 };
  const after = source.devAfter ?? before;
  return {
    id: `lin_${source.index}`,
    runId: FLOW.runId,
    round: source.index,
    title: source.title ?? '',
    diagnosis: source.diagnosis ?? '',
    files: source.files,
    causeTaskIds: ['task_att_0301', 'task_att_0305'],
    predicted: source.predicted ?? { devDeltaMin: 0, devDeltaMax: 0, rationale: '' },
    measured: { devBefore: before, devAfter: after, delta: after.pass - before.pass, perType },
    decision: source.decision ?? 'kept',
    decisionReason: source.decisionReason ?? '',
    versionFrom: source.index - 1,
    versionTo: source.index,
    mentor: { model: 'muse-spark-1.3', costUsd: 0.06, inputTokens: 28_000, outputTokens: 5_200 },
    at: at(source.index * 15 + 12),
  };
}

const [round1, round2, round3] = rounds as [Round, Round, Round, Round];

export const detail: RunDetail = {
  run: makeRun({}),
  job: { ...job, student: { ...job.student, trainOn: 'hosted' } },
  rounds,
  recentAttempts,
  lineage: [
    lineage(round1, [
      { type: 'invoice', before: 3, after: 9 },
      { type: 'overdue', before: 8, after: 8 },
      { type: 'scheduling', before: 5, after: 6 },
    ]),
    lineage(round2, [
      { type: 'invoice', before: 9, after: 9 },
      { type: 'overdue', before: 8, after: 7 },
      { type: 'scheduling', before: 6, after: 6 },
    ]),
    lineage(round3, [
      { type: 'invoice', before: 9, after: 14 },
      { type: 'overdue', before: 8, after: 10 },
      { type: 'scheduling', before: 6, after: 7 },
    ]),
  ],
};

export const trace: Trace = {
  taskId: failedBooking.taskId,
  harnessVersion: 3,
  studentModel: 'meta-models/Muse-Glimmer-30B',
  messages: [{ role: 'user', content: failedBooking.prompt }],
  steps: [
    { kind: 'skill', slug: 'book-urgent-calls', via: 'rule' },
    {
      kind: 'model',
      text: 'I need licensed electricians who can reach zone C, and their bookings for Tuesday.',
      toolCalls: [
        {
          id: 'call_1',
          name: 'read_table',
          arguments: {
            file: 'technicians.csv',
            where: [{ column: 'license', op: '=', value: 'electrical' }],
          },
        },
      ],
      usage: { inputTokens: 3_100, outputTokens: 96 },
      latencyMs: 2_400,
    },
    {
      kind: 'tool',
      callId: 'call_1',
      name: 'read_table',
      arguments: {
        file: 'technicians.csv',
        where: [{ column: 'license', op: '=', value: 'electrical' }],
      },
      result: [
        { id: 'T-07', name: 'Priya N.', zone: 'A', hours: '07:30-16:00' },
        { id: 'T-11', name: 'Marcus O.', zone: 'C', hours: '10:00-18:30' },
      ],
      latencyMs: 31,
    },
    {
      kind: 'tool',
      callId: 'call_2',
      name: 'read_table',
      arguments: {
        file: 'bookings.csv',
        where: [{ column: 'date', op: '=', value: '2026-10-28' }],
      },
      result: [{ technician: 'T-07', start: '10:30', end: '12:00', zone: 'B' }],
      latencyMs: 28,
    },
    {
      kind: 'model',
      text: 'Priya is free from 07:30 until 10:30, so the earliest start is 08:00.',
      toolCalls: [],
      usage: { inputTokens: 3_900, outputTokens: 141 },
      latencyMs: 3_100,
    },
  ],
  finalText:
    'Priya N. can take it first thing Tuesday.\nANSWER: {"technician":"T-07","start":"2026-10-28T08:00"}',
  stopReason: 'answer',
  usage: { inputTokens: 9_120, outputTokens: 412 },
  latencyMs: 11_600,
};

export const roundDiff: FileDiff[] = [
  {
    path: 'system.md',
    status: 'modified',
    patch: [
      '--- a/system.md',
      '+++ b/system.md',
      '@@ -4,4 +4,6 @@ You are the service desk for Ferncliff Home Services.',
      ' Read policy.md before you price a job, chase a balance or book a visit.',
      ' Use the data tools for every number; never estimate from memory.',
      '-Round each line item to the nearest cent as you go.',
      '+Work in integer cents from start to finish.',
      '+Add the lines, take off the plan-member discount, add the city tax,',
      '+and round once, at the end, half up.',
      ' Finish with one line: ANSWER: <json>.',
    ].join('\n'),
  },
  {
    path: 'skills/price-a-job.md',
    status: 'modified',
    patch: [
      '--- a/skills/price-a-job.md',
      '+++ b/skills/price-a-job.md',
      '@@ -6,5 +6,6 @@ task_types: [invoice]',
      ' 1. Read the job row from jobs.csv and the tier from technicians.csv.',
      '-2. Labor: hours times the tier rate, in dollars.',
      '+2. Labor: hours times the tier rate from policy.md, in cents.',
      ' 3. After hours (before 08:00, after 18:00, weekends): labor times 1.5.',
      '-4. Parts: cost times 1.35, rounded to the dollar.',
      '+4. Parts: cost times 1.35, rounded to the cent per part.',
      '+5. Keep every amount in cents until the total.',
    ].join('\n'),
  },
];

function report(
  runId: string,
  method: Method,
  pass: number,
  cost: { mentorUsd: number; rounds: number; wallMs: number },
): ReportCard {
  const perType = [
    { type: 'invoice', label: 'Invoices', share: 0.95 },
    { type: 'overdue', label: 'Overdue balances', share: 1 },
    { type: 'scheduling', label: 'Scheduling', share: 0.8 },
  ];
  const scale = pass / 55;
  const actual = pass / 60;
  return {
    jobId: FLOW.jobId,
    runId,
    method,
    name: 'Service desk',
    createdAt: at(180),
    student: { label: 'Glimmer', model: 'muse-glimmer:30b', runtime: 'ollama' },
    mentor: { label: 'Muse Spark 1.3', model: 'muse-spark-1.3' },
    test: {
      score: { pass, total: 60 },
      perType: perType.map((type) => ({
        type: type.type,
        label: type.label,
        pass: Math.min(20, Math.round(20 * type.share * scale)),
        total: 20,
        refused: false,
      })),
      latencyMs: { p50: 24_000, p95: 41_000 },
      refusals: 0,
      ranOffline: true,
    },
    dev: {
      baseline: { pass: 16, total: 40 },
      final: { pass: 36, total: 40 },
      curve: [
        { round: 0, score: { pass: 16, total: 40 }, decision: 'baseline' },
        { round: 1, score: { pass: 23, total: 40 }, decision: 'kept' },
        { round: 2, score: { pass: 22, total: 40 }, decision: 'reverted' },
        { round: 3, score: { pass: 31, total: 40 }, decision: 'kept' },
      ],
    },
    cost: {
      mentorUsd: cost.mentorUsd,
      mentorInputTokens: 340_000,
      mentorOutputTokens: 61_000,
      rounds: cost.rounds,
      wallMs: cost.wallMs,
    },
    refusedTypes: [],
    topInterventions:
      method === 'architect'
        ? [
            { round: 3, title: 'Cents, not dollars', delta: 8 },
            { round: 1, title: 'Read the rate card first', delta: 7 },
            { round: 5, title: 'Check the zone travel time', delta: 4 },
          ]
        : [],
    requirements: {
      passRate: { target: 0.9, actual, met: actual >= 0.9 },
      p95LatencyMs: { target: 45_000, actual: 41_000, met: true },
    },
    overclaim: false,
  };
}

export const reports: Record<string, ReportCard> = {
  [FLOW.runId]: report(FLOW.runId, 'architect', 55, {
    mentorUsd: 0.41,
    rounds: 7,
    wallMs: 158 * 60_000,
  }),
  run_bare: report('run_bare', 'bare', 31, { mentorUsd: 0, rounds: 0, wallMs: 41 * 60_000 }),
  run_oneshot: report('run_oneshot', 'one_shot', 42, {
    mentorUsd: 0.04,
    rounds: 1,
    wallMs: 52 * 60_000,
  }),
  run_reflect: report('run_reflect', 'self_reflection', 38, {
    mentorUsd: 0,
    rounds: 7,
    wallMs: 149 * 60_000,
  }),
};

const finishedRun = (id: string, method: Method): Run =>
  makeRun({ id, method, status: 'finished', phase: 'done', endedAt: at(180), updatedAt: at(180) });

const runs: Run[] = [
  finishedRun(FLOW.runId, 'architect'),
  finishedRun('run_bare', 'bare'),
  finishedRun('run_oneshot', 'one_shot'),
  finishedRun('run_reflect', 'self_reflection'),
];

const graduate: GraduateSummary = {
  id: FLOW.graduateId,
  name: 'Service desk',
  path: 'graduates/service-desk',
  manifest: {
    format: 1,
    id: FLOW.graduateId,
    name: 'Service desk',
    jobId: FLOW.jobId,
    runId: FLOW.runId,
    method: 'architect',
    createdAt: at(180),
    student: {
      label: 'Glimmer',
      runtime: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'muse-glimmer:30b',
      quantization: 'Q4_K_M',
      sizeBytes: 18 * 1024 ** 3,
      contextLength: 16_384,
    },
    harness: { version: 5, hash: 'sha256-flow' },
    requirements: {
      passRate: { target: 0.9, actual: 55 / 60, met: true },
      p95LatencyMs: { target: 45_000, actual: 41_000, met: true },
    },
    test: { score: { pass: 55, total: 60 }, perType: [] },
    mentor: { label: 'Muse Spark 1.3', model: 'muse-spark-1.3' },
  },
};

const chat: WorkspaceChat = {
  id: FLOW.chatId,
  graduateId: FLOW.graduateId,
  title: 'New chat',
  createdAt: at(181),
  updatedAt: at(181),
  running: false,
  waiting: false,
};

/** Replies that never change during the walk; the rest are stubbed by the helpers below. */
export const FLOW_ENGINE: EngineReplies = {
  'files:pick': ATTACHED,
  'jobs:draftStart': turns.start,
  'jobs:save': job,
  'jobs:get': job,
  'jobs:list': summaries,
  'secrets:status': { meta: true, together: true },
  'runs:get': detail,
  'runs:trace': trace,
  'runs:roundDiff': roundDiff,
  'runs:list': runs,
  'graduates:list': [graduate],
  'graduates:accept': graduate,
  'workspace:createChat': chat,
  'workspace:listChats': [chat],
  'workspace:messages': [],
};

/** The run once round 4 is kept: what every later event builds on. */
function progressed(overrides: Partial<Run>): Run {
  return makeRun({
    phase: 'attempting',
    updatedAt: at(76),
    currentVersion: 4,
    devCurrent: { pass: 34, total: 40 },
    totals: { ...makeRun({}).totals, rounds: 5, mentorUsd: 0.29, wallMs: 76 * 60_000 },
    ...overrides,
  });
}

/** What the training view receives after the snapshot: round 4 is kept and round 5 starts. */
export function roundFourKept(): RunEvent[] {
  const decided: Round = {
    ...(rounds[3] as Round),
    status: 'decided',
    devBefore: { pass: 31, total: 40 },
    devAfter: { pass: 34, total: 40 },
    decision: 'kept',
    decisionReason: 'Check 31/40 → 34/40, and no task type lost more than one. Kept.',
    endedAt: at(76),
  };
  const next = round(5, { status: 'attempting', train: { pass: 0, total: 0 }, startedAt: at(76) });
  const base = { runId: FLOW.runId, at: at(76) };
  return [
    { ...base, type: 'round.updated', round: decided },
    { ...base, type: 'run.updated', run: progressed({}) },
    { ...base, type: 'round.updated', round: next },
    {
      ...base,
      type: 'attempt.finished',
      attempt: {
        id: 'att_0501',
        runId: FLOW.runId,
        round: 5,
        taskId: 'task_att_0501',
        taskType: 'scheduling',
        split: 'train',
        harnessVersion: 4,
        check: { pass: true, reason: 'Feasible, and the earliest start.' },
        latencyMs: 12_300,
        usage: { inputTokens: 8_900, outputTokens: 402 },
        answerSummary: 'Tue 09:30, Priya N.',
      },
      prompt: 'Book the earliest plumber for a burst pipe at 9 Birch Ln, zone B.',
    },
  ];
}

export function paused(): RunEvent[] {
  const run = progressed({ status: 'paused', updatedAt: at(78) });
  return [{ type: 'run.updated', runId: FLOW.runId, at: run.updatedAt, run }];
}

export function finalTest(done: number): RunEvent[] {
  const base = { runId: FLOW.runId, at: at(120) };
  return [
    {
      ...base,
      type: 'run.updated',
      run: progressed({ status: 'testing', phase: 'testing', updatedAt: at(120) }),
    },
    {
      ...base,
      type: 'eval.progress',
      split: 'test',
      harnessVersion: 5,
      done,
      total: 60,
      pass: done - 2,
    },
  ];
}

export function finished(): RunEvent[] {
  const base = { runId: FLOW.runId, at: at(180) };
  return [
    {
      ...base,
      type: 'run.updated',
      run: progressed({
        status: 'finished',
        phase: 'done',
        updatedAt: at(180),
        endedAt: at(180),
        devCurrent: { pass: 36, total: 40 },
        graduateId: FLOW.graduateId,
        stopReason: 'target_met',
      }),
    },
    { ...base, type: 'graduate.ready', graduateId: FLOW.graduateId },
  ];
}

/** Answers a channel with each reply in turn (an `{ error }` entry fails), repeating the last. */
export async function stubSequence(
  app: ElectronApplication,
  channel: string,
  replies: (unknown | { error: string })[],
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { channel, replies }) => {
      let call = 0;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => {
        const reply = replies[Math.min(call, replies.length - 1)];
        call += 1;
        if (reply && typeof reply === 'object' && 'error' in reply) {
          return { ok: false, error: { message: String(reply.error) } };
        }
        return { ok: true, value: reply };
      });
    },
    { channel, replies },
  );
}

/** Answers a channel by its first argument, failing for keys it doesn't know. */
export async function stubByKey(
  app: ElectronApplication,
  channel: string,
  replies: Record<string, unknown>,
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { channel, replies }) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_event, key: unknown) =>
        typeof key === 'string' && key in replies
          ? { ok: true, value: replies[key] }
          : { ok: false, error: { message: `Nothing is stored for ${String(key)}.` } },
      );
    },
    { channel, replies },
  );
}

type CallLog = Record<string, unknown[][]>;

/** Answers a channel with a fixed reply and records the arguments of every call. */
export async function stubRecorded(
  app: ElectronApplication,
  channel: string,
  reply: unknown,
): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { channel, reply }) => {
      const store = globalThis as typeof globalThis & { flowCalls?: CallLog };
      store.flowCalls = { ...store.flowCalls, [channel]: [] };
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_event, ...args: unknown[]) => {
        store.flowCalls?.[channel]?.push(args);
        return { ok: true, value: reply };
      });
    },
    { channel, reply },
  );
}

export function recordedCalls(app: ElectronApplication, channel: string): Promise<unknown[][]> {
  return app.evaluate(
    (_electron, name) =>
      (globalThis as typeof globalThis & { flowCalls?: CallLog }).flowCalls?.[name] ?? [],
    channel,
  );
}

/** Sends run events to the window, the way the engine host does. */
export async function emitRunEvents(app: ElectronApplication, events: RunEvent[]): Promise<void> {
  // Sent as JSON: Playwright's argument types can't follow the event union's recursive values.
  await app.evaluate(({ BrowserWindow }, json: string) => {
    const list = JSON.parse(json) as unknown[];
    for (const window of BrowserWindow.getAllWindows()) {
      for (const event of list) window.webContents.send('runs:onEvent', event);
    }
  }, JSON.stringify(events));
}
