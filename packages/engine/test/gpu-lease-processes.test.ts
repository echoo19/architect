import { fork, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudent } from '@architect/adapters';
import { AdapterError, DecodingSchema, type StudentAdapter } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHECK_PURPOSE,
  GpuLease,
  LocalAdapterRuntime,
  RUN_PURPOSE,
  type GpuPriority,
  type ServeRequest,
} from '../src/local-runtime';
import { startFakeOllama, type FakeOllama } from './agent-host/fake-ollama';
import {
  fakeLlamaCommand,
  recorded,
  standInAdapter,
  storeBase,
  type Recorded,
} from './support/adapter-runtime';

/*
 * The GPU lease (decision 046) between real processes: a child that plays one of Architect's
 * processes (`fixtures/gpu-user.ts`) and this test's process, which plays another, each with its
 * own lease and its own stand-in llama-server, on one data folder. Every stand-in records which
 * others were running when it started, so two servers on the GPU at once would show.
 */

const GPU_USER = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'gpu-user.ts');

let dir: string;
let models: string;
let record: string;
let request: ServeRequest;
const cleanups: (() => Promise<void>)[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'architect-gpu-processes-'));
  models = join(dir, 'ollama-models');
  record = join(dir, 'llama-server.jsonl');
  const base = storeBase(models);
  const adapterPath = join(dir, 'desk.gguf');
  const adapter = standInAdapter(base.header);
  writeFileSync(adapterPath, adapter);
  request = {
    model: 'muse-glimmer:30b',
    adapters: [
      {
        key: 'Returns desk v1',
        path: adapterPath,
        sha256: createHash('sha256').update(adapter).digest('hex'),
      },
    ],
    scales: { 'Returns desk v1': 1 },
    baseDigest: base.digest,
  };
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

interface GpuUser {
  child: ChildProcess;
  serve(priority: GpuPriority): Promise<string>;
  hold(priority: GpuPriority): Promise<number>;
  release(): Promise<void>;
  ollama(baseUrl: string, priority: GpuPriority): Promise<string>;
  serverPid(): Promise<number | null>;
}

/** Starts another of Architect's processes, as `owner`, on this test's data folder. */
async function startUser(owner: string): Promise<GpuUser> {
  const child = fork(GPU_USER, [dir, owner, JSON.stringify(fakeLlamaCommand(record)), models], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    serialization: 'advanced',
    windowsHide: true,
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  cleanups.push(async () => {
    if (child.connected) child.disconnect();
    await exited;
  });
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let nextId = 1;
  await new Promise<void>((resolve) => {
    child.on('message', (raw) => {
      const message = raw as {
        ready?: boolean;
        id?: number;
        ok?: boolean;
        result?: unknown;
        error?: { name: string; message: string; code?: string; hint?: string };
      };
      if (message.ready) {
        resolve();
        return;
      }
      const settle = waiting.get(message.id ?? 0);
      waiting.delete(message.id ?? 0);
      if (message.ok) settle?.resolve(message.result);
      else settle?.reject(Object.assign(new Error(message.error?.message), message.error));
    });
  });
  const send = (message: Record<string, unknown>) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      child.send({ id, ...message });
    });
  return {
    child,
    serve: async (priority) => String(await send({ kind: 'serve', request, priority })),
    hold: async (priority) => Number(await send({ kind: 'hold', request, priority })),
    release: async () => {
      await send({ kind: 'release' });
    },
    ollama: async (baseUrl, priority) =>
      String(await send({ kind: 'ollama', baseUrl, model: 'muse-glimmer:30b', priority })),
    serverPid: async () => (await send({ kind: 'server' })) as number | null,
  };
}

/** This test's own process as one of Architect's: its lease and its llama-server. */
function thisProcess(
  owner: string,
  waitMs = 30_000,
): { gpu: GpuLease; runtime: LocalAdapterRuntime } {
  const gpu = new GpuLease({ dataDir: dir, owner, pollMs: 25, heartbeatMs: 200, waitMs });
  const runtime = new LocalAdapterRuntime({
    runtimeDir: join(dir, 'local-runtime', owner),
    ollamaModelsDir: () => models,
    env: {},
    freeGpu: async () => undefined,
    command: fakeLlamaCommand(record),
    gpu,
  });
  cleanups.push(async () => {
    await runtime.stop();
    await gpu.close();
  });
  return { gpu, runtime };
}

