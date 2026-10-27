import type {
  GraduateSummary,
  Job,
  JobSummary,
  ReportCard,
  RunDetail,
  WorkspaceChat,
  WorkspaceMessage,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';

/*
 * Sample engine replies for screenshots of populated screens. They stand in for the engine
 * until it registers its own handlers, and use the sample job from DECISIONS.md 005.
 */

const AT = '2026-10-27T15:00:00.000Z';

export const SAMPLE = {
  graduateId: 'grd_servicedesk',
  chatId: 'cht_closeout',
  jobId: 'job_servicedesk',
  runId: 'run_servicedesk',
  trainingRunId: 'run_dispatch',
};

const job: Job = {
  format: 1,
  id: SAMPLE.jobId,
  name: 'Service desk',
  description: 'Closes out the day for Ferncliff Home Services.',
  summary: 'Prices finished jobs, chases overdue balances and books the next urgent call.',
  does: [
    'Prices a finished job from the rate card',
    'Finds overdue balances after partial payments',
    'Books the earliest technician with the right license',
  ],
  doesNot: ['Changes a booking without asking', 'Reads files outside the office folder'],
  createdAt: AT,
  taskTypes: [
    { id: 'invoice', label: 'Invoices' },
    { id: 'overdue', label: 'Overdue balances' },
    { id: 'scheduling', label: 'Scheduling' },
  ],
  data: {
    files: [
      { name: 'invoices.csv', kind: 'table', access: 'write' },
      { name: 'policy.md', kind: 'text', access: 'read' },
    ],
  },
  permissions: { writes: 'ask', unseenFiles: 'ask' },
  checker: { kind: 'builtin' },
  requirements: { passRate: 0.9, p95LatencyMs: 8000 },
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
  },
  startingHarness: { kind: 'blank' },
  splits: { seed: 7, calibration: 10, train: 60, dev: 40, test: 60 },
  evaluation: { trainBatch: 12, minDevGain: 2, maxTypeRegression: 1, patience: 3 },
};

const graduate: GraduateSummary = {
  id: SAMPLE.graduateId,
  name: 'Service desk',
  path: 'graduates/service-desk',
  manifest: {
    format: 1,
    id: SAMPLE.graduateId,
    name: 'Service desk',
    jobId: SAMPLE.jobId,
    runId: SAMPLE.runId,
    method: 'architect',
    createdAt: AT,
    student: {
      label: 'Glimmer',
      runtime: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'muse-glimmer:30b',
      contextLength: 16_384,
    },
    harness: { version: 4, hash: 'sha256-sample' },
    requirements: { passRate: { target: 0.9, actual: 0.92, met: true } },
    test: {
      score: { pass: 55, total: 60 },
      perType: [
        { type: 'invoice', label: 'Invoices', pass: 19, total: 20, refused: false },
        { type: 'overdue', label: 'Overdue balances', pass: 20, total: 20, refused: false },
        { type: 'scheduling', label: 'Scheduling', pass: 16, total: 20, refused: false },
      ],
    },
    mentor: { label: 'Muse Spark 1.3', model: 'muse-spark-1.3' },
  },
};

const chats: WorkspaceChat[] = [
  {
    id: SAMPLE.chatId,
    graduateId: SAMPLE.graduateId,
    title: 'Close out Tuesday',
    createdAt: AT,
    updatedAt: AT,
    running: false,
    waiting: false,
  },
  {
    id: 'cht_overdue',
    graduateId: SAMPLE.graduateId,
    title: 'Overdue past 60 days',
    createdAt: AT,
    updatedAt: AT,
    running: false,
    waiting: true,
  },
  {
    id: 'cht_booking',
    graduateId: SAMPLE.graduateId,
    title: 'Book the Alder St leak',
    createdAt: AT,
    updatedAt: AT,
    running: true,
    waiting: false,
  },
];

const messages: WorkspaceMessage[] = [
  {
    id: 'msg_1',
    chatId: SAMPLE.chatId,
    role: 'user',
    createdAt: AT,
    text: 'Price the two jobs Dana finished today and tell me the totals.',
    steps: [],
    blocks: [],
    status: 'done',
  },
  {
    id: 'msg_2',
    chatId: SAMPLE.chatId,
    role: 'agent',
    createdAt: AT,
    text: 'Job 4410 comes to $486.20 and job 4412 to $1,284.50. The second was after hours, so the 1.5x labor rate applies, and the customer is a plan member, so 10% comes off before tax.',
    steps: [],
    blocks: [],
    status: 'done',
    workedMs: 3200,
  },
];

