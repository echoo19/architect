import type {
  AgentBlock,
  AgentStep,
  ConnectionTest,
  GraduateSettings,
  GraduateSummary,
  Job,
  OllamaStatus,
  PullProgress,
  ReportCard,
  TypeResult,
  WorkspaceChat,
  WorkspaceEvent,
  WorkspaceMessage,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';

/*
 * A stand-in engine for the workspace and first-run tests. It runs in the main process and
 * keeps state, so a chat read after an event already has that event in it, as with the real
 * agent host. The data follows the sample job (DECISIONS.md 005).
 */

const AT = '2026-10-27T15:00:00.000Z';
export const GB = 1024 ** 3;
export const STUDENT_MODEL = 'muse-glimmer:30b';

const perType: TypeResult[] = [
  { type: 'invoice', label: 'Price a finished job', pass: 19, total: 20, refused: false },
  { type: 'overdue', label: 'Who owes us money?', pass: 20, total: 20, refused: false },
  { type: 'scheduling', label: 'Book the next free slot', pass: 16, total: 20, refused: false },
  { type: 'refunds', label: 'Refunds', pass: 0, total: 4, refused: true },
];

export const AGENT: GraduateSummary = {
  id: 'grd_desk',
  name: 'Service desk',
  path: 'graduates/service-desk',
  manifest: {
    format: 1,
    id: 'grd_desk',
    name: 'Service desk',
    jobId: 'job_desk',
    runId: 'run_desk',
    method: 'architect',
    createdAt: AT,
    acceptedAt: AT,
    student: {
      label: 'Glimmer',
      runtime: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: STUDENT_MODEL,
      quantization: 'Q4_K_M',
      sizeBytes: 18 * GB,
      contextLength: 16_384,
    },
    harness: { version: 4, hash: 'sha256-desk-v4' },
    requirements: { passRate: { target: 0.85, actual: 0.86, met: true } },
    test: { score: { pass: 55, total: 64 }, perType },
    mentor: { label: 'Muse Spark 1.3', model: 'muse-spark-1.3' },
  },
};

const JOB: Job = {
  format: 1,
  id: 'job_desk',
  name: 'Service desk',
  description: 'Closes out the day for Ferncliff Home Services.',
  summary: 'Prices finished jobs, chases overdue balances and books the next urgent call.',
  does: ['Prices a finished job from the rate card'],
  doesNot: ['Issues refunds'],
  createdAt: AT,
  taskTypes: [
    { id: 'invoice', label: 'Price a finished job' },
    { id: 'overdue', label: 'Who owes us money?' },
    { id: 'scheduling', label: 'Book the next free slot' },
  ],
  data: {
    files: [
      { name: 'jobs.csv', kind: 'table', access: 'read' },
      { name: 'invoices.csv', kind: 'table', access: 'write' },
      { name: 'bookings.csv', kind: 'table', access: 'write' },
      { name: 'policy.md', kind: 'text', access: 'read' },
    ],
  },
  permissions: { writes: 'ask', unseenFiles: 'ask' },
  checker: { kind: 'builtin' },
  requirements: { passRate: 0.85, p95LatencyMs: 8000 },
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
      model: STUDENT_MODEL,
      contextLength: 16_384,
    },
    trainOn: 'local',
  },
  startingHarness: { kind: 'blank' },
  splits: { seed: 7, calibration: 10, train: 60, dev: 40, test: 64 },
  evaluation: { trainBatch: 12, minDevGain: 2, maxTypeRegression: 1, devRepeats: 1, patience: 3 },
};

const REPORT: ReportCard = {
  jobId: 'job_desk',
  runId: 'run_desk',
  method: 'architect',
  name: 'Service desk',
  createdAt: AT,
  student: { label: 'Glimmer', model: STUDENT_MODEL, runtime: 'ollama' },
  testedOn: 'local',
  mentor: { label: 'Muse Spark 1.3', model: 'muse-spark-1.3' },
  test: {
    score: { pass: 55, total: 64 },
    perType,
    latencyMs: { p50: 4200, p95: 7600 },
    refusals: 4,
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
      reason: 'The office files have no refund policy to follow, so it leaves refunds to you.',
    },
  ],
  topInterventions: [],
  requirements: { passRate: { target: 0.85, actual: 0.86, met: true } },
  overclaim: false,
};

function chat(id: string, title: string, patch: Partial<WorkspaceChat> = {}): WorkspaceChat {
  return {
    id,
    graduateId: AGENT.id,
    title,
    createdAt: AT,
    updatedAt: AT,
    running: false,
    waiting: false,
    ...patch,
  };
}

