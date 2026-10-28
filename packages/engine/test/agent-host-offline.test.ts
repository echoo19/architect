import { fork, type ChildProcess, type Serializable } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkspaceMessage } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { connectAgentHost, type AgentHostClient } from '../src/agent-host/client';
import { BLOCKED_LOG_PREFIX } from '../src/agent-host/guard/install';
import { isLoopbackHost } from '../src/agent-host/guard/loopback';
import type { AgentHostPort } from '../src/agent-host/protocol';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore } from '../src/store/engine-store';
import type { ObservedConnection } from './agent-host/connection-observer';
import { startFakeOllama, type FakeOllama } from './agent-host/fake-ollama';
import { addGraduate } from './agent-host/graduates';
import {
  fakeLlamaCommand,
  flag,
  recorded,
  standInAdapter,
  storeBase,
} from './support/adapter-runtime';

/*
 * The offline guarantee, end to end: the real agent host entry runs in its own process, with
 * its network guard, and answers a chat through a model server on 127.0.0.1. Any network call
 * added to the workspace path fails this test twice over: the guard blocks and reports it, and
 * the observer underneath the guard records whatever gets out.
 */

const ENTRY = fileURLToPath(new URL('../src/agent-host/main.ts', import.meta.url));
const OBSERVER = new URL('./agent-host/connection-observer.ts', import.meta.url).href;

let cleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

interface HostProcess {
  client: AgentHostClient;
  /** Closes the connection and waits for the process to exit; resolves with its stderr. */
  stop(): Promise<string>;
}

