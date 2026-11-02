import type {
  ConnectionTest,
  DraftTurn,
  JobSummary,
  LocalRuntimes,
  Method,
  Round,
  Run,
  RunEvent,
  TaskPlan,
  WorkspaceChat,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { LOCAL_WITH_GLIMMER, STORY_EVIDENCE, type EngineReplies } from './fixtures';
import {
  at,
  AT,
  DESCRIPTION,
  detail,
  GLIMMER_BYTES,
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

/**
 * What the Define screen's Example tasks tab shows for the story's job: the tasks came from the
 * tasks.jsonl the person attached, so each type has its description and three examples from the
 * practice tasks, and no rule Architect made.
 */
export const taskPlan: TaskPlan = {
  source: 'attached',
  counts: { calibration: 10, train: 60, dev: 40, test: 60 },
  types: [
    {
      id: 'invoice',
      label: 'Invoices',
      description: 'Price a finished job and add its invoice',
      counts: { calibration: 3, train: 20, dev: 13, test: 20 },
      examples: [
        {
          request:
            'Job W-2401 is finished. A tier 2 technician worked on it after hours. Create its invoice.',
          answer: 'INV-2401, total 270.91',
        },
        {
          request:
            'Price finished job J-4410, a plan member visit with two parts, and add its invoice.',
          answer: 'INV-4410, total 486.20',
        },
        {
          request: 'Price finished job J-4412, an after-hours callout, and add its invoice.',
          answer: 'INV-4412, total 1,284.50',
        },
      ],
    },
    {
      id: 'overdue',
      label: 'Overdue balances',
      description: 'Find who owes money after partial payments',
      counts: { calibration: 4, train: 20, dev: 14, test: 20 },
      examples: [
        {
          request: 'Which customers are more than 30 days overdue after partial payments?',
          answer: '3 customers, 2,915.00 in all',
        },
        {
          request: "What is Oakridge Dental's oldest unpaid balance?",
          answer: '640.00, due Aug 14',
        },
        {
          request: 'How much does Ironwood Fitness Studio owe past its due date?',
          answer: '256.48',
        },
      ],
    },
    {
      id: 'scheduling',
      label: 'Scheduling',
      description: 'Book the earliest technician who can do the job',
      counts: { calibration: 3, train: 20, dev: 13, test: 20 },
      examples: [
        {
          request:
            'Book the earliest licensed electrician for an urgent panel repair at 14 Alder St, zone C.',
          answer: 'Wed 09:30, Priya N.',
        },
        {
          request: 'Book the earliest plumber for a burst pipe at 9 Birch Ln, zone B.',
          answer: 'Thu 10:00, Omar K.',
        },
        {
          request: 'Book the next heating technician for a furnace that will not start, zone A.',
          answer: 'Wed 08:00, Marcus O.',
        },
      ],
    },
  ],
  unresolved: [],
  notes: [],
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

/** Ollama running with Glimmer's 4-bit build, the model the story's job runs on, downloaded. */
export const FLOW_LOCAL: LocalRuntimes = {
  ...LOCAL_WITH_GLIMMER,
  ollama: {
    ...LOCAL_WITH_GLIMMER.ollama,
    models: [{ id: 'muse-glimmer:30b', sizeBytes: GLIMMER_BYTES }],
  },
};

/** The online copy answering when a run asks before it starts. */
export const COPY_ANSWERS: ConnectionTest = {
  ok: true,
  latencyMs: 180,
  detail: 'Connected to OpenRouter. meta/muse-glimmer-30b is available.',
};

/** Replies that never change during the walk; the rest are stubbed by the helpers below. */
export const FLOW_ENGINE: EngineReplies = {
  ...STORY_EVIDENCE,
  'connections:detectLocal': FLOW_LOCAL,
  'connections:testStudent': COPY_ANSWERS,
  'files:pick': ATTACHED,
  // Each file attached reads.
  'files:check': ATTACHED.map(() => null),
  'jobs:draftStart': turns.start,
  'jobs:save': job,
  'jobs:get': job,
  'jobs:list': summaries,
  'jobs:taskPlan': taskPlan,
  'secrets:status': { meta: true, openrouter: true },
  'runs:get': detail,
  'runs:trace': trace,
  'runs:roundDiff': roundDiff,
  'runs:list': runs,
  'graduates:list': [graduate],
  'graduates:hasSampleAgent': false,
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
    currentVersion: 5,
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
        harnessVersion: 5,
        check: { pass: true, reason: 'Feasible, and the earliest start.' },
        latencyMs: 12_300,
        usage: { inputTokens: 8_900, outputTokens: 402 },
        answerSummary: 'Thu 10:00, Omar K.',
      },
      prompt: 'Book the earliest plumber for a burst pipe at 9 Birch Ln, zone B.',
    },
  ];
}