export const CHATS = {
  fresh: chat('cht_new', 'New chat', { updatedAt: '2026-10-27T16:30:00.000Z' }),
  closeout: chat('cht_closeout', 'Close out Tuesday', { updatedAt: '2026-10-27T16:10:00.000Z' }),
  approvals: chat('cht_book', 'Invoice and book Alder St', { waiting: true }),
  refund: chat('cht_refund', 'Refund the 4412 trip fee'),
};

function message(
  id: string,
  chatId: string,
  role: WorkspaceMessage['role'],
  patch: Partial<WorkspaceMessage> = {},
): WorkspaceMessage {
  return {
    id,
    chatId,
    role,
    createdAt: AT,
    text: '',
    steps: [],
    blocks: [],
    status: 'done',
    ...patch,
  };
}

function step(
  id: string,
  name: string,
  detail: string,
  meta?: string,
  status: AgentStep['status'] = 'done',
): AgentStep {
  return { id, kind: 'tool', name, detail, status, ...(meta === undefined ? {} : { meta }) };
}

const approval = (
  changeId: string,
  file: string,
  summary: string,
  columns: string[],
  added: (string | number)[][],
): AgentBlock => ({
  kind: 'approval',
  changeId,
  op: 'append',
  file,
  summary,
  diff: { columns, added, removed: [], changed: [] },
  status: 'pending',
});

export const MESSAGES: WorkspaceMessage[] = [
  message('msg_close_1', CHATS.closeout.id, 'user', {
    text: 'Who still owes us money from September?',
  }),
  message('msg_close_2', CHATS.closeout.id, 'agent', {
    text: 'Three customers, $2,914.75 in total. The oldest is the Okafor invoice from Sep 3.',
    steps: [step('s1', 'read_table', 'invoices.csv', '412 rows')],
    workedMs: 2100,
  }),
  message('msg_book_1', CHATS.approvals.id, 'user', {
    text: 'Invoice both jobs Dana finished and book the Alder St leak for tomorrow morning.',
  }),
  message('msg_book_2', CHATS.approvals.id, 'agent', {
    text: 'Both invoices are ready, and Priya has the earliest plumbing slot tomorrow. I need your go-ahead before I write anything.',
    steps: [
      step('s1', 'read_table', 'jobs.csv', '2 rows'),
      step('s2', 'invoice_total', 'job 4410', '$486.20'),
      step('s3', 'invoice_total', 'job 4412', '$1,284.50'),
      step('s4', 'earliest_slot', 'plumbing, zone 3', 'Wed 8:00'),
    ],
    blocks: [
      approval(
        'chg_invoices',
        'invoices.csv',
        'Append 2 rows to invoices.csv',
        ['invoice', 'job', 'customer', 'total'],
        [
          ['INV-1043', 4410, 'Okafor', '$486.20'],
          ['INV-1044', 4412, 'Lindqvist', '$1,284.50'],
        ],
      ),
      approval(
        'chg_booking',
        'bookings.csv',
        'Append 1 row to bookings.csv',
        ['booking', 'technician', 'start', 'zone'],
        [['BK-2207', 'Priya Raman', 'Wed 8:00', 3]],
      ),
    ],
    workedMs: 4100,
  }),
  message('msg_refund_1', CHATS.refund.id, 'user', {
    text: 'Refund the $120 trip fee on job 4412.',
  }),
  message('msg_refund_2', CHATS.refund.id, 'agent', {
    blocks: [
      {
        kind: 'refusal',
        taskType: 'refunds',
        reason: 'The office files have no refund policy to follow, so it leaves refunds to you.',
      },
    ],
  }),
];

