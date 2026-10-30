import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBlock,
  WorkspaceChat,
  WorkspaceEvent,
  WorkspaceMessage,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentHost, type AgentHost, type AgentHostOptions } from '../src/agent-host/host';
import { workspaceStore } from '../src/agent-host/store';
import { saveProblem } from '../src/files/agent-files';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore, type EngineStore } from '../src/store/engine-store';
import { startFakeOllama, type FakeOllama, type ScriptedTurn } from './agent-host/fake-ollama';
import { addGraduate, type GraduateFixture, type GraduateOptions } from './agent-host/graduates';
import {
  CHECK_PURPOSE,
  GpuLease,
  LocalRuntimeError,
  type GpuLeaseOptions,
} from '../src/local-runtime';
import { testAdapterRuntime, testGpu } from './support/computer';
import { SAMPLE_CONTENT } from './support/fixtures';

type Approval = Extract<AgentBlock, { kind: 'approval' }>;

interface World {
  dataDir: string;
  engine: EngineStore;
  host: AgentHost;
  gpu: GpuLease;
  model: FakeOllama;
  graduate: GraduateFixture;
  events: WorkspaceEvent[];
  /** What the host reported that nobody was waiting on. */
  errors: unknown[];
}

let world: World | undefined;

afterEach(async () => {
  if (!world) return;
  const { host, gpu, engine, model, dataDir } = world;
  world = undefined;
  await host.close();
  await gpu.close();
  engine.close();
  await model.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function setup(
  script: ScriptedTurn[],
  options: Partial<Omit<GraduateOptions, 'id'>> = {},
  gpuOptions: Partial<GpuLeaseOptions> = {},
  hostOptions: Partial<Pick<AgentHostOptions, 'cpuThreads'>> = {},
): Promise<World> {
  const dataDir = await mkdtemp(join(tmpdir(), 'architect-agent-host-'));
  const engine = openEngineStore(new DataPaths(dataDir).database);
  const model = await startFakeOllama(script);
  const graduate = await addGraduate(dataDir, engine, {
    id: 'grd_desk',
    baseUrl: model.url,
    ...options,
  });
  const gpu = testGpu(dataDir, 'workspace', gpuOptions);
  const errors: unknown[] = [];
  const host = createAgentHost({
    store: workspaceStore(engine, dataDir),
    adapters: testAdapterRuntime(
      new DataPaths(dataDir).runtimeDir('workspace'),
      join(dataDir, 'ollama-models'),
      undefined,
      gpu,
    ),
    gpu,
    onError: (error) => errors.push(error),
    ...hostOptions,
  });
  const events: WorkspaceEvent[] = [];
  host.onEvent((event) => events.push(event));
  world = { dataDir, engine, host, gpu, model, graduate, events, errors };
  await host.openGraduate(graduate.id);
  return world;
}

/** The next update of a chat's agent reply that passes `matches`. */
function nextReply(
  { host }: World,
  chatId: string,
  matches: (message: WorkspaceMessage) => boolean,
): Promise<WorkspaceMessage> {
  return new Promise((resolve) => {
    const stop = host.onEvent((event) => {
      if (event.type !== 'message.updated') return;
      const { message } = event;
      if (message.chatId !== chatId || message.role !== 'agent' || !matches(message)) return;
      stop();
      resolve(message);
    });
  });
}

const settled = (world: World, chatId: string) =>
  nextReply(world, chatId, (message) => message.status !== 'streaming');

function pendingApproval(world: World, chatId: string): Promise<Approval> {
  return nextReply(world, chatId, (message) => approvalOf(message)?.status === 'pending').then(
    (message) => approvalOf(message) as Approval,
  );
}

function approvalOf(message: WorkspaceMessage): Approval | undefined {
  return message.blocks.find((block): block is Approval => block.kind === 'approval');
}

/** Sends `text` in a new chat (or `chat`) and waits for the reply to settle. */
async function ask(
  world: World,
  text: string,
  chat?: WorkspaceChat,
): Promise<{ chat: WorkspaceChat; reply: WorkspaceMessage }> {
  const target = chat ?? (await world.host.createChat(world.graduate.id));
  const reply = settled(world, target.id);
  await world.host.send(target.id, text);
  return { chat: target, reply: await reply };
}

const invoicesFile = (world: World) =>
  readFile(join(world.graduate.workspaceDataDir, 'invoices.csv'), 'utf8');

/**
 * Puts a folder where one of the graduate's data files is, so saving to it fails as it would
 * when another program holds the file. `release` takes the folder away and puts the file's
 * bytes back, as they were.
 */
async function holdFile(world: World, name: string): Promise<{ release: () => Promise<void> }> {
  const path = join(world.graduate.workspaceDataDir, name);
  const bytes = await readFile(path);
  await rm(path, { force: true });
  await mkdir(path);
  await writeFile(join(path, 'in-use.txt'), 'another program has this open\n');
  return {
    release: async () => {
      await rm(path, { recursive: true, force: true });
      await writeFile(path, bytes);
    },
  };
}

const NEW_INVOICE = 'INV-4,C-2,5000,2026-12-05,false';

const addInvoice = (invoice = NEW_INVOICE): ScriptedTurn => ({
  text: "I'll add the invoice.",
  toolCalls: [{ name: 'append', arguments: { path: 'data/invoices.csv', text: invoice } }],
});

describe('chatting with a graduate', () => {
  it('streams a reply with its steps and text, and saves the conversation', async () => {
    const world = await setup([
      {
        text: 'Let me check the invoices.',
        toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }],
      },
      { text: 'Two invoices are unpaid: INV-2 and INV-3.' },
    ]);
    const { chat, reply } = await ask(world, 'Which invoices are still unpaid?');

    expect(reply).toMatchObject({
      role: 'agent',
      status: 'done',
      text: 'Let me check the invoices.\n\nTwo invoices are unpaid: INV-2 and INV-3.',
      steps: [
        {
          kind: 'tool',
          name: 'read',
          detail: 'data/invoices.csv',
          // A table read counts rows, as the table under it does; the header isn't one.
          meta: '3 rows',
          status: 'done',
          view: {
            kind: 'table',
            columns: ['invoice_id', 'customer_id', 'total_cents', 'due_date', 'paid'],
            rows: [
              ['INV-1', 'C-1', '12000', '2026-10-01', 'true'],
              ['INV-2', 'C-2', '4550', '2026-11-15', null],
              ['INV-3', 'C-1', '990', '2026-11-02', 'false'],
            ],
            total: 3,
          },
        },
      ],
      blocks: [],
    });
    expect(reply.workedMs).toBeGreaterThanOrEqual(0);
    // The whole exchange is kept with the reply: each call's arguments and full result.
    expect(reply.trace).toEqual([
      {
        kind: 'model',
        text: 'Let me check the invoices.',
        calls: [
          { id: expect.any(String), name: 'read', arguments: '{"path":"data/invoices.csv"}' },
        ],
      },
      {
        kind: 'tool',
        callId: expect.any(String),
        name: 'read',
        arguments: '{"path":"data/invoices.csv"}',
        result: expect.stringContaining('INV-3,C-1,990,2026-11-02,false'),
      },
      { kind: 'model', text: 'Two invoices are unpaid: INV-2 and INV-3.', calls: [] },
    ]);
    const streamed = world.events.flatMap((event) =>
      event.type === 'message.updated' && event.message.id === reply.id ? [event.message] : [],
    );
    expect(streamed[0]).toMatchObject({ status: 'streaming', text: '' });
    expect(
      streamed.some((message) => message.status === 'streaming' && message.text.length > 0),
    ).toBe(true);

    expect(await world.host.messages(chat.id)).toEqual([
      expect.objectContaining({ role: 'user', text: 'Which invoices are still unpaid?' }),
      reply,
    ]);
    expect(await world.host.listChats(world.graduate.id)).toEqual([
      expect.objectContaining({
        id: chat.id,
        title: 'Which invoices are still unpaid?',
        running: false,
        waiting: false,
      }),
    ]);
    const [request] = world.model.chats();
    expect(request?.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(request?.messages[0]?.content).toContain('Today is Tuesday, 2026-11-03.');
    expect(request?.messages[0]?.content).toContain('no ANSWER line is needed');
  });

  it('counts a page of a table in rows, as its table shows them', async () => {
    const world = await setup([
      {
        toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv', offset: 3 } }],
      },
      { text: 'INV-2 and INV-3.' },
    ]);
    const { reply } = await ask(world, 'Show me the last two invoices.');
    expect(reply.steps).toMatchObject([
      {
        name: 'read',
        meta: 'rows 2-3 of 3',
        view: {
          kind: 'table',
          rows: [
            ['INV-2', 'C-2', '4550', '2026-11-15', null],
            ['INV-3', 'C-1', '990', '2026-11-02', 'false'],
          ],
          total: 3,
        },
      },
    ]);
  });

  it('shows the skills it loads, by retrieval rule or by reading one', async () => {
    const world = await setup(
      [
        { toolCalls: [{ name: 'read', arguments: { path: 'skills/overdue-balances/SKILL.md' } }] },
        { text: 'Done.' },
      ],
      {
        harness: {
          skills: [
            {
              name: 'overdue-balances',
              description: 'List invoices past their terms.',
              body: '1. Read the invoices.',
            },
            {
              name: 'price-a-job',
              description: 'Turn a job into invoice lines.',
              body: '1. Read the job.',
            },
          ],
          retrieval: { rules: [{ whenAny: ['invoice'], loadSkills: ['price-a-job'] }] },
        },
      },
    );
    const { reply } = await ask(world, 'Invoice job W-12, then check overdue balances.');
    expect(reply.steps).toMatchObject([
      { kind: 'skill', name: 'price-a-job', detail: 'price-a-job', meta: 'loaded' },
      {
        kind: 'skill',
        name: 'overdue-balances',
        detail: 'overdue-balances',
        meta: '5 lines',
        status: 'done',
      },
    ]);
  });

  it('shows the code a run step ran, with its output', async () => {
    const code =
      "csv.parse(files.read('data/invoices.csv')).filter((row) => row.paid !== 'true').length";
    const world = await setup([
      { toolCalls: [{ name: 'run', arguments: { code } }] },
      { text: 'Two.' },
    ]);
    const { reply } = await ask(world, 'How many invoices are unpaid?');
    expect(reply.steps).toMatchObject([
      {
        kind: 'tool',
        name: 'run',
        detail: 'data/invoices.csv',
        meta: '=> 2',
        status: 'done',
        view: { kind: 'code', code, output: '=> 2' },
      },
    ]);
  });

  it('gives the student the conversation so far, with a fresh sampler seed each time', async () => {
    const world = await setup([
      { text: 'INV-2 and INV-3 are unpaid.' },
      { text: 'INV-2 is for Ruiz, Ben.' },
    ]);
    const { chat } = await ask(world, 'Which invoices are unpaid?');
    await ask(world, 'Who is the first one for?', chat);

    const [first, second] = world.model.chats();
    expect(second?.messages.slice(1)).toEqual([
      { role: 'user', content: 'Which invoices are unpaid?' },
      { role: 'assistant', content: 'INV-2 and INV-3 are unpaid.' },
      { role: 'user', content: 'Who is the first one for?' },
    ]);
    expect(Number.isInteger(first?.options.seed)).toBe(true);
    expect(second?.options.seed).not.toBe(first?.options.seed);
    const [saved] = await world.host.listChats(world.graduate.id);
    expect(saved?.title).toBe('Which invoices are unpaid?');
  });

  it('names a chat after its first message, cut to 40 characters', async () => {
    const world = await setup([{ text: 'Sure.' }]);
    const { chat } = await ask(
      world,
      'Please list every customer in Ferncliff whose invoices are more than thirty days overdue',
    );
    const [saved] = await world.host.listChats(world.graduate.id);
    expect(saved).toMatchObject({ id: chat.id, title: 'Please list every customer in Ferncliff…' });
    expect(Array.from(saved?.title ?? '')).toHaveLength(40);
  });

  it('refuses requests on its guardrail list without calling the student', async () => {
    const reason = 'Bookings chose a valid slot only 60% of the time in testing.';
    const world = await setup([], {
      harness: {
        guardrails: { refuse: [{ taskType: 'schedule', whenAny: ['book', 'schedule'], reason }] },
      },
    });
    const { reply } = await ask(world, 'Book a plumber for tomorrow morning.');
    expect(reply).toMatchObject({
      status: 'done',
      text: '',
      steps: [],
      blocks: [{ kind: 'refusal', taskType: 'schedule', reason }],
    });
    expect(world.model.requests).toEqual([]);
  });

  it('reports a student that fails as an error on the reply', async () => {
    const world = await setup([
      { status: 404, error: 'model "muse-glimmer:30b" not found, try pulling it first' },
    ]);
    const { chat, reply } = await ask(world, 'Which invoices are unpaid?');
    expect(reply.status).toBe('error');
    expect(reply.error).toMatch(/not found|pull/i);
    expect((await world.host.listChats(world.graduate.id))[0]).toMatchObject({
      id: chat.id,
      running: false,
    });
  });
});

/** What Ollama says when a model's tool call can't be parsed, as it arrives mid-stream. */
const UNREADABLE = 'parse Glimmer call to run: missing ATEM function_calls wrapper';

describe('asking a turn again', () => {
  /** Every text a reply showed while it was written, in order. */
  const shownTexts = (world: World, replyId: string) =>
    world.events.flatMap((event) =>
      event.type === 'message.updated' && event.message.id === replyId ? [event.message.text] : [],
    );

  it('takes back the text of a turn whose call could not be read, so the chat never repeats itself', async () => {
    const world = await setup([
      // A pause between pieces, so the text has gone out to listeners before the call fails.
      { text: 'Let me add it up. ', streamError: UNREADABLE, delayMs: 45 },
      { text: 'Two invoices are unpaid: INV-2 and INV-3.' },
    ]);
    const { reply } = await ask(world, 'Which invoices are unpaid?');

    expect(reply).toMatchObject({
      status: 'done',
      text: 'Two invoices are unpaid: INV-2 and INV-3.',
    });
    // The reply keeps the work it took: the turn that was kept, and nothing of the other.
    expect(reply.trace).toEqual([
      { kind: 'model', text: 'Two invoices are unpaid: INV-2 and INV-3.', calls: [] },
    ]);
    expect(world.model.chats()).toHaveLength(2);
    const [first, second] = world.model.chats();
    expect(second?.options.seed).not.toBe(first?.options.seed);

    const texts = shownTexts(world, reply.id);
    // The text was shown, then taken back before any of the new text, and never sat beside it.
    const shown = texts.findIndex((text) => text.startsWith('Let me'));
    expect(shown).toBeGreaterThan(-1);
    const gone = texts.findIndex((text, at) => at > shown && text === '');
    expect(gone).toBeGreaterThan(shown);
    expect(texts.slice(gone).some((text) => text.includes('Two invoices'))).toBe(true);
    expect(texts.some((text) => text.includes('Let me') && text.includes('Two invoices'))).toBe(
      false,
    );
    expect(world.errors).toEqual([]);
  });

  it('keeps the text of the turns before the one it asks again, with the paragraph between', async () => {
    const world = await setup([
      {
        text: 'Let me check the invoices.',
        toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }],
      },
      { text: 'Working it out. ', streamError: UNREADABLE },
      { text: 'Two invoices are unpaid: INV-2 and INV-3.' },
    ]);
    const { reply } = await ask(world, 'Which invoices are unpaid?');
    expect(reply.text).toBe(
      'Let me check the invoices.\n\nTwo invoices are unpaid: INV-2 and INV-3.',
    );
    expect(shownTexts(world, reply.id)).toContain('Let me check the invoices.');
  });

  it('asks again after a reply cut off at its length limit, and shows only the new reply', async () => {
    const world = await setup([
      {
        text: 'The unpaid invoices are INV',
        delayMs: 45,
        doneReason: 'length',
        tokens: { prompt: 900, reply: 4_096 },
      },
      { text: 'INV-2 and INV-3 are unpaid.' },
    ]);
    const { reply } = await ask(world, 'Which invoices are unpaid?');
    expect(reply).toMatchObject({ status: 'done', text: 'INV-2 and INV-3 are unpaid.' });
    const texts = shownTexts(world, reply.id);
    expect(texts.some((text) => text.startsWith('The unpaid'))).toBe(true);
    expect(texts.some((text) => text.includes('The unpaid') && text.includes('INV-2 and'))).toBe(
      false,
    );
    expect(world.model.chats()).toHaveLength(2);
  });

  it('ends on the error of the third reply that could not be read, leaving its text', async () => {
    const world = await setup([
      { text: 'One. ', streamError: UNREADABLE },
      { text: 'Two. ', streamError: UNREADABLE },
      { text: 'Three. ', streamError: UNREADABLE },
    ]);
    const { reply } = await ask(world, 'Which invoices are unpaid?');
    expect(reply.status).toBe('error');
    expect(reply.text).toBe('Three.');
    expect(reply.error).toContain("couldn't read");
    expect(world.model.chats()).toHaveLength(3);
  });
});