/** A practice task of the story's later rounds, answered with the harness kept so far. */
interface Practice {
  type: 'invoice' | 'overdue' | 'scheduling';
  pass: boolean;
  prompt: string;
  reason: string;
}

/**
 * Round 5's practice tasks after its first, in the order they are answered. Each one it misses
 * books a technician without the license the call needs, the cause round 5's change is made from.
 */
const PRACTICE: Practice[] = [
  {
    type: 'invoice',
    pass: true,
    prompt: 'Price finished job J-4418 and add its invoice.',
    reason: 'Line items and total match.',
  },
  {
    type: 'overdue',
    pass: true,
    prompt: 'Who owes more than $500 after their last partial payment?',
    reason: 'Customers and amounts match.',
  },
  {
    type: 'scheduling',
    pass: false,
    prompt: 'Book the earliest gas-licensed technician for a leak at 22 Fern Rd, zone B.',
    reason: 'Marcus O. holds no gas license; Omar K. is the earliest licensed one, at 11:00.',
  },
  {
    type: 'invoice',
    pass: true,
    prompt: 'Price finished job J-4421, a two-visit repair, and add its invoice.',
    reason: 'Both visits are priced and the total matches.',
  },
  {
    type: 'scheduling',
    pass: true,
    prompt: 'Book the next electrician for a tripped main breaker at 3 Elm Ct, zone A.',
    reason: 'Feasible, and the earliest start.',
  },
  {
    type: 'scheduling',
    pass: false,
    prompt: 'Book an electrician for a sparking outlet at 5 Pine St, zone A.',
    reason: 'Omar K. holds no electrical license; Marcus O. is the earliest licensed one, at 10:30.',
  },
  {
    type: 'invoice',
    pass: true,
    prompt: 'Price finished job J-4424 and add its invoice.',
    reason: 'Line items and total match.',
  },
  {
    type: 'scheduling',
    pass: true,
    prompt: 'Book the earliest plumber for a blocked drain at 40 Ash Way, zone C.',
    reason: 'Feasible, and the earliest start.',
  },
  {
    type: 'invoice',
    pass: true,
    prompt: 'Price finished job J-4426, parts only, and add its invoice.',
    reason: 'Line items and total match.',
  },
  {
    type: 'overdue',
    pass: true,
    prompt: 'What is the balance of Harbor Bakery after the Oct 12 payment?',
    reason: 'Balance matches.',
  },
  {
    type: 'scheduling',
    pass: false,
    prompt: "Book a gas technician for a boiler that won't light at 8 Oak Pl, zone C.",
    reason: 'Marcus O. holds no gas license; Omar K. is the earliest licensed one, at 14:00.',
  },
];

/** A later round of the story: what it tried and what it measured. */
interface LaterRound {
  index: number;
  title: string;
  diagnosis: string;
  files: string[];
  predicted: [number, number];
  /** Practice tasks right, of 12. */
  train: number;
  /** Check tasks before and after, of 40. */
  first: [number, number];
  /** A kept change is measured again on new seeds, both runs added up, of 80. */
  again?: [number, number];
  /** The practice task it missed that shows the cause, for a round whose tasks aren't each listed. */
  miss?: Practice;
}

