import { fork, type ChildProcess, type Serializable } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { connectEngine, type EngineClient } from '@architect/engine';
import { connectAgentHost, type AgentHostClient } from '@architect/engine/agent-host';
import {
  addGraduate,
  AGENT_HOST_ENTRY,
  ENGINE_HOST_FIXTURE,
  fakeLlamaCommand,
  openEngineStore,
  recorded,
  standInAdapter,
  startFakeOllama,
  STATED_MACHINE,
  storeBase,
  THIS_MACHINE,
  type FakeOllama,
} from '@architect/engine/testing';
import { RunResultSchema, type WorkspaceMessage } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanUp, cli, tempDir, testEnv } from './support';

/*
 * The architect command beside the desktop app's two hosts on one computer (decision 046): the
 * workspace's agent host and the engine host each in their own process, as the app runs them,
 * and the command in this one, all on one data folder and one GPU. Each has its own llama-server,
 * the stand-in, and every stand-in records which others were running when it started.
 */

afterEach(cleanUp);

const ANSWER = 'lora=[{"id":0,"scale":0.6}]';

interface Computer {
  env: NodeJS.ProcessEnv;
  dataDir: string;
  models: string;
  record: string;
  ollama: FakeOllama;
  request: string;
}

async function computer(): Promise<Computer> {
  const env = await testEnv();
  const dataDir = env['ARCHITECT_USER_DATA'] ?? '';
  await mkdir(dataDir, { recursive: true });
  const models = await tempDir('ollama-models');
  const base = storeBase(models);
  const ollama = await startFakeOllama([]);
  const store = openEngineStore(join(dataDir, 'architect.db'));
  try {
    await addGraduate(dataDir, store, {
      id: 'grd_adapter',
      baseUrl: ollama.url,
      adapter: { bytes: standInAdapter(base.header), baseDigest: base.digest, scale: 0.6 },
    });
  } finally {
    store.close();
  }
  // The app's settings name this computer's Ollama, as the hosts' settings do.
  await writeFile(
    join(dataDir, 'settings.json'),
    JSON.stringify({
      defaultStudent: {
        runtime: 'ollama',
        baseUrl: ollama.url,
        model: 'muse-glimmer:30b',
        contextLength: 16384,
      },
    }),
  );
  const request = join(dataDir, 'request.json');
  await writeFile(
    request,
    JSON.stringify({ format: 'architect.run-request/1', task: 'Which invoices are open?' }),
  );
  return {
    env,
    dataDir,
    models,
    record: join(dataDir, 'llama-server.jsonl'),
    ollama,
    request,
  };
}

/**
 * Forks one of the desktop's hosts, the way the app gives it a channel to talk over, on
 * THIS_MACHINE as far as its installation checks can tell, as the command run in this process is.
 */
function forkHost(
  entry: string,
  args: string[],
  env: Record<string, string>,
): {
  child: ChildProcess;
  port: { postMessage(m: unknown): void; onMessage(h: (m: unknown) => void): void };
} {
  const child = fork(entry, args, {
    cwd: dirname(entry),
    execArgv: ['--import', 'tsx', '--import', STATED_MACHINE],
    env: { ...env, ARCHITECT_TEST_MACHINE: JSON.stringify(THIS_MACHINE) },
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    serialization: 'advanced',
    windowsHide: true,
  });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  cleanups(async () => {
    if (child.connected) child.disconnect();
    await exited;
  });
  return {
    child,
    port: {
      postMessage: (message) => {
        child.send(message as Serializable);
      },
      onMessage: (handler) => {
        child.on('message', handler);
      },
    },
  };
}

const registered: (() => Promise<void>)[] = [];
function cleanups(cleanup: () => Promise<void>): void {
  registered.push(cleanup);
}
afterEach(async () => {
  for (const cleanup of registered.splice(0).reverse()) await cleanup();
});

/** The workspace's agent host, as the app starts it, with the stand-in llama-server. */
async function workspace(machine: Computer): Promise<AgentHostClient> {
  const { port } = forkHost(
    AGENT_HOST_ENTRY,
    [
      '--data-dir',
      machine.dataDir,
      '--llama-server-command',
      JSON.stringify(fakeLlamaCommand(machine.record)),
    ],
    { OLLAMA_MODELS: machine.models },
  );
  const client = connectAgentHost(port);
  cleanups(async () => client.close());
  await client.configure({ ollamaUrl: machine.ollama.url });
  await client.openGraduate('grd_adapter');
  return client;
}