function startHostProcess(
  dataDir: string,
  connectionLog: string,
  extra: { args?: string[]; env?: Record<string, string> } = {},
): HostProcess {
  const child: ChildProcess = fork(ENTRY, ['--data-dir', dataDir, ...(extra.args ?? [])], {
    cwd: dirname(ENTRY),
    execArgv: ['--import', 'tsx', '--import', OBSERVER],
    // Nothing from this environment: no proxy settings, no keys.
    env: { ARCHITECT_CONNECTION_LOG: connectionLog, ...extra.env },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    // Structured clone, like Electron's ports: a void result arrives as a present `undefined`.
    serialization: 'advanced',
    windowsHide: true,
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  const port: AgentHostPort = {
    postMessage: (message) => {
      child.send(message as Serializable);
    },
    onMessage: (handler) => {
      child.on('message', handler);
    },
  };
  const client = connectAgentHost(port);
  return {
    client,
    async stop() {
      client.close();
      if (child.connected) child.disconnect();
      await exited;
      return stderr;
    },
  };
}

async function readConnections(file: string): Promise<ObservedConnection[]> {
  const text = await readFile(file, 'utf8').catch(() => '');
  return text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as ObservedConnection);
}

function settledReply(client: AgentHostClient, chatId: string): Promise<WorkspaceMessage> {
  return new Promise((resolve) => {
    const stop = client.onEvent((event) => {
      if (event.type !== 'message.updated') return;
      const { message } = event;
      if (message.chatId !== chatId || message.role !== 'agent') return;
      if (message.status === 'streaming') return;
      stop();
      resolve(message);
    });
  });
}

describe('a graduate in the workspace', () => {
  it('works with no network: its only connections go to the local model', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'architect-offline-'));
    const connectionLog = join(dataDir, 'connections.jsonl');
    const model: FakeOllama = await startFakeOllama([
      { toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }] },
      { text: 'There are 3 invoices on file.' },
    ]);
    const store = openEngineStore(new DataPaths(dataDir).database);
    const local = await addGraduate(dataDir, store, { id: 'grd_local', baseUrl: model.url });
    const remote = await addGraduate(dataDir, store, {
      id: 'grd_remote',
      baseUrl: 'https://api.example.com/v1',
    });
    store.close();
    const host = startHostProcess(dataDir, connectionLog);
    cleanup = async () => {
      await host.stop();
      await model.close();
      await rm(dataDir, { recursive: true, force: true });
    };
    const { client } = host;

    await client.openGraduate(local.id);
    const chat = await client.createChat(local.id);
    const replied = settledReply(client, chat.id);
    await client.send(chat.id, 'How many invoices are there?');
    const reply = await replied;
    expect(reply).toMatchObject({
      status: 'done',
      text: 'There are 3 invoices on file.',
      steps: [{ name: 'read', detail: 'data/invoices.csv', meta: '4 lines', status: 'done' }],
    });
    expect(model.chats()).toHaveLength(2);

    const requestsBefore = model.requests.length;
    await expect(client.openGraduate(remote.id)).rejects.toMatchObject({
      name: 'GuardError',
      guard: 'network',
    });
    expect(model.requests).toHaveLength(requestsBefore);

    expect(await client.blockedConnections()).toEqual([]);
    const stderr = await host.stop();
    expect(stderr).not.toContain(BLOCKED_LOG_PREFIX);

    const observed = await readConnections(connectionLog);
    const connects = observed.filter((entry) => entry.type === 'connect');
    expect(connects.length).toBeGreaterThan(0);
    for (const { host: target, port, guarded } of connects) {
      expect({ target, port: String(port), guarded }).toEqual({
        target: '127.0.0.1',
        port: new URL(model.url).port,
        guarded: true,
      });
    }
    for (const entry of observed) {
      if (entry.type === 'connected') expect(isLoopbackHost(entry.address ?? '')).toBe(true);
      if (entry.type === 'lookup') expect(isLoopbackHost(String(entry.name))).toBe(true);
    }
    expect(JSON.stringify(observed)).not.toContain('example.com');
  }, 60_000);

  it('serves a version with an adapter through llama-server on 127.0.0.1, and reaches nothing else', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'architect-offline-adapter-'));
    const connectionLog = join(dataDir, 'connections.jsonl');
    const record = join(dataDir, 'llama-server.jsonl');
    const models = join(dataDir, 'ollama-models');
    const base = storeBase(models);
    const ollama = await startFakeOllama([]);
    const store = openEngineStore(new DataPaths(dataDir).database);
    const graduate = await addGraduate(dataDir, store, {
      id: 'grd_adapter',
      baseUrl: ollama.url,
      adapter: { bytes: standInAdapter(base.header), baseDigest: base.digest, scale: 0.6 },
    });
    store.close();
    const host = startHostProcess(dataDir, connectionLog, {
      args: ['--llama-server-command', JSON.stringify(fakeLlamaCommand(record))],
      env: { OLLAMA_MODELS: models },
    });
    cleanup = async () => {
      await host.stop();
      await ollama.close();
      await rm(dataDir, { recursive: true, force: true });
    };
    const { client } = host;

    await client.configure({ ollamaUrl: ollama.url });
    await client.openGraduate(graduate.id);
    const chat = await client.createChat(graduate.id);
    const replied = settledReply(client, chat.id);
    await client.send(chat.id, 'Which invoices are open?');
    expect(await replied).toMatchObject({ status: 'done', text: 'lora=[{"id":0,"scale":0.6}]' });
    // Before llama-server started, Ollama was asked to let go of the GPU; it was never asked to chat.
    expect(new Set(ollama.requests.map((request) => request.path))).toEqual(new Set(['/api/ps']));

    expect(await client.blockedConnections()).toEqual([]);
    const stderr = await host.stop();
    expect(stderr).not.toContain(BLOCKED_LOG_PREFIX);
    // llama-server went with the host that started it.
    const [started] = recorded(record).filter((entry) => entry.kind === 'start');
    expect(started?.pid).toBeDefined();
    expect(isRunning(started?.pid ?? 0)).toBe(false);

    const serverPort = flag(started?.argv, '--port');
    const observed = await readConnections(connectionLog);
    const connects = observed.filter((entry) => entry.type === 'connect');
    expect(connects.some(({ port }) => String(port) === serverPort)).toBe(true);
    for (const { host: target, port, guarded } of connects) {
      expect({ target, guarded }).toEqual({ target: '127.0.0.1', guarded: true });
      expect([new URL(ollama.url).port, serverPort]).toContain(String(port));
    }
    for (const entry of observed) {
      if (entry.type === 'connected') expect(isLoopbackHost(entry.address ?? '')).toBe(true);
      if (entry.type === 'lookup') expect(isLoopbackHost(String(entry.name))).toBe(true);
    }
  }, 60_000);
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