describe("keeping a conversation inside the student's context", () => {
  it('clears the oldest results when the prompt Ollama reports nears the end of the context', async () => {
    // Two hundred orders, read sixty lines at a time. Each reply reports a bigger prompt.
    const lines = Array.from(
      { length: 200 },
      (_, at) => `INV-${1000 + at},C-2,12345,2026-11-02,false`,
    );
    const reads = [1, 61, 121, 181].map((offset, at) => ({
      text: '',
      toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv', offset, limit: 60 } }],
      tokens: { prompt: 4_000 + at * 3_000, reply: 100 },
    }));
    const world = await setup([...reads, { text: 'There are 200 invoices.' }], {
      harness: { decoding: { maxSteps: 8 } },
    });
    await writeFile(
      join(world.graduate.workspaceDataDir, 'invoices.csv'),
      `invoice_id,customer_id,total_cents,due_date,paid\n${lines.join('\n')}\n`,
    );
    // The agent reads its files when it opens, so it opens again to see the longer table.
    await world.host.openGraduate(world.graduate.id);
    const { reply } = await ask(world, 'How many invoices are there?');
    expect(reply).toMatchObject({ status: 'done', text: 'There are 200 invoices.' });

    const chats = world.model.chats();
    expect(chats).toHaveLength(5);
    const results = (at: number) => chats[at]?.messages.filter((m) => m.role === 'tool') ?? [];
    // The fourth reply said its prompt was 13,000 tokens, over what 16,384 leaves with room for a
    // reply of 4,096: the fifth prompt went without the oldest result, and had the rest whole.
    expect(results(3)[0]?.content).toMatch(/^ *1\tinvoice_id,customer_id/);
    expect(results(4)[0]?.content).toBe(
      '[Cleared to make room: read data/invoices.csv, lines 1-60. Read it again if you need it.]',
    );
    expect(results(4)[3]?.content).toMatch(/^181\tINV-1179/);
    // The reply, and the steps it shows the person, are unchanged by what the model was sent.
    expect(reply.steps.map((step) => step.status)).toEqual(['done', 'done', 'done', 'done']);
    expect(
      reply.trace?.filter((step) => step.kind === 'tool').map((step) => step.result.slice(0, 20)),
    ).toEqual([
      expect.stringContaining('1\tinvoice_id'),
      expect.stringContaining('61\tINV-1059'),
      expect.stringContaining('121\tINV-1119'),
      expect.stringContaining('181\tINV-1179'),
    ]);
  });
});