/** The reply to "Price the two jobs Dana finished today", as it streams in. */
export function pricingReply(stage: 'started' | 'working' | 'writing' | 'done'): WorkspaceMessage {
  const steps = [
    step('p1', 'read_table', 'jobs.csv', '2 rows'),
    { ...step('p2', 'load_skill', 'price-a-job'), kind: 'skill' as const },
    step('p3', 'invoice_total', 'job 4410', '$486.20'),
    step('p4', 'invoice_total', 'job 4412', '$1,284.50'),
  ];
  const text =
    'Job 4410 comes to **$486.20** and job 4412 to **$1,284.50**.\n\n' +
    '- 4412 ran after hours, so labor is billed at 1.5x.\n' +
    '- The customer on 4412 is a plan member, so 10% comes off before tax.\n\n' +
    "Here's how each total breaks down:";
  const base = { createdAt: AT, status: 'streaming' as const };
  switch (stage) {
    case 'started':
      return message('msg_reply', CHATS.fresh.id, 'agent', {
        ...base,
        steps: [{ ...steps[0]!, status: 'running', meta: undefined }],
      });
    case 'working':
      return message('msg_reply', CHATS.fresh.id, 'agent', {
        ...base,
        steps: [steps[0]!, steps[1]!, { ...steps[2]!, status: 'running', meta: undefined }],
      });
    case 'writing':
      return message('msg_reply', CHATS.fresh.id, 'agent', {
        ...base,
        steps,
        text: text.slice(0, 64),
      });
    case 'done':
      return message('msg_reply', CHATS.fresh.id, 'agent', {
        steps,
        text,
        workedMs: 3200,
        blocks: [
          {
            kind: 'table',
            title: 'Price breakdown',
            columns: ['Item', 'Job 4410', 'Job 4412'],
            rows: [
              ['Labor', '$280.00', '$810.00'],
              ['Parts', '$142.50', '$497.98'],
              ['Trip fee', '$35.00', '$35.00'],
              ['Plan discount', '', '−$134.30'],
              ['Tax', '$28.70', '$75.82'],
              ['Total', '$486.20', '$1,284.50'],
            ],
          },
        ],
      });
  }
}

export interface EngineSeed {
  graduates: GraduateSummary[];
  chats: WorkspaceChat[];
  messages: WorkspaceMessage[];
  graduateSettings: GraduateSettings;
  job: Job;
  report: ReportCard;
  ollama: OllamaStatus;
  connection: ConnectionTest;
  /** What the folder picker returns. */
  folder: string;
}

export function engineSeed(patch: Partial<EngineSeed> = {}): EngineSeed {
  return {
    graduates: [AGENT],
    chats: Object.values(CHATS),
    messages: MESSAGES,
    graduateSettings: { writeMode: 'ask' },
    job: JOB,
    report: REPORT,
    ollama: { running: true, version: '0.12.6', models: [] },
    connection: { ok: true, latencyMs: 640, detail: 'muse-spark-1.3' },
    folder: 'C:\\Users\\dana\\Exports',
    ...patch,
  };
}

/**
 * Answers the engine's channels from a seed. Calls are recorded; key values sent to
 * `secrets.set` are not.
 */
