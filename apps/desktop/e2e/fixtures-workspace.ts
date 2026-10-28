import {
  GLIMMER_BUILDS,
  type AgentBlock,
  type AgentStep,
  type ConnectionTest,
  type GpuInfo,
  type GraduateSettings,
  type GraduateSummary,
  type GraduateVersion,
  type Installation,
  type Job,
  type OllamaStatus,
  type PullProgress,
  type ReportCard,
  type StepView,
  type WorkspaceChat,
  type WorkspaceEvent,
  type WorkspaceMessage,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { installation, STORY_VERSION } from './fixtures-versions';
import { AT, graduate, job, storyReport } from './story';

/*
 * A stand-in engine for the workspace and first-run tests. It runs in the main process and
 * keeps state, so a chat read after an event already has that event in it, as with the real
 * agent host. The graduate is the one the shared story trains (story.ts).
 */

export const GB = 1024 ** 3;
export const STUDENT_MODEL = 'muse-glimmer:30b';

export const AGENT = graduate;

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
  approvals: chat('cht_book', 'Invoice and book Cedar Ave', { running: true, waiting: true }),
  refund: chat('cht_refund', 'Refund the J-4473 trip fee'),
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
  view?: StepView,
): AgentStep {
  return {
    id,
    kind: 'tool',
    name,
    detail,
    status,
    ...(meta === undefined ? {} : { meta }),
    ...(view === undefined ? {} : { view }),
  };
}

/** Rows the agent asks to add to a table, waiting for an answer. */
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

/** The code the agent ran over the invoices to find September's open balances. */
const SEPTEMBER_CODE = [
  "const invoices = csv.parse(files.read('data/invoices.csv'));",
  'invoices',
  "  .filter((row) => row.due_date.startsWith('2026-09') && row.paid_cents !== row.total_cents)",
  '  .map((row) => ({',
  '    invoice: row.invoice_id,',
  '    customer: row.customer,',
  '    open_cents: Number(row.total_cents) - Number(row.paid_cents),',
  '  }))',
].join('\n');

const SEPTEMBER_OUTPUT =
  '=> [{"invoice":"INV-3018","customer":"Okafor","open_cents":118000},' +
  '{"invoice":"INV-3024","customer":"Brennan","open_cents":96500},' +
  '{"invoice":"INV-3051","customer":"Achebe","open_cents":77000}]';

/** A visit note the agent drafted for the technician: a new file in its output folder. */
const VISIT_NOTE = [
  '--- /dev/null',
  '+++ b/output/visit-notes/B-3051.md',
  '@@ -0,0 +1,6 @@',
  '+# B-3051: panel repair, 8 Cedar Ave',
  '+Thursday 10:00, Marcus O.',
  '+',
  '+- The main breaker trips under load.',
  '+- Bring a 200 A panel kit; the 2019 permit is on file.',
  '+- Call ahead: the side gate is locked.',
  '',
].join('\n');