/** The engine host, as the app's utility process runs it, with the stand-in llama-server. */
async function engine(machine: Computer): Promise<EngineClient> {
  const { port } = forkHost(
    ENGINE_HOST_FIXTURE,
    [
      '--data-dir',
      machine.dataDir,
      '--llama-server-command',
      JSON.stringify(fakeLlamaCommand(machine.record)),
      '--ollama-url',
      machine.ollama.url,
    ],
    { OLLAMA_MODELS: machine.models },
  );
  const ready = new Promise<void>((resolve) =>
    port.onMessage((message) => {
      if ((message as { kind?: string }).kind === 'ready') resolve();
    }),
  );
  await ready;
  const client = connectEngine({
    postMessage: port.postMessage,
    // Only the engine's own messages: its readiness was the fixture's.
    onMessage: (handler) =>
      port.onMessage((message) => {
        if ((message as { kind?: string }).kind !== 'ready') handler(message);
      }),
  });
  cleanups(async () => client.close());
  return client;
}

/** Sends a message in a new chat and resolves with the reply once it has settled. */
async function chat(client: AgentHostClient, text: string): Promise<WorkspaceMessage> {
  const opened = await client.createChat('grd_adapter');
  const settled = new Promise<WorkspaceMessage>((resolve) => {
    const stop = client.onEvent((event) => {
      if (event.type !== 'message.updated') return;
      const { message } = event;
      if (message.chatId !== opened.id || message.role !== 'agent') return;
      if (message.status === 'streaming') return;
      stop();
      resolve(message);
    });
  });
  await client.send(opened.id, text);
  return settled;
}

/** Runs `architect run` in this process with its own stand-in, against the app's data folder. */
async function architectRun(machine: Computer, ...flags: string[]) {
  const previous = process.env['OLLAMA_MODELS'];
  process.env['OLLAMA_MODELS'] = machine.models;
  try {
    return await cli(['run', 'service-desk', '--input', machine.request, '--non-interactive'], {
      env: machine.env,
      llamaServerCommand: fakeLlamaCommand(machine.record, ...flags),
    });
  } finally {
    if (previous === undefined) delete process.env['OLLAMA_MODELS'];
    else process.env['OLLAMA_MODELS'] = previous;
  }
}

const starts = (record: string) => recorded(record).filter((entry) => entry.kind === 'start');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(condition: () => boolean, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('The condition never held.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("the architect command and the desktop's hosts share one GPU", () => {
  it('takes the GPU in turn from the workspace and the engine, never two servers at once', async () => {
    const machine = await computer();
    cleanups(() => machine.ollama.close());

    // The workspace answers a chat, and its llama-server stays loaded, idle.
    const desk = await workspace(machine);
    expect(await chat(desk, 'Which invoices are open?')).toMatchObject({
      status: 'done',
      text: ANSWER,
    });
    const [workspaceServer] = starts(machine.record);
    expect(alive(workspaceServer?.pid ?? 0)).toBe(true);

    // The engine checks the agent with its model loaded: the workspace's server stops first.
    const installation = await (
      await engine(machine)
    ).graduates.verify('grd_adapter', {
      loadModel: true,
    });
    expect(installation.status).toBe('ready');
    expect(installation.checks.find((check) => check.id === 'model-responds')).toMatchObject({
      status: 'passed',
    });
    expect(alive(workspaceServer?.pid ?? 0)).toBe(false);

    // The command runs the agent on its own llama-server, once the engine has let go.
    const run = await architectRun(machine);
    expect(run.code, run.stderr).toBe(0);
    expect(RunResultSchema.parse(JSON.parse(run.stdout))).toMatchObject({
      status: 'succeeded',
      answer: ANSWER,
    });

    // Three servers, one at a time: the workspace's, the engine's for its check, the command's.
    const all = starts(machine.record);
    expect(all).toHaveLength(3);
    expect(all.map((start) => start.alongside)).toEqual([[], [], []]);
  }, 90_000);

  it("makes the workspace wait while the command's reply runs, then gives it the GPU", async () => {
    const machine = await computer();
    cleanups(() => machine.ollama.close());
    const desk = await workspace(machine);

    // The command's reply is slow; the workspace's message arrives while it runs.
    const running = architectRun(machine, '--fake-reply-ms', '1500');
    await until(() => starts(machine.record).length === 1);
    const [commandServer] = starts(machine.record);
    const reply = chat(desk, 'Which invoices are open?');

    const run = await running;
    expect(run.code, run.stderr).toBe(0);
    expect(await reply).toMatchObject({ status: 'done', text: ANSWER });
    const all = starts(machine.record);
    expect(all.map((start) => start.pid)).toEqual([commandServer?.pid, all[1]?.pid]);
    expect(all.map((start) => start.alongside)).toEqual([[], []]);
  }, 90_000);
});