const starts = (): Recorded[] => recorded(record).filter((entry) => entry.kind === 'start');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(condition: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('The condition never held.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const decoding = DecodingSchema.parse({});

async function ask(student: StudentAdapter): Promise<string> {
  let text = '';
  for await (const event of student.chat({
    messages: [{ role: 'user', content: 'Which invoices are open?' }],
    tools: [],
    decoding,
    seed: 1,
  })) {
    if (event.type === 'text') text += event.delta;
  }
  return text;
}

describe('the GPU lease between two processes', () => {
  it("stops another process's idle llama-server before this process starts its own", async () => {
    const workspace = await startUser('workspace');
    expect(await workspace.serve('reply')).toBe('lora=[{"id":0,"scale":1}]');
    const theirs = (await workspace.serverPid()) ?? 0;
    expect(alive(theirs)).toBe(true);

    const engine = thisProcess('engine');
    const lease = await engine.runtime.access(request, CHECK_PURPOSE).acquire();
    try {
      expect(alive(theirs)).toBe(false);
      expect(await workspace.serverPid()).toBeNull();
      const [first, second] = starts();
      expect(first?.pid).toBe(theirs);
      expect(second?.pid).toBe(engine.runtime.status().pid);
      expect(starts().map((start) => start.alongside)).toEqual([[], []]);
    } finally {
      lease.release();
    }
  }, 60_000);

  it('lets a busy process keep the GPU, and the wait ends with who has it and what to do', async () => {
    const workspace = await startUser('workspace');
    const theirs = await workspace.hold('reply');

    const engine = thisProcess('engine', 1_500);
    const started = Date.now();
    const error = await engine.runtime
      .access(request, CHECK_PURPOSE)
      .acquire()
      .catch((caught: unknown) => caught);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_500);
    // A student sees the runtime's error, which stops an evaluation rather than failing a task.
    expect(error).toBeInstanceOf(AdapterError);
    expect(error).toMatchObject({
      code: 'server',
      message:
        'The GPU is busy: the workspace is answering a chat with Returns desk. Wait for that reply to finish, or stop it, then try again.',
    });
    expect(alive(theirs)).toBe(true);
    expect(starts()).toHaveLength(1);

    // Once its reply is done, the GPU is free to take.
    await workspace.release();
    const lease = await thisProcess('cli').runtime.access(request, RUN_PURPOSE).acquire();
    lease.release();
    expect(alive(theirs)).toBe(false);
    expect(starts().map((start) => start.alongside)).toEqual([[], []]);
  }, 60_000);

  it('stops an idle llama-server before this process sends Ollama a request', async () => {
    const workspace = await startUser('workspace');
    await workspace.serve('reply');
    const theirs = (await workspace.serverPid()) ?? 0;
    const serverRanDuringChat: boolean[] = [];
    const ollama: FakeOllama = await startFakeOllama([{ text: 'Two are open.' }], {
      onChat: () => serverRanDuringChat.push(alive(theirs)),
    });
    cleanups.push(() => ollama.close());

    const { gpu } = thisProcess('engine');
    const endpoint = {
      runtime: 'ollama' as const,
      baseUrl: ollama.url,
      model: 'muse-glimmer:30b',
      contextLength: 16_384,
    };
    expect(await ask(gpu.ollama.student(endpoint, createStudent(endpoint), RUN_PURPOSE))).toBe(
      'Two are open.',
    );
    expect(serverRanDuringChat).toEqual([false]);
  }, 60_000);

  it('takes the GPU over from a process that was killed holding it, and stops the server it left', async () => {
    const cli = await startUser('cli');
    const orphan = await cli.hold('reply');
    cli.child.kill('SIGKILL');
    await new Promise<void>((resolve) => {
      if (cli.child.exitCode !== null || cli.child.signalCode !== null) resolve();
      else cli.child.once('exit', () => resolve());
    });
    // On macOS and Linux its llama-server outlives it, holding the GPU, until the next process
    // to take the GPU stops it. Windows ends the server with it: Node's children are in a job
    // that closes with their parent. `gpu-lease.test.ts` stops a server that outlived its holder.

    const workspace = thisProcess('workspace');
    const started = Date.now();
    const lease = await workspace.runtime.access(request, RUN_PURPOSE).acquire();
    lease.release();
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(alive(orphan)).toBe(false);
    expect(starts().map((start) => start.alongside)).toEqual([[], []]);
    await until(() => !alive(orphan));
  }, 60_000);
});
