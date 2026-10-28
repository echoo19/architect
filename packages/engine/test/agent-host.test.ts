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
import { createAgentHost, type AgentHost } from '../src/agent-host/host';
import { workspaceStore } from '../src/agent-host/store';
import { saveProblem } from '../src/files/agent-files';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore, type EngineStore } from '../src/store/engine-store';
import { startFakeOllama, type FakeOllama, type ScriptedTurn } from './agent-host/fake-ollama';
import { addGraduate, type GraduateFixture, type GraduateOptions } from './agent-host/graduates';
import { testAdapterRuntime } from './support/computer';
import { SAMPLE_CONTENT } from './support/fixtures';

type Approval = Extract<AgentBlock, { kind: 'approval' }>;

interface World {
  dataDir: string;
  engine: EngineStore;
  host: AgentHost;
  model: FakeOllama;
  graduate: GraduateFixture;
  events: WorkspaceEvent[];
}

let world: World | undefined;

afterEach(async () => {
  if (!world) return;
  const { host, engine, model, dataDir } = world;
  world = undefined;
  await host.close();
  engine.close();
  await model.close();
  await rm(dataDir, { recursive: true, force: true });
});

async function setup(
  script: ScriptedTurn[],
  options: Partial<Omit<GraduateOptions, 'id'>> = {},
): Promise<World> {
  const dataDir = await mkdtemp(join(tmpdir(), 'architect-agent-host-'));
  const engine = openEngineStore(new DataPaths(dataDir).database);
  const model = await startFakeOllama(script);
  const graduate = await addGraduate(dataDir, engine, {
    id: 'grd_desk',
    baseUrl: model.url,
    ...options,
  });
  const host = createAgentHost({
    store: workspaceStore(engine, dataDir),
    adapters: testAdapterRuntime(
      new DataPaths(dataDir).runtimeDir('workspace'),
      join(dataDir, 'ollama-models'),
    ),
  });
  const events: WorkspaceEvent[] = [];
  host.onEvent((event) => events.push(event));
  world = { dataDir, engine, host, model, graduate, events };
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
 * when another program holds the file. `release` takes the folder away again.
 */
async function holdFile(world: World, name: string): Promise<{ release: () => Promise<void> }> {
  const path = join(world.graduate.workspaceDataDir, name);
  await rm(path, { force: true });
  await mkdir(path);
  await writeFile(join(path, 'in-use.txt'), 'another program has this open\n');
  return { release: () => rm(path, { recursive: true, force: true }) };
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
    await expect(world.host.messages('cht_missing')).rejects.toThrow('There is no chat');
  });
});