const LATER: LaterRound[] = [
  {
    index: 5,
    title: 'Check licenses before booking',
    diagnosis:
      'It books the earliest free technician without checking the license the job needs, so ' +
      'gas and electrical calls go to whoever is nearest.',
    files: ['skills/book-urgent-calls/SKILL.md'],
    predicted: [2, 4],
    train: 9,
    first: [34, 33],
  },
  {
    index: 6,
    title: 'Apply payments oldest invoice first',
    diagnosis:
      'Partial payments are set against the newest invoice, so older balances look paid and ' +
      'overdue customers are missed.',
    files: ['AGENTS.md'],
    predicted: [1, 3],
    train: 10,
    first: [34, 35],
    miss: {
      type: 'overdue',
      pass: false,
      prompt: 'Which customers are more than 60 days overdue after partial payments?',
      reason: 'Sets the Sep 30 payment against the newest invoice, so Linden Cafe looks paid.',
    },
  },
  {
    index: 7,
    title: 'Say when no slot is reachable',
    diagnosis:
      'When no licensed technician can arrive in time it still books the nearest slot instead ' +
      'of saying the call cannot be met.',
    files: ['skills/book-urgent-calls/SKILL.md'],
    predicted: [2, 5],
    train: 10,
    first: [34, 37],
    again: [68, 72],
    miss: {
      type: 'scheduling',
      pass: false,
      prompt: 'Book a heating technician for a cold radiator at 8 Oak Pl, zone C, before noon.',
      reason:
        'Books Marcus O. at 12:30; nobody licensed reaches zone C before noon, so it should say so.',
    },
  },
];

/** Spark's spend and the clock when each later round starts, and when training ends. */
const LATER_TOTALS = [
  { mentorUsd: 0.23, minutes: 130 },
  { mentorUsd: 0.29, minutes: 154 },
  { mentorUsd: 0.35, minutes: 177 },
  { mentorUsd: 0.41, minutes: 201 },
];

function practiceAttempt(task: Practice, index: number, roundIndex = 5): RunEvent {
  const id = `${String(roundIndex).padStart(2, '0')}${String(index + 2).padStart(2, '0')}`;
  return {
    runId: FLOW.runId,
    at: at(130 + index * 2),
    type: 'attempt.finished',
    attempt: {
      id: `att_${id}`,
      runId: FLOW.runId,
      round: roundIndex,
      taskId: `task_att_${id}`,
      taskType: task.type,
      split: 'train',
      // Rounds 5 and 6 keep nothing, so every later round practices with round 4's harness.
      harnessVersion: 5,
      check: { pass: task.pass, reason: task.reason },
      latencyMs: 11_000 + index * 420,
      usage: { inputTokens: 8_700, outputTokens: 390 },
    },
    prompt: task.prompt,
  };
}

/** Passes of one run of the 40 check tasks, type by type: 14 invoices, 13 of each other type. */
function byType(pass: number): { type: string; pass: number; total: number }[] {
  const totals = [
    ['invoice', 14],
    ['overdue', 13],
    ['scheduling', 13],
  ] as const;
  let left = pass;
  return totals.map(([type, total], index) => {
    const share = index === totals.length - 1 ? left : Math.round((pass * total) / 40);
    left -= share;
    return { type, pass: share, total };
  });
}

function decisionReason(later: LaterRound): string {
  const [before, after] = later.first;
  const first = `Dev ${before}/40 → ${after}/40`;
  if (later.again) {
    const [b, a] = later.again;
    return `${first}, measured again on new seeds: ${b}/80 → ${a}/80 over 2 runs, no type lost more than two`;
  }
  return after < before ? `${first}, down ${before - after}` : `${first}, no gain to keep`;
}