export const MESSAGES: WorkspaceMessage[] = [
  message('msg_close_1', CHATS.closeout.id, 'user', {
    text: 'Who still owes us money from September?',
  }),
  message('msg_close_2', CHATS.closeout.id, 'agent', {
    text: 'Three customers, $2,915.00 in total. The oldest is the Okafor invoice from Sep 3.',
    steps: [
      step('s1', 'read', 'data/policy.md', '66 lines'),
      step('s2', 'run', 'data/invoices.csv', SEPTEMBER_OUTPUT.slice(0, 59) + '…', 'done', {
        kind: 'code',
        code: SEPTEMBER_CODE,
        output: SEPTEMBER_OUTPUT,
      }),
    ],
    workedMs: 96_000,
  }),
  message('msg_book_1', CHATS.approvals.id, 'user', {
    text: 'Invoice both jobs Dana finished, book the Cedar Ave panel repair for Thursday morning, and leave Marcus a note for the visit.',
  }),
  message('msg_book_2', CHATS.approvals.id, 'agent', {
    status: 'streaming',
    text: 'Both invoices are ready, Marcus O. has the earliest slot on Thursday at 10:00, and his visit note is drafted. I need your go-ahead before I save anything.',
    steps: [
      step('s1', 'grep', '/J-447[13]/ in data/jobs.csv', '2 matches'),
      step('s2', 'invoice_total', 'job J-4471', '$524.03'),
      step('s3', 'invoice_total', 'job J-4473', '$1,116.52'),
      step('s4', 'travel_minutes', 'zone C to zone C', '0 min'),
      step('s5', 'grep', '/2026-10-29/ in data/bookings.csv', '1 match'),
    ],
    blocks: [
      approval(
        'chg_invoices',
        'data/invoices.csv',
        'Add 2 rows to data/invoices.csv',
        ['invoice', 'job', 'customer', 'total'],
        [
          ['INV-4471', 'J-4471', 'Okafor', '$524.03'],
          ['INV-4473', 'J-4473', 'Lindqvist', '$1,116.52'],
        ],
      ),
      approval(
        'chg_booking',
        'data/bookings.csv',
        'Add 1 row to data/bookings.csv',
        ['booking', 'request', 'technician', 'start'],
        [['B-3051', 'Panel repair, 8 Cedar Ave', 'Marcus O.', 'Thu 10:00']],
      ),
      {
        kind: 'approval',
        changeId: 'chg_note',
        op: 'write',
        file: 'output/visit-notes/B-3051.md',
        summary: 'Create output/visit-notes/B-3051.md (6 lines)',
        patch: VISIT_NOTE,
        status: 'pending',
      },
    ],
  }),
  message('msg_refund_1', CHATS.refund.id, 'user', {
    text: 'Refund the $35 trip fee on job J-4473.',
  }),
  message('msg_refund_2', CHATS.refund.id, 'agent', {
    blocks: [
      {
        kind: 'refusal',
        taskType: 'refunds',
        reason: "Its job says it won't issue refunds or credits, so it leaves them to you.",
      },
    ],
  }),
];

/** The last lines of jobs.csv, where today's finished jobs are, as the agent read them. */
const TODAYS_JOBS: StepView = {
  kind: 'table',
  columns: ['job_id', 'customer', 'technician', 'finished_on', 'labor_minutes', 'after_hours'],
  rows: [
    ['J-4469', 'Brennan', 'T-02', '2026-10-27', '95', 'no'],
    ['J-4470', 'Achebe', 'T-09', '2026-10-27', '60', 'no'],
    ['J-4471', 'Okafor', 'T-04', '2026-10-27', '120', 'no'],
    ['J-4472', 'Varga', 'T-11', '2026-10-27', '45', 'no'],
    ['J-4473', 'Lindqvist', 'T-04', '2026-10-27', '240', 'yes'],
  ],
  total: 1505,
};

/** Dana's row of technicians.csv, which sets her labor rate. */
const DANA: Extract<StepView, { kind: 'code' }> = {
  kind: 'code',
  code: [
    "const technicians = csv.parse(files.read('data/technicians.csv'));",
    "technicians.find((tech) => tech.technician_id === 'T-04')",
  ].join('\n'),
  output: '=> {"technician_id":"T-04","name":"Dana R.","tier":"lead","zone":"B"}',
};

