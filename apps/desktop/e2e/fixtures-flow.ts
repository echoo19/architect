import type {
  DraftTurn,
  JobSummary,
  Method,
  Round,
  Run,
  RunEvent,
  WorkspaceChat,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import type { EngineReplies } from './fixtures';
import {
  at,
  AT,
  DESCRIPTION,
  detail,
  graduate,
  job,
  makeRun,
  reports,
  round,
  roundDiff,
  rounds,
  STORY,
  trace,
} from './story';

/*
 * Engine replies for the creation flow, built on the shared story (story.ts): the job is
 * described, drafted and trained, and the graduate opens in the workspace.
 */

export { DESCRIPTION, reports };

export const FLOW = {
  ...STORY,
  chatId: 'cht_firstday',
  sessionId: 'drf_closeout',
};

export const REPLY =
  'Pricing finished visits, the overdue list and urgent bookings. Ask me before it books anything.';

export const ATTACHED = [
  'D:/Ferncliff/office/jobs.csv',
  'D:/Ferncliff/office/invoices.csv',
  'D:/Ferncliff/office/technicians.csv',
  'D:/Ferncliff/office/bookings.csv',
  'D:/Ferncliff/office/policy.md',
  'D:/Ferncliff/office/tasks.jsonl',
];

export const turns: { start: DraftTurn; replies: DraftTurn[] } = {
  start: {
    sessionId: FLOW.sessionId,
    message:
      "Got it. I'll set up an agent that works from the office files and closes out the day. " +
      'Which of those three tasks should it take on by itself?',
    options: [],
  },
  replies: [
    {
      sessionId: FLOW.sessionId,
      message:
        'Last one. When it prices a finished visit, should it show the line items or just the total?',
      options: ['Show the line items', 'Just the total'],
    },
    { sessionId: FLOW.sessionId, message: '', options: [], draft: job },
  ],
};

const summaries: JobSummary[] = [
  { id: FLOW.jobId, name: 'Service desk', summary: job.summary, createdAt: AT, taskCount: 170 },
];

export const startedRun = makeRun({
  status: 'running',
  phase: 'preparing',
  updatedAt: AT,
  devBaseline: null,
  devCurrent: null,
  currentVersion: 0,
  totals: { ...makeRun({}).totals, mentorUsd: 0, rounds: 0, attempts: 0, wallMs: 0 },
});

const finishedRun = (id: string, method: Method): Run =>
  makeRun({ id, method, status: 'finished', phase: 'done', endedAt: at(180), updatedAt: at(180) });

const runs: Run[] = [
  finishedRun(FLOW.runId, 'architect'),
  finishedRun('run_bare', 'bare'),
  finishedRun('run_oneshot', 'one_shot'),
  finishedRun('run_reflect', 'self_reflection'),
];

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
  'secrets:status': { meta: true, openrouter: true },
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
    updatedAt: at(130),
    currentVersion: 4,
    devCurrent: { pass: 68, total: 80 },
    totals: { ...makeRun({}).totals, rounds: 5, wallMs: 130 * 60_000 },
    ...overrides,
  });
}

/** What the training view receives after the snapshot: round 4 is kept and round 5 starts. */
export function roundFourKept(): RunEvent[] {
  const decided: Round = {
    ...(rounds[3] as Round),
    status: 'decided',
    devBefore: { pass: 62, total: 80 },
    devAfter: { pass: 68, total: 80 },
    firstMeasurement: { devBefore: { pass: 31, total: 40 }, devAfter: { pass: 35, total: 40 } },
    decision: 'kept',
    decisionReason:
      'Dev 31/40 → 35/40, measured again on new seeds: 62/80 → 68/80 over 2 runs, no type ' +
      'lost more than two',
    endedAt: at(130),
  };
  const next = round(5, { status: 'attempting', train: { pass: 0, total: 0 }, startedAt: at(130) });
  const base = { runId: FLOW.runId, at: at(130) };
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
        answerSummary: 'Thu 10:00, Omar K.',
      },
      prompt: 'Book the earliest plumber for a burst pipe at 9 Birch Ln, zone B.',
    },
  ];
}

export function paused(): RunEvent[] {
  const run = progressed({ status: 'paused', updatedAt: at(132) });
  return [{ type: 'run.updated', runId: FLOW.runId, at: run.updatedAt, run }];
}

/** Training ended at the target after round 7; the final test is running on this computer. */
function trained(overrides: Partial<Run>): Run {
  return progressed({
    currentVersion: STORY.version,
    devCurrent: { pass: 72, total: 80 },
    stopReason: 'target_met',
    totals: { ...makeRun({}).totals, rounds: 7, mentorUsd: 0.41, wallMs: 201 * 60_000 },
    ...overrides,
  });
}

export function finalTest(done: number): RunEvent[] {
  const base = { runId: FLOW.runId, at: at(202) };
  return [
    {
      ...base,
      type: 'run.updated',
      run: trained({ status: 'testing', phase: 'testing', updatedAt: at(202) }),
    },
    {
      ...base,
      type: 'eval.progress',
      split: 'test',
      harnessVersion: STORY.version,
      done,
      total: 60,
      pass: done - 2,
    },
  ];
}

export function finished(): RunEvent[] {
  const base = { runId: FLOW.runId, at: at(352) };
  return [
    {
      ...base,
      type: 'run.updated',
      run: trained({
        status: 'finished',
        phase: 'done',
        updatedAt: at(352),
        endedAt: at(352),
        graduateId: FLOW.graduateId,
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