const jobs: JobSummary[] = [
  {
    id: 'job_dispatch',
    name: 'Dispatch board',
    createdAt: AT,
    taskCount: 120,
    latestRun: {
      id: SAMPLE.trainingRunId,
      status: 'running',
      phase: 'diagnosing',
      method: 'architect',
      devBaseline: { pass: 16, total: 40 },
      devCurrent: { pass: 23, total: 40 },
    },
  },
];

const run: RunDetail = {
  job,
  run: {
    id: SAMPLE.runId,
    jobId: SAMPLE.jobId,
    method: 'architect',
    seed: 7,
    status: 'running',
    phase: 'diagnosing',
    createdAt: AT,
    updatedAt: AT,
    currentVersion: 3,
    devBaseline: { pass: 16, total: 40 },
    devCurrent: { pass: 31, total: 40 },
    totals: {
      mentorUsd: 2.4,
      mentorInputTokens: 410_000,
      mentorOutputTokens: 52_000,
      studentInputTokens: 2_100_000,
      studentOutputTokens: 380_000,
      rounds: 4,
      attempts: 220,
      wallMs: 72 * 60_000,
    },
  },
  rounds: [
    { index: 1, title: 'Read the rate card first', before: 16, after: 23 },
    { index: 2, title: 'Shorter tool descriptions', before: 23, after: 22, reverted: true },
    { index: 3, title: 'Cents, not dollars', before: 23, after: 31 },
    { index: 4 },
  ].map((round) => ({
    runId: SAMPLE.runId,
    index: round.index,
    status: round.title ? ('decided' as const) : ('diagnosing' as const),
    train: { pass: 7, total: 12 },
    files: [],
    costUsd: 0.6,
    startedAt: AT,
    ...(round.title ? { title: round.title } : {}),
    ...(round.before !== undefined
      ? {
          devBefore: { pass: round.before, total: 40 },
          devAfter: { pass: round.after, total: 40 },
          decision: round.reverted ? ('reverted' as const) : ('kept' as const),
        }
      : {}),
  })),
  recentAttempts: [],
  lineage: [],
};

const report: ReportCard = {
  jobId: SAMPLE.jobId,
  runId: SAMPLE.runId,
  method: 'architect',
  name: 'Service desk',
  createdAt: AT,
  student: { label: 'Glimmer', model: 'muse-glimmer:30b', runtime: 'ollama' },
  mentor: { label: 'Muse Spark 1.3', model: 'muse-spark-1.3' },
  test: {
    score: { pass: 55, total: 60 },
    perType: graduate.manifest.test.perType,
    latencyMs: { p50: 4200, p95: 7600 },
    refusals: 1,
    ranOffline: true,
  },
  dev: { baseline: { pass: 16, total: 40 }, final: { pass: 36, total: 40 }, curve: [] },
  cost: {
    mentorUsd: 3.8,
    mentorInputTokens: 620_000,
    mentorOutputTokens: 81_000,
    rounds: 6,
    wallMs: 158 * 60_000,
  },
  refusedTypes: [
    {
      type: 'refunds',
      label: 'Refunds',
      reason: 'No refund policy in the office files, so it says so instead of guessing.',
    },
  ],
  topInterventions: [],
  requirements: { passRate: { target: 0.9, actual: 0.92, met: true } },
  overclaim: false,
};

/** Channel → reply. Any channel not listed keeps the app's own behavior. */
const REPLIES: Record<string, unknown> = {
  'graduates:list': [graduate],
  'workspace:listChats': chats,
  'workspace:messages': messages,
  'jobs:list': jobs,
  'jobs:get': job,
  'runs:get': run,
  'reports:get': report,
};

/** Answers engine channels in the main process with the sample replies above. */
export async function stubEngine(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, replies) => {
    for (const [channel, value] of Object.entries(replies)) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({ ok: true, value }));
    }
  }, REPLIES);
}