export async function installFakeEngine(app: ElectronApplication, seed: EngineSeed): Promise<void> {
  await app.evaluate(({ BrowserWindow, ipcMain }, seed) => {
    type Message = (typeof seed.messages)[number];
    type Chat = (typeof seed.chats)[number];
    type Event =
      { type: 'message.updated'; message: Message } | { type: 'chat.updated'; chat: Chat };

    const calls: { channel: string; args: unknown[] }[] = [];
    const chats = seed.chats.map((item) => ({ ...item }));
    const messages = seed.messages.map((item) => ({ ...item }));
    const ollama = { ...seed.ollama, models: [...seed.ollama.models] };
    const secrets: Record<string, boolean> = {};
    let settings = { ...seed.graduateSettings };
    let finishPull: (() => void) | undefined;
    let sent = 0;

    const broadcast = (channel: string, payload: unknown) => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload);
    };
    const apply = (event: Event) => {
      if (event.type === 'message.updated') {
        const index = messages.findIndex((item) => item.id === event.message.id);
        if (index === -1) messages.push(event.message);
        else messages[index] = event.message;
      } else {
        const index = chats.findIndex((item) => item.id === event.chat.id);
        if (index === -1) chats.unshift(event.chat);
        else chats[index] = event.chat;
      }
      broadcast('workspace:onEvent', event);
    };
    const handle = (channel: string, reply: (...args: never[]) => unknown) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
        calls.push({ channel, args: channel === 'secrets:set' ? args.slice(0, 1) : args });
        try {
          return { ok: true, value: await reply(...(args as never[])) };
        } catch (error) {
          return {
            ok: false,
            error: { message: error instanceof Error ? error.message : 'Failed' },
          };
        }
      });
    };
    const chatOf = (chatId: string) => {
      const found = chats.find((item) => item.id === chatId);
      if (!found) throw new Error(`No chat ${chatId}.`);
      return found;
    };

    handle('graduates:list', () => seed.graduates);
    handle('graduates:settings', () => settings);
    handle('graduates:updateSettings', (_id: string, patch: Partial<typeof settings>) => {
      settings = { ...settings, ...patch };
      return settings;
    });
    handle('graduates:exportFolder', () => undefined);
    handle('graduates:remove', () => undefined);
    handle('jobs:list', () => []);
    handle('jobs:get', () => seed.job);
    handle('reports:get', () => seed.report);
    handle('files:pick', () => [seed.folder]);
    handle('workspace:listChats', (graduateId: string) =>
      chats.filter((item) => item.graduateId === graduateId),
    );
    handle('workspace:messages', (chatId: string) =>
      messages.filter((item) => item.chatId === chatId),
    );
    handle('workspace:send', (chatId: string, text: string) => {
      sent += 1;
      const at = new Date().toISOString();
      apply({
        type: 'message.updated',
        message: {
          id: `msg_sent_${sent}`,
          chatId,
          role: 'user',
          createdAt: at,
          text,
          steps: [],
          blocks: [],
          status: 'done',
        },
      });
      const current = chatOf(chatId);
      const title =
        current.title === 'New chat' ? text.split(' ').slice(0, 6).join(' ') : current.title;
      apply({ type: 'chat.updated', chat: { ...current, title, running: true, updatedAt: at } });
    });
    handle('workspace:stop', (chatId: string) => {
      apply({ type: 'chat.updated', chat: { ...chatOf(chatId), running: false } });
    });
    handle('workspace:decide', (changeId: string, decision: string) => {
      const owner = messages.find((item) =>
        item.blocks.some((block) => block.kind === 'approval' && block.changeId === changeId),
      );
      if (!owner) throw new Error(`No change ${changeId}.`);
      const status = decision === 'deny' ? ('denied' as const) : ('approved' as const);
      apply({
        type: 'message.updated',
        message: {
          ...owner,
          blocks: owner.blocks.map((block) =>
            block.kind === 'approval' && block.changeId === changeId ? { ...block, status } : block,
          ),
        },
      });
      if (decision === 'always') settings = { ...settings, writeMode: 'allow' };
    });
    handle('ollama:status', () => ollama);
    handle(
      'ollama:pull',
      (model: string) =>
        new Promise<void>((resolve) => {
          finishPull = () => {
            ollama.models.push({
              name: model,
              sizeBytes: 18 * 1024 ** 3,
              digest: 'sha256-glimmer',
            });
            resolve();
          };
        }),
    );
    handle('secrets:status', () => ({ ...secrets }));
    handle('secrets:set', (ref: string) => {
      secrets[ref] = true;
    });
    handle('connections:testMentor', () => seed.connection);

    const updateChat = (chatId: string, patch: Partial<Chat>) =>
      apply({ type: 'chat.updated', chat: { ...chatOf(chatId), ...patch } });

    Object.assign(globalThis, {
      fakeEngine: { apply, broadcast, calls, updateChat, finishPull: () => finishPull?.() },
    });
  }, seed);
}

interface FakeEngineHandle {
  apply: (event: unknown) => void;
  broadcast: (channel: string, payload: unknown) => void;
  calls: { channel: string; args: unknown[] }[];
  updateChat: (chatId: string, patch: Partial<WorkspaceChat>) => void;
  finishPull: () => void;
}

/** Changes a stored chat, e.g. to end a turn, and sends the update. */
export async function updateChat(
  app: ElectronApplication,
  chatId: string,
  patch: Partial<WorkspaceChat>,
): Promise<void> {
  await app.evaluate(
    (_electron, { chatId, patch }) => {
      (globalThis as unknown as { fakeEngine: FakeEngineHandle }).fakeEngine.updateChat(
        chatId,
        patch,
      );
    },
    { chatId, patch },
  );
}

/** Sends a workspace event, as the agent host would, and keeps the fake engine's state in step. */
export async function emitWorkspace(
  app: ElectronApplication,
  event: WorkspaceEvent,
): Promise<void> {
  await app.evaluate((_electron, event) => {
    (globalThis as unknown as { fakeEngine: FakeEngineHandle }).fakeEngine.apply(event);
  }, event);
}

export async function emitPullProgress(
  app: ElectronApplication,
  progress: PullProgress,
): Promise<void> {
  await app.evaluate((_electron, progress) => {
    (globalThis as unknown as { fakeEngine: FakeEngineHandle }).fakeEngine.broadcast(
      'ollama:onPullProgress',
      progress,
    );
  }, progress);
}

/** Ends the running download: `ollama.pull` resolves and the model shows as installed. */
export async function finishPull(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    (globalThis as unknown as { fakeEngine: FakeEngineHandle }).fakeEngine.finishPull();
  });
}

/** The arguments of every call the renderer made on a channel. */
export function callsTo(app: ElectronApplication, channel: string): Promise<unknown[][]> {
  return app.evaluate(
    (_electron, channel) =>
      (globalThis as unknown as { fakeEngine: FakeEngineHandle }).fakeEngine.calls
        .filter((call) => call.channel === channel)
        .map((call) => call.args),
    channel,
  );
}
