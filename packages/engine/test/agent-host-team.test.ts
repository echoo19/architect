import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ASK_TEAMMATE,
  type AgentBlock,
  type AgentStep,
  type Team,
  type WorkspaceChat,
  type WorkspaceMessage,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentHost, type AgentHost } from '../src/agent-host/host';
import { TEAM_INSTRUCTION } from '../src/agent-host/team';
import { workspaceStore } from '../src/agent-host/store';
import { CHECK_PURPOSE, GpuLease } from '../src/local-runtime';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore, type EngineStore } from '../src/store/engine-store';
import { startFakeOllama, type FakeOllama, type ScriptedTurn } from './agent-host/fake-ollama';
import { addGraduate, type GraduateFixture, type GraduateOptions } from './agent-host/graduates';
import { fakeLlamaCommand, standInAdapter, storeBase } from './support/adapter-runtime';
import { testAdapterRuntime, testGpu } from './support/computer';
import { SAMPLE_CONTENT } from './support/fixtures';

type Approval = Extract<AgentBlock, { kind: 'approval' }>;

interface World {
  dataDir: string;
  engine: EngineStore;
  host: AgentHost;
  gpu: GpuLease;
  model: FakeOllama;
  lead: GraduateFixture;
  sweep: GraduateFixture;
  team: Team;
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
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const AT = '2026-11-05T18:00:00.000Z';
/** The lead's own invoices: a table its teammate never sees. */
const LEAD_INVOICES =
  'invoice_id,customer_id,total_cents,due_date,paid\nLEAD-1,C-1,1,2026-10-01,true\n';
const NEW_INVOICE = 'INV-4,C-2,5000,2026-12-05,false';

interface SetupOptions {
  lead?: Partial<Omit<GraduateOptions, 'id'>>;
  sweep?:
    | Partial<Omit<GraduateOptions, 'id'>>
    | ((dataDir: string) => Partial<Omit<GraduateOptions, 'id'>>);
  /** More teammates, each its own agent here. */
  more?: (dataDir: string, ollamaUrl: string) => Promise<GraduateOptions[]>;
  llamaServer?: (dataDir: string) => Parameters<typeof testAdapterRuntime>[2];
  open?: readonly string[];
}

async function setup(script: ScriptedTurn[], options: SetupOptions = {}): Promise<World> {
  const dataDir = await mkdtemp(join(tmpdir(), 'architect-team-'));
  const engine = openEngineStore(new DataPaths(dataDir).database);
  const model = await startFakeOllama(script);
  const lead = await addGraduate(dataDir, engine, {
    id: 'grd_assay',
    baseUrl: model.url,
    job: { name: 'Assay desk' },
    ...options.lead,
  });
  await writeFile(join(lead.workspaceDataDir, 'invoices.csv'), LEAD_INVOICES, 'utf8');
  const sweep = await addGraduate(dataDir, engine, {
    id: 'grd_sweep',
    baseUrl: model.url,
    job: { name: 'Sweep desk' },
    ...(typeof options.sweep === 'function' ? options.sweep(dataDir) : options.sweep),
  });
  const more = (await options.more?.(dataDir, model.url)) ?? [];
  for (const each of more) await addGraduate(dataDir, engine, each);
  const team: Team = {
    id: 'team_lab',
    name: 'Lab review',
    members: [
      { graduateId: lead.id },
      { graduateId: sweep.id, role: "Reads Halden Lab's training sweeps." },
      ...more.map((each) => ({ graduateId: each.id })),
    ],
    createdAt: AT,
    updatedAt: AT,
  };
  engine.teams.insert(team);
  const gpu = testGpu(dataDir, 'workspace');
  const errors: unknown[] = [];
  const host = createAgentHost({
    store: workspaceStore(engine, dataDir),
    adapters: testAdapterRuntime(
      new DataPaths(dataDir).runtimeDir('workspace'),
      join(dataDir, 'ollama-models'),
      options.llamaServer?.(dataDir),
      gpu,
    ),
    gpu,
    onError: (error) => errors.push(error),
  });
  world = { dataDir, engine, host, gpu, model, lead, sweep, team, errors };
  for (const id of options.open ?? [lead.id, sweep.id, ...more.map((each) => each.id)]) {
    await host.openGraduate(id);
  }
  return world;
}

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

const approvalOf = (message: WorkspaceMessage) =>
  message.blocks.find((block): block is Approval => block.kind === 'approval');

const pendingApproval = (world: World, chatId: string) =>
  nextReply(world, chatId, (message) => approvalOf(message)?.status === 'pending').then(
    (message) => approvalOf(message) as Approval,
  );

async function ask(
  world: World,
  text: string,
): Promise<{ chat: WorkspaceChat; reply: WorkspaceMessage }> {
  const chat = await world.host.createTeamChat(world.team.id);
  const reply = settled(world, chat.id);
  await world.host.send(chat.id, text);
  return { chat, reply: await reply };
}

const asks = (request: string, member = 'Sweep desk'): ScriptedTurn => ({
  toolCalls: [{ name: ASK_TEAMMATE, arguments: { member, request } }],
});

const consultOf = (message: WorkspaceMessage): AgentStep | undefined =>
  message.steps.find((step) => step.kind === 'consult');

const invoices = (fixture: GraduateFixture) =>
  readFile(join(fixture.workspaceDataDir, 'invoices.csv'), 'utf8');

describe('a team reply (decision 100)', () => {
  it('asks a teammate, shows its own steps and version, and keeps what it did', async () => {
    const world = await setup([
      asks('How many invoices are on file?'),
      { toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }] },
      { text: 'Three are on file.\nANSWER: 3' },
      { text: 'Sweep desk counts three.' },
    ]);
    const { chat, reply } = await ask(world, 'How many invoices does Halden have?');
    expect(chat).toMatchObject({ graduateId: 'grd_assay', teamId: 'team_lab' });
    expect(await world.host.listTeamChats(world.team.id)).toEqual([
      expect.objectContaining({ id: chat.id }),
    ]);
    expect(await world.host.listChats(world.lead.id)).toEqual([]);
    expect(reply).toMatchObject({
      status: 'done',
      text: 'Sweep desk counts three.',
      team: true,
      graduateVersion: 1,
    });
    const step = consultOf(reply);
    expect(step).toMatchObject({
      kind: 'consult',
      name: 'Sweep desk',
      detail: 'How many invoices are on file?',
      meta: 'Three are on file.',
      status: 'done',
      view: {
        kind: 'consult',
        graduateId: 'grd_sweep',
        version: 1,
        outcome: 'answered',
        steps: [{ kind: 'tool', name: 'read', meta: '3 rows', status: 'done' }],
      },
    });
    const [consultation] = reply.consultations ?? [];
    expect(consultation).toMatchObject({
      stepId: step?.id,
      graduateId: 'grd_sweep',
      version: 1,
      request: 'How many invoices are on file?',
      text: 'Three are on file.\nANSWER: 3',
      outcome: 'answered',
    });
    expect(consultation?.work.map((each) => each.kind)).toEqual(['model', 'tool', 'model']);
    // It read its own table, not the lead's.
    const read = consultation?.work.find((each) => each.kind === 'tool');
    expect(read).toMatchObject({ result: expect.stringContaining('INV-1') });
    expect(JSON.stringify(consultation)).not.toContain('LEAD-1');
    expect((await world.host.messages(chat.id)).at(-1)).toEqual(reply);

    const [leadTurn, sweepTurn, , leadAgain] = world.model.chats();
    const tools = (body: typeof leadTurn) => body?.tools?.map((tool) => tool.function.name);
    expect(tools(leadTurn)).toContain(ASK_TEAMMATE);
    expect(tools(sweepTurn)).not.toContain(ASK_TEAMMATE);
    // The teammate sees the request as the lead wrote it, and nothing of the conversation.
    expect(sweepTurn?.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(sweepTurn?.messages[1]?.content).toBe('How many invoices are on file?');
    expect(JSON.stringify(sweepTurn)).not.toContain('Halden have');
    expect(leadAgain?.messages.at(-1)).toMatchObject({
      role: 'tool',
      tool_name: ASK_TEAMMATE,
      content: expect.stringContaining('Three are on file.'),
    });
    const description = (
      leadTurn?.tools as unknown as { function: { name: string; description: string } }[]
    ).find((tool) => tool.function.name === ASK_TEAMMATE)?.function.description;
    expect(description).toContain("- Sweep desk: Reads Halden Lab's training sweeps.");
    // It names the files the teammate holds, by name only, never what is in them.
    expect(description).toContain(
      "- Sweep desk: Reads Halden Lab's training sweeps. It handles: Invoices, Overdue balances. Its files: customers.csv, invoices.csv, policy.md.",
    );
    expect(description).not.toContain('INV-1');
    // Only the lead, in a team reply, is told when to ask; the teammate is not.
    const system = (body: typeof leadTurn) => String(body?.messages[0]?.content ?? '');
    expect(system(leadTurn)).toContain(TEAM_INSTRUCTION);
    expect(system(sweepTurn)).not.toContain(TEAM_INSTRUCTION);
  });

  it("tells the lead when to ask only in a team reply, not in the lead's own chat", async () => {
    const world = await setup([{ text: 'Nothing to ask.' }]);
    const chat = await world.host.createChat(world.lead.id);
    const reply = settled(world, chat.id);
    await world.host.send(chat.id, 'How many invoices are there?');
    expect(await reply).toMatchObject({ status: 'done', text: 'Nothing to ask.' });
    const [alone] = world.model.chats();
    expect(String(alone?.messages[0]?.content)).not.toContain(TEAM_INSTRUCTION);
    expect(alone?.tools?.map((tool) => tool.function.name) ?? []).not.toContain(ASK_TEAMMATE);
  });

  it('keeps a teammate to its own files', async () => {
    const world = await setup([
      asks('Read the invoices.'),
      {
        toolCalls: [{ name: 'read', arguments: { path: 'data/../../grd_assay/invoices.csv' } }],
      },
      { text: 'I could not read that.\nANSWER: none' },
      { text: 'Done.' },
    ]);
    const { reply } = await ask(world, 'Have Sweep desk read my invoices.');
    const inner = consultOf(reply)?.view;
    expect(inner).toMatchObject({ kind: 'consult', steps: [{ name: 'read', status: 'error' }] });
    expect(JSON.stringify(reply)).not.toContain('LEAD-1');
  });

  it("asks before a teammate's write, under the teammate's name, and writes only its file", async () => {
    const world = await setup([
      asks('Add the invoice.'),
      {
        toolCalls: [
          { name: 'append', arguments: { path: 'data/invoices.csv', text: NEW_INVOICE } },
        ],
      },
      { text: 'Added.\nANSWER: INV-4' },
      { text: 'Sweep desk added it.' },
    ]);
    const chat = await world.host.createTeamChat(world.team.id);
    const waiting = pendingApproval(world, chat.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice to Halden.');
    const approval = await waiting;
    expect(approval).toMatchObject({
      file: 'data/invoices.csv',
      agent: { graduateId: 'grd_sweep', name: 'Sweep desk' },
    });
    expect((await world.host.listTeamChats(world.team.id))[0]?.waiting).toBe(true);
    // Nothing is written while the person decides: a teammate's writes always ask first.
    expect(await invoices(world.sweep)).toBe(SAMPLE_CONTENT['invoices.csv']);
    await world.host.decide(approval.changeId, 'approve');
    expect(await done).toMatchObject({ status: 'done', text: 'Sweep desk added it.' });
    expect(await invoices(world.sweep)).toContain(NEW_INVOICE);
    expect(await invoices(world.lead)).toBe(LEAD_INVOICES);
  });

  it("writes nothing when a teammate's write is denied", async () => {
    const world = await setup([
      asks('Add the invoice.'),
      {
        toolCalls: [
          { name: 'append', arguments: { path: 'data/invoices.csv', text: NEW_INVOICE } },
        ],
      },
      { text: 'Not added.\nANSWER: none' },
      { text: 'Nothing was added.' },
    ]);
    const chat = await world.host.createTeamChat(world.team.id);
    const waiting = pendingApproval(world, chat.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice to Halden.');
    await world.host.decide((await waiting).changeId, 'deny');
    const reply = await done;
    expect(approvalOf(reply)?.status).toBe('denied');
    expect(consultOf(reply)?.view).toMatchObject({ steps: [{ name: 'append', meta: 'declined' }] });
    expect(await invoices(world.sweep)).toBe(SAMPLE_CONTENT['invoices.csv']);
  });

  it('lets the teammate write from now on when the person says always, and not the lead', async () => {
    const world = await setup([
      asks('Add the invoice.'),
      {
        toolCalls: [
          { name: 'append', arguments: { path: 'data/invoices.csv', text: NEW_INVOICE } },
        ],
      },
      { text: 'Added.\nANSWER: INV-4' },
      { text: 'Added.' },
    ]);
    const chat = await world.host.createTeamChat(world.team.id);
    const waiting = pendingApproval(world, chat.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice to Halden.');
    await world.host.decide((await waiting).changeId, 'always');
    await done;
    const store = workspaceStore(world.engine, world.dataDir);
    expect(store.writeMode(world.sweep.id)).toBe('allow');
    expect(store.writeMode(world.lead.id)).toBe('ask');
  });

  it("ends a run nobody can answer with the teammate's write as the approval it needed", async () => {
    const world = await setup([
      asks('Add the invoice.'),
      {
        toolCalls: [
          { name: 'append', arguments: { path: 'data/invoices.csv', text: NEW_INVOICE } },
        ],
      },
      { text: 'Added.\nANSWER: INV-4' },
      { text: 'Added.' },
    ]);
    const chat = await world.host.createTeamChat(world.team.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Add an invoice to Halden.', { approvals: 'fail' });
    const reply = await done;
    expect(reply).toMatchObject({
      status: 'error',
      failure: {
        kind: 'approval_required',
        approval: { file: 'data/invoices.csv', agent: { graduateId: 'grd_sweep' } },
      },
    });
    expect(consultOf(reply)?.view).toMatchObject({ outcome: 'stopped' });
    expect(await invoices(world.sweep)).toBe(SAMPLE_CONTENT['invoices.csv']);
  });

  it('asks teammates at most four times in one reply', async () => {
    const calls = Array.from({ length: 5 }, (_, n) => ({
      name: ASK_TEAMMATE,
      arguments: { member: 'Sweep desk', request: `Question ${n + 1}?` },
    }));
    const world = await setup([
      { toolCalls: calls },
      ...[1, 2, 3, 4].map((n) => ({ text: `ANSWER: ${n}` })),
      { text: 'Four answers.' },
    ]);
    const { reply } = await ask(world, 'Ask five questions.');
    // The fifth is kept as refused, with whom it named, so the chat stays teachable.
    expect(reply.consultations?.map((each) => each.outcome)).toEqual([
      'answered',
      'answered',
      'answered',
      'answered',
      'error',
    ]);
    expect(reply.consultations?.[4]).toMatchObject({
      graduateId: 'grd_sweep',
      request: 'Question 5?',
      work: [],
      text: expect.stringContaining('4 times'),
    });
    const last = reply.steps.at(-1);
    expect(last).toMatchObject({ kind: 'consult', status: 'error', view: { outcome: 'error' } });
    expect(last?.meta).toContain('4 times');
  });

  it('refuses an ask of no teammate, or of the lead itself, as a tool error', async () => {
    const world = await setup([
      {
        toolCalls: [
          { name: ASK_TEAMMATE, arguments: { member: 'Nobody', request: 'Hello?' } },
          { name: ASK_TEAMMATE, arguments: { member: 'Assay desk', request: 'Hello?' } },
          { name: ASK_TEAMMATE, arguments: { member: 'Sweep desk', request: 'x'.repeat(2001) } },
        ],
      },
      { text: 'Nobody answered.' },
    ]);
    const { reply } = await ask(world, 'Ask around.');
    expect(reply.consultations).toEqual([
      expect.objectContaining({
        graduateId: 'grd_sweep',
        outcome: 'error',
        text: expect.stringContaining('at most 2000 characters'),
      }),
    ]);
    expect(reply.steps.map((step) => [step.kind, step.status])).toEqual([
      ['tool', 'error'],
      ['tool', 'error'],
      ['consult', 'error'],
    ]);
    const lastTurn = world.model
      .chats()[1]
      ?.messages.slice(-3)
      .map((message) => message.content);
    expect(lastTurn?.[0]).toContain('There is no teammate called "Nobody"');
    expect(lastTurn?.[1]).toContain('You are Assay desk.');
    expect(lastTurn?.[2]).toContain('at most 2000 characters');
  });

  it('stops the teammate with the reply, and leaves the consultation settled', async () => {
    const world = await setup([
      asks('Count slowly.'),
      { text: 'Counting one by one, very slowly.', chunk: 2, delayMs: 40 },
    ]);
    const chat = await world.host.createTeamChat(world.team.id);
    const working = nextReply(world, chat.id, (message) =>
      (message.consultations ?? []).some((each) => each.work.length === 0),
    );
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Count the invoices.');
    await working;
    await world.host.stop(chat.id);
    const reply = await done;
    expect(reply.status).toBe('stopped');
    expect(consultOf(reply)).toMatchObject({ status: 'done', view: { outcome: 'stopped' } });
    expect(reply.consultations?.[0]?.outcome).toBe('stopped');
    expect(world.model.chats()).toHaveLength(2);
  });

  it("refuses on the lead's guardrail list without asking anyone", async () => {
    const reason = 'Bookings chose a valid slot only 60% of the time in testing.';
    const world = await setup([], {
      lead: {
        job: { name: 'Assay desk' },
        harness: { guardrails: { refuse: [{ taskType: 'schedule', whenAny: ['book'], reason }] } },
      },
    });
    const { reply } = await ask(world, 'Book a plumber.');
    expect(reply).toMatchObject({ status: 'done', blocks: [{ kind: 'refusal', reason }] });
    expect(world.model.chats()).toEqual([]);
  });

  it('tells the lead in words when its teammate refuses the request', async () => {
    const reason = 'Bookings chose a valid slot only 60% of the time in testing.';
    const world = await setup([asks('Book a plumber.'), { text: 'Sweep desk declined.' }], {
      sweep: {
        job: { name: 'Sweep desk' },
        harness: { guardrails: { refuse: [{ taskType: 'schedule', whenAny: ['book'], reason }] } },
      },
    });
    const { reply } = await ask(world, 'Get a plumber booked.');
    expect(consultOf(reply)?.view).toMatchObject({ outcome: 'refused', steps: [] });
    expect(reply.consultations?.[0]?.text).toContain(
      `Sweep desk refused: I can't help with schedule`,
    );
    expect(world.model.chats()).toHaveLength(2);
    expect(world.model.chats()[1]?.messages.at(-1)?.content).toContain('Sweep desk refused');
  });

  it('tells the lead when its teammate ends without an answer or runs out of steps', async () => {
    const reading = { toolCalls: [{ name: 'read', arguments: { path: 'data/policy.md' } }] };
    const world = await setup([
      {
        toolCalls: [
          { name: ASK_TEAMMATE, arguments: { member: 'Sweep desk', request: 'Say nothing.' } },
          { name: ASK_TEAMMATE, arguments: { member: 'Sweep desk', request: 'Keep reading.' } },
        ],
      },
      { text: '' },
      reading,
      reading,
      reading,
      reading,
      { text: 'Neither answered.' },
    ]);
    const { reply } = await ask(world, 'Ask twice.');
    expect(reply.consultations?.map((each) => [each.outcome, each.text])).toEqual([
      ['no_answer', 'Sweep desk finished without an answer.'],
      [
        'out_of_steps',
        'Sweep desk stopped after 4 steps without an answer. It used read 4 times. Ask it again with more detail.',
      ],
    ]);
  });

  it('answers once as a team, though its lead is certified', async () => {
    const certificate = {
      issued: true as const,
      n: 60,
      k: 3,
      delta: 0.05,
      epsilon: 0.1,
      curve: [],
      assumption: 'Requests like the calibration ones.',
      threshold: { votes: 2, answered: 50, errors: 1, coverage: 50 / 60, bound: 0.09 },
      checks: [],
    };
    const world = await setup([{ text: 'The total is 5.\nANSWER: 5' }], {
      lead: { job: { name: 'Assay desk' }, certificate },
    });
    const { reply } = await ask(world, 'What is the total?');
    expect(reply).toMatchObject({ status: 'done', team: true });
    expect(reply.steps.some((step) => step.kind === 'attempt')).toBe(false);
    expect(world.model.chats()).toHaveLength(1);
  });

  it('fails a send cleanly when a teammate is closed while it opens again', async () => {
    const world = await setup([]);
    const installation = world.engine.installations.get(world.sweep.id);
    if (!installation) throw new Error('Sweep desk is not installed.');
    world.engine.installations.put({
      ...installation,
      grants: { ...installation.grants, writes: 'allow' },
      updatedAt: '2026-11-06T09:00:00.000Z',
    });
    const chat = await world.host.createTeamChat(world.team.id);
    // The send opens Sweep desk again, since its installation changed; it closes meanwhile.
    const sending = world.host.send(chat.id, 'Ask Sweep desk.');
    const closing = world.host.closeGraduate(world.sweep.id);
    await expect(sending).rejects.toThrow("Sweep desk isn't ready to chat yet");
    await closing;
    expect(await world.host.messages(chat.id)).toEqual([]);
    expect((await world.host.listTeamChats(world.team.id))[0]).toMatchObject({ running: false });
    expect(world.model.chats()).toEqual([]);
    // It stays closed: the next send is refused the same way.
    await expect(world.host.send(chat.id, 'Again.')).rejects.toThrow("isn't ready to chat yet");
  });

  it('opens and runs alone an agent with a helper named ask_teammate from before teams', async () => {
    const world = await setup(
      [{ toolCalls: [{ name: ASK_TEAMMATE, arguments: {} }] }, { text: 'The helper said 7.' }],
      {
        sweep: {
          job: { name: 'Sweep desk' },
          harness: {
            tools: [
              {
                name: ASK_TEAMMATE,
                description: 'A helper from before teams.',
                parameters: { type: 'object' },
                code: 'function run() { return 7; }',
              },
            ],
          },
        },
      },
    );
    const chat = await world.host.createChat(world.sweep.id);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Use your helper.');
    const reply = await done;
    expect(reply).toMatchObject({ status: 'done', text: 'The helper said 7.' });
    expect(reply.steps).toMatchObject([
      { kind: 'tool', name: ASK_TEAMMATE, meta: '7', status: 'done' },
    ]);
    expect(reply.team).toBeUndefined();
  });

  it('refuses to answer until every agent in the team is open here', async () => {
    const world = await setup([], { open: ['grd_assay'] });
    const chat = await world.host.createTeamChat(world.team.id);
    await expect(world.host.send(chat.id, 'Hello?')).rejects.toThrow("Sweep desk isn't ready");
    expect(world.model.chats()).toEqual([]);
  });

  it("keeps the teammate's version for the whole reply, though another becomes active", async () => {
    const world = await setup([
      { toolCalls: [{ name: ASK_TEAMMATE, arguments: { member: 'Sweep desk', request: 'One?' } }] },
      { text: 'ANSWER: 1' },
      { text: 'Done.', chunk: 2, delayMs: 20 },
    ]);
    const chat = await world.host.createTeamChat(world.team.id);
    const asked = nextReply(world, chat.id, (message) =>
      (message.consultations ?? []).some((each) => each.outcome === 'answered'),
    );
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Ask once.');
    await asked;
    // The installation changes, as promoting another version does; nothing reopens mid-reply.
    const installation = world.engine.installations.get(world.sweep.id);
    if (!installation) throw new Error('Sweep desk is not installed.');
    world.engine.installations.put({
      ...installation,
      grants: { ...installation.grants, writes: 'allow' },
      updatedAt: '2026-11-06T09:00:00.000Z',
    });
    await world.host.openGraduate(world.sweep.id);
    const reply = await done;
    expect(reply.status).toBe('done');
    expect(reply.consultations?.[0]?.version).toBe(1);
  });

  it('closes off a team reply left running when the host last stopped', async () => {
    const world = await setup([]);
    const store = workspaceStore(world.engine, world.dataDir);
    const chat: WorkspaceChat = {
      id: 'cht_left',
      graduateId: world.lead.id,
      teamId: world.team.id,
      title: 'Count',
      createdAt: AT,
      updatedAt: AT,
      running: true,
      waiting: false,
    };
    store.upsertChat(chat);
    const inner = {
      id: 'step-1',
      kind: 'tool' as const,
      name: 'read',
      detail: 'data/invoices.csv',
      status: 'running' as const,
    };
    store.appendMessage({
      id: 'msg_left',
      chatId: chat.id,
      role: 'agent',
      createdAt: AT,
      text: '',
      steps: [
        {
          id: 'step-1',
          kind: 'consult',
          name: 'Sweep desk',
          detail: 'Count.',
          status: 'running',
          view: { kind: 'consult', graduateId: 'grd_sweep', version: 1, steps: [inner] },
        },
      ],
      consultations: [
        {
          stepId: 'step-1',
          graduateId: 'grd_sweep',
          version: 1,
          request: 'Count.',
          work: [],
          text: '',
        },
      ],
      blocks: [],
      status: 'streaming',
      team: true,
    });
    await world.host.openGraduate(world.lead.id);
    const [message] = await world.host.messages(chat.id);
    expect(message).toMatchObject({
      status: 'error',
      steps: [
        {
          status: 'done',
          view: { outcome: 'stopped', steps: [{ status: 'done', meta: 'stopped' }] },
        },
      ],
      consultations: [{ outcome: 'stopped' }],
    });
    expect((await world.host.listTeamChats(world.team.id))[0]).toMatchObject({ running: false });
  });

  it("stops a team's replies when the team goes", async () => {
    const world = await setup([
      asks('Count slowly.'),
      { text: 'One, two, three.', chunk: 1, delayMs: 50 },
    ]);
    const chat = await world.host.createTeamChat(world.team.id);
    const working = nextReply(world, chat.id, (message) => consultOf(message) !== undefined);
    const done = settled(world, chat.id);
    await world.host.send(chat.id, 'Count.');
    await working;
    await world.host.closeTeam(world.team.id);
    expect((await done).status).toBe('stopped');
  });
});

describe('a team reply at the GPU', () => {
  function otherProcess(world: World): GpuLease {
    return new GpuLease({ dataDir: world.dataDir, owner: 'engine', pollMs: 25 });
  }

  it("lets the GPU go while a teammate's write waits, then takes it back to finish", async () => {
    const world = await setup([
      asks('Add the invoice.'),
      {
        toolCalls: [
          { name: 'append', arguments: { path: 'data/invoices.csv', text: NEW_INVOICE } },
        ],
      },
      { text: 'Added.\nANSWER: INV-4' },
      { text: 'Sweep desk added it.' },
    ]);
    const engine = otherProcess(world);
    try {
      const chat = await world.host.createTeamChat(world.team.id);
      const waiting = pendingApproval(world, chat.id);
      const done = settled(world, chat.id);
      await world.host.send(chat.id, 'Add an invoice to Halden.');
      const approval = await waiting;
      // Both the lead's hold and the teammate's let go, so another process gets the GPU now.
      const check = await engine.hold('llama-server', CHECK_PURPOSE);
      const waitingAgain = nextReply(world, chat.id, (message) =>
        message.steps.some((step) => step.kind === 'wait'),
      );
      await world.host.decide(approval.changeId, 'approve');
      await waitingAgain;
      expect(world.model.chats()).toHaveLength(2);
      check.release();
      expect(await done).toMatchObject({ status: 'done', text: 'Sweep desk added it.' });
    } finally {
      await engine.close();
    }
  });

  it('stops a teammate still waiting to take the GPU back after an approval', async () => {
    const world = await setup([
      asks('Add the invoice.'),
      {
        toolCalls: [
          { name: 'append', arguments: { path: 'data/invoices.csv', text: NEW_INVOICE } },
        ],
      },
    ]);
    const engine = otherProcess(world);
    try {
      const chat = await world.host.createTeamChat(world.team.id);
      const waiting = pendingApproval(world, chat.id);
      const done = settled(world, chat.id);
      await world.host.send(chat.id, 'Add an invoice to Halden.');
      const approval = await waiting;
      const check = await engine.hold('llama-server', CHECK_PURPOSE);
      const waitingAgain = nextReply(world, chat.id, (message) =>
        message.steps.some((step) => step.kind === 'wait'),
      );
      await world.host.decide(approval.changeId, 'approve');
      await waitingAgain;
      await world.host.stop(chat.id);
      const reply = await done;
      expect(reply.status).toBe('stopped');
      expect(reply.consultations?.[0]?.outcome).toBe('stopped');
      expect(world.errors).toEqual([]);
      check.release();
    } finally {
      await engine.close();
    }
  });

  it('runs a teammate on llama-server while the lead runs on Ollama, and teammates with different adapters in turn', async () => {
    const adapter = (dataDir: string, seed: number, scale: number) => {
      const base = storeBase(join(dataDir, 'ollama-models'));
      return { bytes: standInAdapter(base.header, seed), baseDigest: base.digest, scale };
    };
    const world = await setup(
      [
        {
          toolCalls: [
            { name: ASK_TEAMMATE, arguments: { member: 'Sweep desk', request: 'Your scale?' } },
            { name: ASK_TEAMMATE, arguments: { member: 'Grid desk', request: 'Yours?' } },
          ],
        },
        { text: 'Both answered.' },
      ],
      {
        llamaServer: (dataDir) => fakeLlamaCommand(join(dataDir, 'llama-server.jsonl')),
        sweep: (dataDir) => ({ job: { name: 'Sweep desk' }, adapter: adapter(dataDir, 1, 0.6) }),
        more: async (dataDir, ollamaUrl) => [
          {
            id: 'grd_grid',
            baseUrl: ollamaUrl,
            job: { name: 'Grid desk' },
            adapter: adapter(dataDir, 2, 0.8),
          },
        ],
      },
    );
    const { reply } = await ask(world, 'Ask both.');
    expect(reply.status).toBe('done');
    expect(reply.consultations?.map((each) => [each.graduateId, each.outcome, each.text])).toEqual([
      ['grd_sweep', 'answered', 'lora=[{"id":0,"scale":0.6}]'],
      ['grd_grid', 'answered', 'lora=[{"id":0,"scale":0.8}]'],
    ]);
    // The lead's two turns went to Ollama; the teammates' went to llama-server.
    expect(world.model.chats()).toHaveLength(2);
  });
});