/** One later round's steps: started (but round 5, already under way), diagnosed, scored, decided. */
function laterRound(later: LaterRound, position: number): RunEvent[][] {
  const start = LATER_TOTALS[position] ?? { mentorUsd: 0.41, minutes: 201 };
  const end = LATER_TOTALS[position + 1] ?? start;
  const minutes = (share: number) =>
    Math.round(start.minutes + (end.minutes - start.minutes) * share);
  const event = { runId: FLOW.runId, at: at(start.minutes) };
  const run = (phase: Run['phase'], share: number, overrides: Partial<Run> = {}) =>
    progressed({
      phase,
      updatedAt: at(minutes(share)),
      totals: {
        ...makeRun({}).totals,
        rounds: later.index,
        mentorUsd: share === 1 ? end.mentorUsd : start.mentorUsd,
        wallMs: minutes(share) * 60_000,
      },
      ...overrides,
    });
  const shell = round(later.index, {
    status: 'attempting',
    train: { pass: 0, total: 0 },
    startedAt: at(start.minutes),
  });
  const practiced: Round = {
    ...shell,
    status: 'diagnosing',
    train: { pass: later.train, total: 12 },
  };
  const proposed: Round = {
    ...practiced,
    status: 'evaluating',
    title: later.title,
    diagnosis: later.diagnosis,
    files: later.files,
    predicted: {
      devDeltaMin: later.predicted[0],
      devDeltaMax: later.predicted[1],
      rationale: 'The failures it was made from share this cause.',
    },
    candidateVersion: later.index + 1,
  };
  const [before, after] = later.first;
  const devBefore = later.again ? { pass: later.again[0], total: 80 } : { pass: before, total: 40 };
  const devAfter = later.again ? { pass: later.again[1], total: 80 } : { pass: after, total: 40 };
  const decided: Round = {
    ...proposed,
    status: 'decided',
    devBefore,
    devAfter,
    ...(later.again
      ? {
          firstMeasurement: {
            devBefore: { pass: before, total: 40 },
            devAfter: { pass: after, total: 40 },
          },
        }
      : {}),
    decision: later.again ? 'kept' : 'reverted',
    decisionReason: decisionReason(later),
    endedAt: at(end.minutes),
  };
  const started: RunEvent[] = [
    { ...event, type: 'round.updated', round: shell },
    { ...event, type: 'run.updated', run: run('attempting', 0) },
    ...(later.miss ? [practiceAttempt(later.miss, 0, later.index)] : []),
  ];
  return [
    ...(position === 0 ? [] : [started]),
    [
      { ...event, type: 'round.updated', round: practiced },
      { ...event, type: 'run.updated', run: run('diagnosing', 0.4) },
      { ...event, type: 'mentor.started', round: later.index },
    ],
    [
      {
        ...event,
        type: 'mentor.finished',
        round: later.index,
        usage: { inputTokens: 18_000, outputTokens: 3_400 },
        costUsd: 0.06,
      },
      { ...event, type: 'round.updated', round: proposed },
      { ...event, type: 'run.updated', run: run('evaluating', 0.6) },
    ],
    ...[10, 20, 30, 40].map((done): RunEvent[] => [
      {
        ...event,
        type: 'eval.progress',
        split: 'dev',
        harnessVersion: later.index + 1,
        done,
        total: 40,
        pass: Math.round((after * done) / 40),
      },
    ]),
    [
      {
        ...event,
        type: 'eval.finished',
        split: 'dev',
        harnessVersion: later.index + 1,
        score: { pass: after, total: 40 },
        perType: byType(after),
      },
      { ...event, type: 'round.updated', round: decided },
      {
        ...event,
        type: 'run.updated',
        run: run('evaluating', 1, {
          ...(later.again ? { currentVersion: later.index + 1, devCurrent: devAfter } : {}),
        }),
      },
    ],
  ];
}

/**
 * Rounds 5 to 7 as the training view receives them after round 4 is kept: round 5's practice
 * tasks one by one, then each round diagnosed, scored and decided, so training ends at 72 of 80
 * as the report says. Each step comes `gapMs` after the one before.
 */
export function laterRounds(gapMs = 450): [number, RunEvent[]][] {
  const steps: RunEvent[][] = [
    ...PRACTICE.map((task, index) => [practiceAttempt(task, index)]),
    ...LATER.flatMap((later, position) => laterRound(later, position)),
  ];
  return steps.map((events, index) => [(index + 1) * gapMs, events]);
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
