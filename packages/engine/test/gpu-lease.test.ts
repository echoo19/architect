import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudent } from '@architect/adapters';
import { AdapterError, DecodingSchema, type StudentAdapter } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECK_PURPOSE,
  GpuLease,
  LlamaServer,
  LocalRuntimeError,
  replyPurpose,
  RUN_PURPOSE,
  type GpuLeaseOptions,
  type GpuUse,
} from '../src/local-runtime';
import {
  conflicts,
  emptyLease,
  mayJoinBusy,
  mayTake,
  ranksAhead,
  shouldYield,
  type LeaseState,
} from '../src/local-runtime/lease-rules';
import { startFakeOllama, type FakeOllama } from './agent-host/fake-ollama';
import { fakeLlamaCommand, recorded } from './support/adapter-runtime';

/*
 * The GPU lease (decision 046) between leases on one data folder in this process: each has a
 * token of its own, so each plays one of Architect's processes. `gpu-lease-processes.test.ts`
 * runs the same between real processes.
 */

let dir: string;
const leases: GpuLease[] = [];
const servers: LlamaServer[] = [];
const ollamas: FakeOllama[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'architect-gpu-lease-'));
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
  await Promise.all(leases.splice(0).map((lease) => lease.close()));
  await Promise.all(ollamas.splice(0).map((ollama) => ollama.close()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function lease(owner: string, options: Partial<GpuLeaseOptions> = {}): GpuLease {
  const made = new GpuLease({ dataDir: dir, owner, pollMs: 10, heartbeatMs: 100, ...options });
  leases.push(made);
  return made;
}

/** What a use of the GPU did when its process was asked to give it up. */
function served(gpu: GpuLease, use: GpuUse, events: string[], name: string) {
  const state = { resident: true };
  gpu.serve(use, {
    release: async () => {
      await pause(20);
      state.resident = false;
      events.push(`${name} let go`);
    },
    resident: () => state.resident,
  });
  return state;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, ms = 5000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('The condition never held.');
    await pause(10);
  }
}

/** Whether a promise has settled yet, without waiting for it. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending');
  const raced = await Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    pause(0).then(() => marker),
  ]);
  return raced !== marker;
}

function leaseFile(): LeaseState {
  const file = join(dir, 'local-runtime', 'gpu-lease.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as LeaseState) : emptyLease();
}

/** The id of a process that has exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
  return Number(child.stdout.toString());
}

describe('the rules of the lease', () => {
  const place = (user: string, rank: number, since: number) => ({ user, rank, since });

  it('lets Ollama users share the GPU and gives a llama-server the GPU alone', () => {
    expect(conflicts('ollama', 'ollama')).toBe(false);
    expect(conflicts('ollama', 'llama-server')).toBe(true);
    expect(conflicts('llama-server', 'llama-server')).toBe(true);
  });

  it('puts a reply before a check before a run, then whoever waited longest', () => {
    expect(ranksAhead(place('a', 2, 9), place('b', 1, 1))).toBe(true);
    expect(ranksAhead(place('a', 1, 1), place('b', 1, 2))).toBe(true);
    expect(ranksAhead(place('b', 1, 2), place('a', 1, 1))).toBe(false);
  });

  it('decides who may take, join, or must give up the GPU', () => {
    const state: LeaseState = {
      holders: [
        {
          user: 'w:llama-server',
          pid: 1,
          owner: 'workspace',
          use: 'llama-server',
          beat: 0,
          busy: false,
          leaving: false,
          doing: '',
          hint: '',
        },
      ],
      asks: [
        {
          user: 'e:ollama',
          pid: 2,
          owner: 'engine',
          use: 'ollama',
          beat: 0,
          rank: 1,
          since: 5,
          doing: '',
        },
      ],
    };
    // Nobody takes what a llama-server holds, and nobody overtakes a check that waits first.
    expect(mayTake(state, 'ollama', place('c:ollama', 2, 1))).toBe(false);
    expect(mayTake({ ...state, holders: [] }, 'llama-server', place('c:llama-server', 1, 9))).toBe(
      false,
    );
    expect(mayTake({ ...state, holders: [] }, 'llama-server', place('c:llama-server', 2, 9))).toBe(
      true,
    );
    // A busy user's own requests join unless someone of a higher rank waits.
    expect(mayJoinBusy(state, 'w:llama-server', 'llama-server', 2)).toBe(true);
    expect(mayJoinBusy(state, 'w:llama-server', 'llama-server', 0)).toBe(false);
    // An idle holder gives up for a conflicting ask, unless its own next request goes first.
    const holder = { user: 'w:llama-server', use: 'llama-server' as const };
    expect(shouldYield(state, holder, null)).toBe(true);
    expect(shouldYield(state, holder, place('w:llama-server', 2, 7))).toBe(false);
  });
});

describe('the GPU lease between processes', () => {
  it('lets Ollama users share the GPU, and a llama-server waits for all of them', async () => {
    const workspace = lease('workspace');
    const engine = lease('engine');
    const shared = [
      await workspace.hold('ollama', replyPurpose('Returns desk')),
      await engine.hold('ollama', RUN_PURPOSE),
    ];
    const cli = lease('cli', { waitMs: 300 });
    await expect(cli.hold('llama-server', replyPurpose('Returns desk'))).rejects.toMatchObject({
      name: 'LocalRuntimeError',
      code: 'gpu_busy',
      message:
        'The GPU is busy: the workspace is answering a chat with Returns desk and Architect is using it for a training run.',
      hint: 'Wait for that reply to finish, or stop it, then try again.',
    });
    for (const hold of shared) hold.release();
    (await lease('cli').hold('llama-server', replyPurpose('Returns desk'))).release();
  });

  it('has an idle holder give the GPU up when another process asks, before the asker has it', async () => {
    const events: string[] = [];
    const workspace = lease('workspace');
    served(workspace, 'llama-server', events, 'the workspace');
    (await workspace.hold('llama-server', replyPurpose('Returns desk'))).release();
    await until(() => leaseFile().holders[0]?.busy === false);
    expect(leaseFile().holders).toMatchObject([{ owner: 'workspace', busy: false }]);

    const hold = await lease('engine').hold('llama-server', CHECK_PURPOSE);
    events.push('the engine has it');
    expect(events).toEqual(['the workspace let go', 'the engine has it']);
    expect(leaseFile().holders).toMatchObject([{ owner: 'engine', busy: true }]);
    hold.release();
  });

  it('lets a busy holder keep the GPU, and ends the wait with who has it and what to do', async () => {
    const events: string[] = [];
    const workspace = lease('workspace');
    served(workspace, 'llama-server', events, 'the workspace');
    const reply = await workspace.hold('llama-server', replyPurpose('Returns desk'));
    const started = Date.now();
    const error = await lease('engine', { waitMs: 400 })
      .hold('llama-server', CHECK_PURPOSE)
      .catch((caught: unknown) => caught);
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    expect(error).toBeInstanceOf(LocalRuntimeError);
    expect(error).toMatchObject({
      code: 'gpu_busy',
      message: 'The GPU is busy: the workspace is answering a chat with Returns desk.',
      hint: 'Wait for that reply to finish, or stop it, then try again.',
    });
    expect(events).toEqual([]);
    // The ask that gave up is gone, so the holder isn't asked to let go for nobody.
    expect(leaseFile().asks).toEqual([]);
    reply.release();
  });

  it('serves a reply before a check, and a run between its requests only after both', async () => {
    const engine = lease('engine');
    const firstRequest = await engine.hold('llama-server', RUN_PURPOSE);
    const order: string[] = [];
    const take = (gpu: GpuLease, name: string, purpose = RUN_PURPOSE) =>
      gpu.hold('llama-server', purpose).then((hold) => {
        order.push(name);
        return hold;
      });
    const check = take(lease('cli'), 'check', CHECK_PURPOSE);
    await until(() => leaseFile().asks.length === 1);
    const reply = take(lease('workspace'), 'reply', replyPurpose('Returns desk'));
    await until(() => leaseFile().asks.length === 2);
    // The run finishes its request and asks for the next one: it waits its turn behind both.
    firstRequest.release();
    const nextRequest = take(engine, 'run');
    (await reply).release();
    (await check).release();
    (await nextRequest).release();
    expect(order).toEqual(['reply', 'check', 'run']);
  });

  it("lets a reply's own requests go on while it holds the GPU, whoever waits", async () => {
    const workspace = lease('workspace');
    const wholeReply = await workspace.hold('llama-server', replyPurpose('Returns desk'));
    const check = lease('engine').hold('llama-server', CHECK_PURPOSE);
    await until(() => leaseFile().asks.length === 1);
    for (let turn = 0; turn < 3; turn++) {
      (await workspace.hold('llama-server', replyPurpose('Returns desk'))).release();
    }
    expect(await settled(check)).toBe(false);
    wholeReply.release();
    (await check).release();
  });

  it("keeps a run's next request behind a check that waits, even while the run is busy", async () => {
    const engine = lease('engine');
    const running = await engine.hold('llama-server', RUN_PURPOSE);
    const order: string[] = [];
    const check = lease('cli')
      .hold('llama-server', CHECK_PURPOSE)
      .then((hold) => (order.push('check'), hold));
    await until(() => leaseFile().asks.length === 1);
    const overlapping = engine
      .hold('llama-server', RUN_PURPOSE)
      .then((hold) => (order.push('run'), hold));
    await pause(50);
    expect(order).toEqual([]);
    running.release();
    (await check).release();
    (await overlapping).release();
    expect(order).toEqual(['check', 'run']);
  });

  it('stops a request that is still waiting when it is called off', async () => {
    const reply = await lease('workspace').hold('llama-server', replyPurpose('Returns desk'));
    const controller = new AbortController();
    const waiting = lease('engine').hold('llama-server', CHECK_PURPOSE, controller.signal);
    await until(() => leaseFile().asks.length === 1);
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(AdapterError);
    await expect(waiting).rejects.toMatchObject({ code: 'aborted' });
    await until(() => leaseFile().asks.length === 0);
    reply.release();
  });

  it('stops blocking at once for a holder whose process has exited', async () => {
    const gone = deadPid();
    mkdirSync(join(dir, 'local-runtime'), { recursive: true });
    const state: LeaseState = {
      holders: [
        {
          user: 'gone:llama-server',
          pid: gone,
          owner: 'cli',
          use: 'llama-server',
          beat: Date.now(),
          busy: true,
          leaving: false,
          doing: 'answering a chat with Returns desk',
          hint: '',
        },
      ],
      asks: [],
    };
    writeFileSync(join(dir, 'local-runtime', 'gpu-lease.json'), JSON.stringify(state));
    const started = Date.now();
    const hold = await lease('workspace', { waitMs: 30_000 }).hold('ollama', RUN_PURPOSE);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(leaseFile().holders.map((holder) => holder.owner)).toEqual(['workspace']);
    hold.release();
  });

  it('stops blocking for a holder that stopped saying it is there, though its id is in use', async () => {
    mkdirSync(join(dir, 'local-runtime'), { recursive: true });
    const state: LeaseState = {
      holders: [
        {
          user: 'hung:llama-server',
          // A live process: as when a holder died and the system gave its id to another.
          pid: process.pid,
          owner: 'engine',
          use: 'llama-server',
          beat: Date.now() - 1_000,
          busy: true,
          leaving: false,
          doing: 'using it for a training run',
          hint: '',
        },
      ],
      asks: [],
    };
    writeFileSync(join(dir, 'local-runtime', 'gpu-lease.json'), JSON.stringify(state));
    const hold = await lease('workspace', { staleMs: 500, waitMs: 5_000 }).hold(
      'llama-server',
      replyPurpose('Returns desk'),
    );
    hold.release();
  });

  it('keeps a busy holder that goes on saying it is there, however long it takes', async () => {
    const reply = await lease('workspace').hold('llama-server', replyPurpose('Returns desk'));
    await expect(
      lease('engine', { staleMs: 300, waitMs: 1_000 }).hold('llama-server', CHECK_PURPOSE),
    ).rejects.toMatchObject({ code: 'gpu_busy' });
    reply.release();
  });

  it('stops the llama-server a holder that died left running, before the GPU goes to anyone', async () => {
    const record = join(dir, 'record.jsonl');
    const serverDir = join(dir, 'local-runtime', 'cli');
    const orphan = new LlamaServer({ runtimeDir: serverDir });
    servers.push(orphan);
    await orphan.ensure({
      command: fakeLlamaCommand(record),
      modelPath: join(dir, 'base.gguf'),
      alias: 'muse-glimmer:30b',
      adapters: [],
      contextSize: 16_384,
      gpuLayers: 999,
    });
    const orphanPid = orphan.status().pid ?? 0;
    const state: LeaseState = {
      holders: [
        {
          user: 'gone:llama-server',
          pid: deadPid(),
          owner: 'cli',
          use: 'llama-server',
          beat: Date.now(),
          busy: false,
          leaving: false,
          doing: 'answering a chat with Returns desk',
          hint: '',
          serverDir,
        },
      ],
      asks: [],
    };
    writeFileSync(join(dir, 'local-runtime', 'gpu-lease.json'), JSON.stringify(state));
    const hold = await lease('workspace').hold('llama-server', replyPurpose('Returns desk'));
    expect(alive(orphanPid)).toBe(false);
    expect(recorded(record).filter((entry) => entry.kind === 'start')).toHaveLength(1);
    hold.release();
  });

  it('takes away a lock that a process left behind when it died mid-change', async () => {
    mkdirSync(join(dir, 'local-runtime'), { recursive: true });
    writeFileSync(
      join(dir, 'local-runtime', 'gpu-lease.lock'),
      JSON.stringify({ pid: deadPid(), token: 'gone', at: Date.now() }),
    );
    const started = Date.now();
    (await lease('workspace').hold('llama-server', replyPurpose('Returns desk'))).release();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("takes a process's entries away when it closes, or exits", async () => {
    const workspace = lease('workspace');
    const reply = await workspace.hold('llama-server', replyPurpose('Returns desk'));
    const engine = lease('engine');
    const waiting = engine.hold('llama-server', CHECK_PURPOSE);
    await until(() => leaseFile().asks.length === 1);
    // Closing ends what waits and takes the process's entries away.
    await engine.close();
    await expect(waiting).rejects.toMatchObject({ code: 'aborted' });
    expect(leaseFile().asks).toEqual([]);
    reply.release();
    await workspace.close();
    expect(leaseFile()).toEqual(emptyLease());

    // A process that exits takes its entries away in the same step.
    const cli = lease('cli');
    await cli.hold('ollama', RUN_PURPOSE);
    expect(leaseFile().holders.map((holder) => holder.owner)).toEqual(['cli']);
    cli.leaveNow();
    expect(leaseFile()).toEqual(emptyLease());
  });
});

describe('Ollama under the lease', () => {
  const decoding = DecodingSchema.parse({});

  async function ollama(): Promise<FakeOllama> {
    const started = await startFakeOllama([{ text: 'One.' }, { text: 'Two.' }, { text: 'Three.' }]);
    ollamas.push(started);
    return started;
  }

  async function ask(student: StudentAdapter): Promise<string> {
    let text = '';
    for await (const event of student.chat({
      messages: [{ role: 'user', content: 'Hello?' }],
      tools: [],
      decoding,
      seed: 1,
    })) {
      if (event.type === 'text') text += event.delta;
    }
    return text;
  }

  it('holds the GPU for each request to Ollama here, and for nothing else', async () => {
    const model = await ollama();
    const gpu = lease('workspace');
    const endpoint = {
      runtime: 'ollama' as const,
      baseUrl: model.url,
      model: 'muse-glimmer:30b',
      contextLength: 16_384,
    };
    const plain = createStudent(endpoint);
    const leased = gpu.ollama.student(endpoint, plain, replyPurpose('Returns desk'));
    expect(leased).not.toBe(plain);
    const elsewhere = { ...endpoint, baseUrl: 'https://ollama.example.com' };
    expect(gpu.ollama.student(elsewhere, plain, RUN_PURPOSE)).toBe(plain);
    const other = { ...endpoint, runtime: 'openai_compatible' as const };
    expect(gpu.ollama.student(other, plain, RUN_PURPOSE)).toBe(plain);

    // A llama-server holds the GPU busy: the request waits its turn, then goes.
    const engine = lease('engine');
    const check = await engine.hold('llama-server', CHECK_PURPOSE);
    const answer = ask(leased);
    await until(() => leaseFile().asks.length === 1);
    expect(model.chats()).toEqual([]);
    check.release();
    expect(await answer).toBe('One.');
    expect(leaseFile().holders).toMatchObject([{ owner: 'workspace', use: 'ollama' }]);
  });

  it('unloads the models it used when a llama-server asks, then lets the server go', async () => {
    const model = await ollama();
    const gpu = lease('workspace');
    const endpoint = {
      runtime: 'ollama' as const,
      baseUrl: model.url,
      model: 'muse-glimmer:30b',
      contextLength: 16_384,
    };
    const leased = gpu.ollama.student(endpoint, createStudent(endpoint), replyPurpose('Desk'));
    expect(await ask(leased)).toBe('One.');
    const unloads = () =>
      model.requests.filter(
        (request) =>
          request.path === '/api/chat' &&
          (request.body as { keep_alive?: number }).keep_alive === 0,
      );
    expect(unloads()).toEqual([]);

    const hold = await lease('engine').hold('llama-server', CHECK_PURPOSE);
    expect(unloads()).toMatchObject([{ body: { model: 'muse-glimmer:30b', keep_alive: 0 } }]);
    hold.release();
  });

  it("lets the GPU go once Ollama's own keep-alive has passed", async () => {
    const model = await ollama();
    const gpu = lease('workspace', { ollamaKeepAliveMs: 100 });
    const endpoint = {
      runtime: 'ollama' as const,
      baseUrl: model.url,
      model: 'muse-glimmer:30b',
      contextLength: 16_384,
    };
    await ask(gpu.ollama.student(endpoint, createStudent(endpoint), RUN_PURPOSE));
    expect(leaseFile().holders).toHaveLength(1);
    await until(() => leaseFile().holders.length === 0, 3_000);
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