/** The reply to "Price the two jobs Dana finished today", as it streams in. */
export function pricingReply(stage: 'started' | 'working' | 'writing' | 'done'): WorkspaceMessage {
  const steps = [
    step('p1', 'read', 'data/jobs.csv', 'rows 1,501-1,505 of 1,505', 'done', TODAYS_JOBS),
    step('p2', 'run', 'data/technicians.csv', DANA.output.slice(0, 59) + '…', 'done', DANA),
    { ...step('p3', 'price-a-job', 'price-a-job', '18 lines'), kind: 'skill' as const },
    step('p4', 'invoice_total', 'job J-4471', '$524.03'),
    step('p5', 'invoice_total', 'job J-4473', '$1,116.52'),
  ];
  const text =
    'Job J-4471 comes to **$524.03** and job J-4473 to **$1,116.52**.\n\n' +
    '- J-4473 ran after hours, so labor is billed at 1.5x.\n' +
    '- The customer on J-4473 is a plan member, so 10% comes off before tax.\n\n' +
    "Here's how each total breaks down:";
  const base = { createdAt: AT, status: 'streaming' as const };
  switch (stage) {
    case 'started':
      return message('msg_reply', CHATS.fresh.id, 'agent', {
        ...base,
        steps: [{ ...steps[0]!, status: 'running', meta: undefined, view: undefined }],
      });
    case 'working':
      return message('msg_reply', CHATS.fresh.id, 'agent', {
        ...base,
        steps: [
          steps[0]!,
          steps[1]!,
          steps[2]!,
          { ...steps[3]!, status: 'running', meta: undefined },
        ],
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
        workedMs: 141_000,
        blocks: [
          {
            kind: 'table',
            title: 'Price breakdown',
            columns: ['Item', 'Job J-4471', 'Job J-4473'],
            rows: [
              ['Labor', '$300.00', '$720.00'],
              ['Parts', '$158.20', '$412.60'],
              ['Trip fee', '$35.00', '$35.00'],
              ['Plan discount', '$0.00', '−$116.76'],
              ['Tax', '$30.83', '$65.68'],
              ['Total', '$524.03', '$1,116.52'],
            ],
          },
        ],
      });
  }
}

export interface EngineSeed {
  graduates: GraduateSummary[];
  /** The agent's versions, for its settings. */
  versions: GraduateVersion[];
  /** This computer's installation of the agent, with its install checks. */
  installation: Installation;
  chats: WorkspaceChat[];
  messages: WorkspaceMessage[];
  graduateSettings: GraduateSettings;
  job: Job;
  report: ReportCard;
  ollama: OllamaStatus;
  /** This computer's GPU, as `connections.detectLocal` reports it. */
  gpu: GpuInfo | null;
  /** The model each of Glimmer's builds installs as. */
  builds: Record<string, string>;
  connection: ConnectionTest;
  /** What the folder picker returns. */
  folder: string;
}

export function engineSeed(patch: Partial<EngineSeed> = {}): EngineSeed {
  return {
    graduates: [AGENT],
    versions: [STORY_VERSION],
    installation: installation(AGENT.id, { version: 1 }),
    chats: Object.values(CHATS),
    messages: MESSAGES,
    graduateSettings: { writeMode: 'ask' },
    job,
    report: storyReport,
    ollama: { running: true, version: '0.12.6', models: [] },
    gpu: null,
    builds: Object.fromEntries(GLIMMER_BUILDS.map((build) => [build.key, build.model])),
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
    handle('graduates:versions', () => seed.versions);
    handle('graduates:installation', () => seed.installation);
    handle('graduates:report', () => seed.report);
    handle('graduates:settings', () => settings);
    handle('graduates:updateSettings', (_id: string, patch: Partial<typeof settings>) => {
      settings = { ...settings, ...patch };
      return settings;
    });
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
    const download = (model: string) =>
      new Promise<void>((resolve) => {
        finishPull = () => {
          ollama.models.push({
            name: model,
            sizeBytes: 18 * 1024 ** 3,
            digest: 'sha256-glimmer',
          });
          resolve();
        };
      });
    handle('ollama:pull', (model: string) => download(model));
    handle('ollama:install', (build: string) => {
      const model = seed.builds[build];
      if (!model) throw new Error(`No build ${build}.`);
      return download(model);
    });
    handle('connections:detectLocal', () => ({
      ollama: {
        running: ollama.running,
        ...(ollama.version === undefined ? {} : { version: ollama.version }),
        baseUrl: 'http://127.0.0.1:11434',
        models: ollama.models.map((model) => ({ id: model.name, sizeBytes: model.sizeBytes })),
      },
      lmstudio: { running: false, baseUrl: 'http://127.0.0.1:1234/v1', models: [] },
      gpu: seed.gpu,
    }));
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