describe('writes', () => {
  it('asks before writing, and writes the file once the user approves', async () => {
    const world = await setup([addInvoice(), { text: 'Added INV-4.' }]);
    const chat = await world.host.createChat(world.graduate.id);
    const waiting = pendingApproval(world, chat.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice for Ruiz, Ben: $50 due Dec 5.');

    const approval = await waiting;
    expect(approval).toMatchObject({
      op: 'append',
      file: 'data/invoices.csv',
      summary: 'Add 1 row to data/invoices.csv',
      diff: { added: [['INV-4', 'C-2', '5000', '2026-12-05', 'false']], removed: [], changed: [] },
    });
    expect(approval).not.toHaveProperty('patch');
    expect((await world.host.listChats(world.graduate.id))[0]?.waiting).toBe(true);
    expect(await invoicesFile(world)).toBe(SAMPLE_CONTENT['invoices.csv']);

    await world.host.decide(approval.changeId, 'approve');
    const reply = await done;
    expect(approvalOf(reply)?.status).toBe('approved');
    expect(reply.steps).toMatchObject([
      { name: 'append', detail: 'data/invoices.csv', meta: '1 row added', status: 'done' },
    ]);
    expect(await invoicesFile(world)).toContain('INV-4,C-2,5000,2026-12-05,false');
    expect((await world.host.listChats(world.graduate.id))[0]?.waiting).toBe(false);
  });

  it('leaves the file alone when the user denies the write, and tells the agent', async () => {
    const world = await setup([addInvoice(), { text: "Okay, I didn't save anything." }]);
    const chat = await world.host.createChat(world.graduate.id);
    const waiting = pendingApproval(world, chat.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice for Ruiz, Ben.');
    await world.host.decide((await waiting).changeId, 'deny');

    const reply = await done;
    expect(approvalOf(reply)?.status).toBe('denied');
    expect(reply.steps).toMatchObject([{ name: 'append', meta: 'declined' }]);
    expect(await invoicesFile(world)).toBe(SAMPLE_CONTENT['invoices.csv']);
    const toolMessage = world.model.chats()[1]?.messages.at(-1);
    expect(toolMessage).toMatchObject({ role: 'tool', tool_name: 'append' });
    expect(toolMessage?.content).toContain('The user declined this change');
  });

  it('switches the graduate to allowing writes when the user says always', async () => {
    const second = NEW_INVOICE.replace('INV-4', 'INV-5');
    const world = await setup([
      addInvoice(),
      { text: 'Added INV-4.' },
      addInvoice(second),
      { text: 'Added INV-5.' },
    ]);
    const chat = await world.host.createChat(world.graduate.id);
    const waiting = pendingApproval(world, chat.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice for Ruiz, Ben.');
    await world.host.decide((await waiting).changeId, 'always');
    expect(approvalOf(await done)?.status).toBe('approved');
    expect(workspaceStore(world.engine, world.dataDir).writeMode(world.graduate.id)).toBe('allow');

    const { reply } = await ask(world, 'And another one for INV-5.', chat);
    expect(approvalOf(reply)).toMatchObject({ status: 'approved', file: 'data/invoices.csv' });
    const updates = world.events.filter(
      (event) => event.type === 'chat.updated' && event.chat.waiting,
    );
    expect(updates).toHaveLength(1);
    const saved = await invoicesFile(world);
    expect(saved).toContain('INV-4,');
    expect(saved).toContain('INV-5,');
  });

  it('shows an allowed change that could not be saved, and saves it when the user tries again', async () => {
    const world = await setup([addInvoice(), { text: 'Added INV-4.' }]);
    const chat = await world.host.createChat(world.graduate.id);
    const asked = pendingApproval(world, chat.id);
    const failed = nextReply(world, chat.id, (message) => approvalOf(message)?.error !== undefined);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice for Ruiz, Ben: $50 due Dec 5.');
    const approval = await asked;
    const unsaved = await holdFile(world, 'invoices.csv');
    await world.host.decide(approval.changeId, 'approve');

    // Allowed, but not saved: it waits again, with the reason, and never shows as approved.
    const stuck = approvalOf(await failed);
    expect(stuck).toMatchObject({ status: 'pending', changeId: approval.changeId });
    expect(stuck?.error).toContain("The change couldn't be saved, so nothing was written");
    expect((await world.host.listChats(world.graduate.id))[0]?.waiting).toBe(true);

    await unsaved.release();
    await world.host.decide(approval.changeId, 'approve');
    const reply = await done;
    expect(approvalOf(reply)).toMatchObject({ status: 'approved' });
    expect(approvalOf(reply)).not.toHaveProperty('error');
    expect(reply.steps).toMatchObject([{ name: 'append', meta: '1 row added', status: 'done' }]);
    expect(await invoicesFile(world)).toContain(NEW_INVOICE);
    expect((await world.host.listChats(world.graduate.id))[0]?.waiting).toBe(false);
  });

  it('says why a save failed in plain words when the cause is a common one', () => {
    const coded = (code: string) => Object.assign(new Error(`${code}: raw`), { code });
    expect(saveProblem(coded('EBUSY'), 'data/invoices.csv')).toBe(
      'invoices.csv is open in another program.',
    );
    expect(saveProblem(coded('EPERM'), 'data/invoices.csv')).toBe(
      'invoices.csv is read-only, or another program has it open.',
    );
    expect(saveProblem(coded('ENOSPC'), 'output/notes.md')).toBe('the disk is full.');
    expect(saveProblem(coded('EIO'), 'data/invoices.csv')).toBe('EIO: raw');
  });

  it('shows a change as failed when the user stops trying to save it, and tells the agent', async () => {
    const world = await setup([addInvoice(), { text: "I couldn't save the invoice." }]);
    const chat = await world.host.createChat(world.graduate.id);
    const asked = pendingApproval(world, chat.id);
    const failed = nextReply(world, chat.id, (message) => approvalOf(message)?.error !== undefined);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice for Ruiz, Ben.');
    const approval = await asked;
    await holdFile(world, 'invoices.csv');
    await world.host.decide(approval.changeId, 'approve');
    await failed;
    await world.host.decide(approval.changeId, 'deny');

    const reply = await done;
    expect(approvalOf(reply)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining("couldn't be saved"),
    });
    expect(reply.steps).toMatchObject([{ name: 'append', status: 'error' }]);
    const toolMessage = world.model.chats()[1]?.messages.at(-1);
    expect(toolMessage?.content).toContain("The change couldn't be saved, so nothing was written");
  });

  it('shows a change it may make without asking as failed when nobody can try it again', async () => {
    const world = await setup([addInvoice(), { text: "I couldn't save the invoice." }], {
      writes: 'allow',
    });
    await holdFile(world, 'invoices.csv');
    const chat = await world.host.createChat(world.graduate.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice for Ruiz, Ben.', { approvals: 'fail' });
    const reply = await done;
    expect(approvalOf(reply)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining("couldn't be saved"),
    });
    expect(reply.steps).toMatchObject([{ name: 'append', status: 'error' }]);
  });

  it("fails writes with a reason the agent can pass on when the job doesn't allow them", async () => {
    const world = await setup([addInvoice(), { text: 'Writing is turned off for me.' }], {
      job: { permissions: { writes: 'never', unseenFiles: 'never' } },
    });
    const { reply } = await ask(world, 'Add an invoice for Ruiz, Ben.');
    expect(reply.blocks).toEqual([]);
    expect(reply.steps).toMatchObject([{ name: 'append', status: 'error' }]);
    expect(reply.steps[0]?.meta).toContain('Writing is turned off for Service desk');
    const toolMessage = world.model.chats()[1]?.messages.at(-1);
    expect(toolMessage?.content).toContain('nothing was written');
    expect(await invoicesFile(world)).toBe(SAMPLE_CONTENT['invoices.csv']);
  });
});

describe('stopping', () => {
  it('stops a reply mid-stream and marks it stopped', async () => {
    const text = 'Here is a long answer that streams slowly, one small piece at a time.';
    const world = await setup([{ text, chunk: 4, delayMs: 40 }]);
    const chat = await world.host.createChat(world.graduate.id);
    const started = nextReply(world, chat.id, (message) => message.text.length > 0);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Tell me about the invoices.');
    await started;
    await world.host.stop(chat.id);

    const reply = await done;
    expect(reply.status).toBe('stopped');
    expect(reply.text.length).toBeGreaterThan(0);
    expect(reply.text.length).toBeLessThan(text.length);
    expect((await world.host.messages(chat.id)).at(-1)).toEqual(reply);
    expect((await world.host.listChats(world.graduate.id))[0]?.running).toBe(false);
  });

  it('writes nothing when stopped while a write waits for approval', async () => {
    const world = await setup([addInvoice()]);
    const chat = await world.host.createChat(world.graduate.id);
    const waiting = pendingApproval(world, chat.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice for Ruiz, Ben.');
    const approval = await waiting;
    await world.host.stop(chat.id);

    const reply = await done;
    expect(reply.status).toBe('stopped');
    expect(approvalOf(reply)?.status).toBe('denied');
    expect(reply.steps).toMatchObject([{ name: 'append', status: 'done', meta: 'stopped' }]);
    expect(await invoicesFile(world)).toBe(SAMPLE_CONTENT['invoices.csv']);
    await expect(world.host.decide(approval.changeId, 'approve')).rejects.toThrow(
      'no longer waiting',
    );
    expect((await world.host.listChats(world.graduate.id))[0]).toMatchObject({
      running: false,
      waiting: false,
    });
  });
});

describe('when no one can answer an approval', () => {
  it('ends the reply at once with an approval-required failure, and writes nothing', async () => {
    const world = await setup([addInvoice(), { text: 'Added INV-4.' }]);
    const chat = await world.host.createChat(world.graduate.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice for Ruiz, Ben.', { approvals: 'fail' });
    const reply = await done;

    expect(reply).toMatchObject({
      status: 'error',
      error: expect.stringContaining('needs your approval'),
      graduateVersion: 1,
      failure: {
        kind: 'approval_required',
        approval: {
          tool: 'append',
          file: 'data/invoices.csv',
          summary: 'Add 1 row to data/invoices.csv',
          diff: { added: [['INV-4', 'C-2', '5000', '2026-12-05', 'false']] },
        },
      },
    });
    expect(approvalOf(reply)?.status).toBe('denied');
    expect(reply.text).not.toContain('Added INV-4.');
    expect(await invoicesFile(world)).toBe(SAMPLE_CONTENT['invoices.csv']);
    expect(world.events.some((event) => event.type === 'chat.updated' && event.chat.waiting)).toBe(
      false,
    );
    expect((await world.host.listChats(world.graduate.id))[0]).toMatchObject({
      running: false,
      waiting: false,
    });
    const saved = (await world.host.messages(chat.id)).at(-1);
    expect(saved?.failure?.approval.changeId).toBe(reply.failure?.approval.changeId);
  });

  it('still writes without asking when this computer allows writes', async () => {
    const world = await setup([addInvoice(), { text: 'Added INV-4.' }], { writes: 'allow' });
    const chat = await world.host.createChat(world.graduate.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice for Ruiz, Ben.', { approvals: 'fail' });
    const reply = await done;
    expect(reply).toMatchObject({ status: 'done', text: expect.stringContaining('Added INV-4.') });
    expect(approvalOf(reply)?.status).toBe('approved');
    expect(await invoicesFile(world)).toContain('INV-4,C-2,5000,2026-12-05,false');
  });
});

describe('the host', () => {
  it('sends a fast stream as about 30 updates a second, not one per piece', async () => {
    const text = 'x'.repeat(600);
    const world = await setup([{ text, chunk: 1 }]);
    const { reply } = await ask(world, 'Stream something.');
    expect(reply.text).toBe(text);
    const updates = world.events.filter(
      (event) => event.type === 'message.updated' && event.message.id === reply.id,
    );
    expect(updates.length).toBeLessThan(text.length / 10);
  });

  it("holds an agent that is already open to quiet mode's thread cap as it stands at each reply", async () => {
    let cap: number | undefined;
    const world = await setup(
      [{ text: 'One.' }, { text: 'Two.' }, { text: 'Three.' }],
      {},
      {},
      { cpuThreads: () => cap },
    );
    const { chat } = await ask(world, 'First.');
    // Quiet mode is switched on in Settings while the agent is open, then off again.
    cap = 4;
    await ask(world, 'Second.', chat);
    cap = undefined;
    await ask(world, 'Third.', chat);
    const [first, second, third] = world.model.chats().map((request) => request.options);
    expect(first).not.toHaveProperty('num_thread');
    expect(second).toMatchObject({ num_thread: 4 });
    expect(third).not.toHaveProperty('num_thread');
    expect(world.errors).toEqual([]);
  });

  it('keeps the cap an agent was opened with when the host follows none', async () => {
    const world = await setup([{ text: 'One.' }]);
    await world.host.openGraduate(world.graduate.id, 3);
    await ask(world, 'First.');
    expect(world.model.chats()[0]?.options).toMatchObject({ num_thread: 3 });
  });

  it('refuses a graduate whose model is not on this computer, before any request', async () => {
    const world = await setup([]);
    const remote = await addGraduate(world.dataDir, world.engine, {
      id: 'grd_remote',
      baseUrl: 'https://api.example.com/v1',
    });
    await expect(world.host.openGraduate(remote.id)).rejects.toMatchObject({
      name: 'GuardError',
      guard: 'network',
    });
    await expect(world.host.createChat(remote.id)).rejects.toThrow('Open the graduate');
  });

  it('closes off replies that were still running when the host last stopped', async () => {
    const world = await setup([]);
    const store = workspaceStore(world.engine, world.dataDir);
    const chat: WorkspaceChat = {
      id: 'cht_left',
      graduateId: world.graduate.id,
      title: 'Add an invoice',
      createdAt: '2026-11-05T09:00:00.000Z',
      updatedAt: '2026-11-05T09:00:00.000Z',
      running: true,
      waiting: true,
    };
    store.upsertChat(chat);
    store.appendMessage({
      id: 'msg_left',
      chatId: chat.id,
      role: 'agent',
      createdAt: chat.createdAt,
      text: "I'll add it.",
      steps: [
        {
          id: 'step-1',
          kind: 'tool',
          name: 'append_rows',
          detail: 'invoices.csv',
          status: 'running',
        },
      ],
      blocks: [
        {
          kind: 'approval',
          changeId: 'chg_left',
          op: 'append',
          file: 'invoices.csv',
          summary: 'Append 1 row to invoices.csv',
          diff: { columns: ['invoice_id'], added: [['INV-9']], removed: [], changed: [] },
          status: 'pending',
        },
      ],
      status: 'streaming',
    });

    await world.host.openGraduate(world.graduate.id);
    expect(await world.host.messages(chat.id)).toEqual([
      expect.objectContaining({
        status: 'error',
        error: 'Architect closed before this reply finished.',
        steps: [expect.objectContaining({ status: 'done', meta: 'stopped' })],
        blocks: [expect.objectContaining({ status: 'denied' })],
      }),
    ]);
    expect((await world.host.listChats(world.graduate.id))[0]).toMatchObject({
      running: false,
      waiting: false,
    });
  });

  it('answers one message at a time in each chat', async () => {
    const world = await setup([{ text: 'A slow answer.', chunk: 2, delayMs: 30 }]);
    const chat = await world.host.createChat(world.graduate.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'First question.');
    await expect(world.host.send(chat.id, 'Second question.')).rejects.toThrow('still answering');
    await done;
    await expect(world.host.send(chat.id, '   ')).rejects.toThrow('Write a message');
    await expect(world.host.messages('cht_missing')).rejects.toMatchObject({
      code: 'chat_not_found',
      message: expect.stringContaining('There is no chat'),
    });
  });
});

describe('taking turns at the GPU', () => {
  /** Another of Architect's processes on the same data folder, with a llama-server running. */
  function otherProcess(world: World): GpuLease {
    return new GpuLease({ dataDir: world.dataDir, owner: 'engine', pollMs: 25 });
  }

  it('waits for the GPU while another process holds it, then answers', async () => {
    const world = await setup([{ text: 'There are 3 invoices on file.' }]);
    const engine = otherProcess(world);
    try {
      const check = await engine.hold('llama-server', CHECK_PURPOSE);
      const chat = await world.host.createChat(world.graduate.id);
      const answered = settled(world, chat.id);
      await world.host.send(chat.id, 'How many invoices are there?');
      await new Promise((resolve) => setTimeout(resolve, 200));
      // Nothing reached the model while the other process had the GPU.
      expect(world.model.chats()).toEqual([]);
      check.release();
      expect(await answered).toMatchObject({
        status: 'done',
        text: 'There are 3 invoices on file.',
      });
    } finally {
      await engine.close();
    }
  });

  it('refuses a request on its guardrail list at once, without waiting for the GPU', async () => {
    const reason = 'Bookings chose a valid slot only 60% of the time in testing.';
    const world = await setup([], {
      harness: {
        guardrails: { refuse: [{ taskType: 'schedule', whenAny: ['book'], reason }] },
      },
    });
    const engine = otherProcess(world);
    try {
      const check = await engine.hold('llama-server', CHECK_PURPOSE);
      const { reply } = await ask(world, 'Book a plumber for tomorrow morning.');
      expect(reply).toMatchObject({ status: 'done', blocks: [{ kind: 'refusal', reason }] });
      check.release();
    } finally {
      await engine.close();
    }
  });

  it('says who has the GPU when its turn never comes, and reports it', async () => {
    const world = await setup([], {}, { waitMs: 300 });
    const engine = otherProcess(world);
    try {
      const check = await engine.hold('llama-server', CHECK_PURPOSE);
      const { reply } = await ask(world, 'How many invoices are there?');
      expect(reply).toMatchObject({
        status: 'error',
        error:
          'The GPU is busy: Architect is checking an agent on this computer. Wait for the check to finish, then try again.',
      });
      expect(world.errors).toEqual([expect.any(LocalRuntimeError)]);
      check.release();
    } finally {
      await engine.close();
    }
  });

  it('says, as one step, that a reply waits for the GPU and for whom, until it has it', async () => {
    // A model's first words come long after a reply's 33 ms between updates. The stand-in's would
    // come at once, and on a fast computer, which takes the GPU over within those 33 ms, go out in
    // the same update that takes the step away.
    const world = await setup([{ text: 'There are 3 invoices on file.', chunk: 64, delayMs: 100 }]);
    const engine = otherProcess(world);
    try {
      const check = await engine.hold('llama-server', CHECK_PURPOSE);
      const chat = await world.host.createChat(world.graduate.id);
      const waiting = nextReply(world, chat.id, (message) =>
        message.steps.some((step) => step.kind === 'wait'),
      );
      const answered = settled(world, chat.id);
      await world.host.send(chat.id, 'How many invoices are there?');
      expect((await waiting).steps).toEqual([
        {
          id: 'step-gpu',
          kind: 'wait',
          name: 'gpu',
          detail: 'Waiting for the GPU: Architect is checking an agent on this computer',
          status: 'running',
        },
      ]);
      check.release();
      const reply = await answered;
      expect(reply).toMatchObject({ status: 'done', text: 'There are 3 invoices on file.' });
      expect(reply.steps).toEqual([]);
      // The step went as soon as the reply had the GPU, before the model said anything.
      const updates = world.events.flatMap((event) =>
        event.type === 'message.updated' && event.message.id === reply.id ? [event.message] : [],
      );
      const firstText = updates.findIndex((message) => message.text !== '');
      expect(updates.slice(firstText).every((message) => message.steps.length === 0)).toBe(true);
      expect(updates.slice(0, firstText).at(-1)?.steps).toEqual([]);
    } finally {
      await engine.close();
    }
  });

  it('gives the GPU up while a reply waits for an approval, and takes it back to finish', async () => {
    const world = await setup([addInvoice(), { text: 'Added INV-4.' }]);
    const engine = otherProcess(world);
    try {
      const chat = await world.host.createChat(world.graduate.id);
      const asked = pendingApproval(world, chat.id);
      const done = settled(world, chat.id);
      await world.host.send(chat.id, 'Add an invoice for Ruiz, Ben.');
      const approval = await asked;

      // Nobody has answered yet, so an engine check gets the GPU; the reply's model is unloaded.
      const check = await engine.hold('llama-server', CHECK_PURPOSE);
      const unloads = world.model.requests.filter(
        (request) =>
          request.path === '/api/chat' &&
          (request.body as { keep_alive?: number }).keep_alive === 0,
      );
      expect(unloads).toMatchObject([{ body: { model: 'muse-glimmer:30b' } }]);

      // Once approved, the reply's next turn waits its turn behind the check, then finishes.
      const waitingAgain = nextReply(world, chat.id, (message) =>
        message.steps.some((step) => step.kind === 'wait'),
      );
      await world.host.decide(approval.changeId, 'approve');
      expect((await waitingAgain).steps.at(-1)?.detail).toBe(
        'Waiting for the GPU: Architect is checking an agent on this computer',
      );
      expect(world.model.chats()).toHaveLength(1);
      check.release();
      expect(await done).toMatchObject({
        status: 'done',
        text: "I'll add the invoice.\n\nAdded INV-4.",
      });
      expect(world.model.chats()).toHaveLength(2);
      expect(await invoicesFile(world)).toContain(NEW_INVOICE);
    } finally {
      await engine.close();
    }
  });

  it('stops a reply that is still waiting for the GPU', async () => {
    const world = await setup([]);
    const engine = otherProcess(world);
    try {
      const check = await engine.hold('llama-server', CHECK_PURPOSE);
      const chat = await world.host.createChat(world.graduate.id);
      const stopped = settled(world, chat.id);
      await world.host.send(chat.id, 'How many invoices are there?');
      await world.host.stop(chat.id);
      expect(await stopped).toMatchObject({ status: 'stopped' });
      expect(world.errors).toEqual([]);
      check.release();
    } finally {
      await engine.close();
    }
  });
});
