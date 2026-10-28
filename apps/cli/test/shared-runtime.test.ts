import { fork, type Serializable } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { connectAgentHost, type AgentHostPort } from '@architect/engine/agent-host';
import {
  AGENT_HOST_ENTRY,
  CONNECTION_OBSERVER,
  openEngineStore,
  type ObservedConnection,
} from '@architect/engine/testing';
import { RunResultSchema, type WorkspaceMessage } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanUp, machineWith, spawnCli, tempDir, type Machine } from './support';

afterEach(cleanUp);

const QUESTION = 'How many invoices are there?';
const READ_THEN_ANSWER = [
  { toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }] },
  { text: 'There are 3 invoices on file.' },
];

/**
 * One message through the desktop's path: the agent host's own process entry, started the way
 * the app starts it and spoken to over its port, as the workspace does.
 */
async function desktopReply(machine: Machine, text: string): Promise<WorkspaceMessage> {
  const child = fork(AGENT_HOST_ENTRY, ['--data-dir', machine.dataDir], {
    cwd: dirname(AGENT_HOST_ENTRY),
    execArgv: ['--import', 'tsx'],
    env: {},
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    serialization: 'advanced',
    windowsHide: true,
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
  try {
    await client.openGraduate(machine.graduate.id);
    const chat = await client.createChat(machine.graduate.id);
    const settled = new Promise<WorkspaceMessage>((resolve) => {
      const stop = client.onEvent((event) => {
        if (event.type !== 'message.updated') return;
        const { message } = event;
        if (message.chatId !== chat.id || message.role !== 'agent') return;
        if (message.status === 'streaming') return;
        stop();
        resolve(message);
      });
    });
    await client.send(chat.id, text);
    return await settled;
  } finally {
    client.close();
    if (child.connected) child.disconnect();
    await exited;
  }
}

describe('A10: the terminal and the desktop run a graduate the same way', () => {
  it('gives the same outcome from the same loader and runtime, recording the version and setup', async () => {
    const machine = await machineWith([...READ_THEN_ANSWER, ...READ_THEN_ANSWER]);
    const desktop = await desktopReply(machine, QUESTION);

    const work = await tempDir('a10');
    const input = join(work, 'request.json');
    const output = join(work, 'result.json');
    const log = join(work, 'connections.jsonl');
    await writeFile(input, JSON.stringify({ format: 'architect.run-request/1', task: QUESTION }));
    const run = await spawnCli(
      ['run', 'service-desk', '--input', input, '--output', output, '--non-interactive'],
      {
        env: { ...machine.env, ARCHITECT_CONNECTION_LOG: log },
        execArgv: ['--import', 'tsx', '--import', CONNECTION_OBSERVER],
      },
    );
    expect(run.code, run.stderr).toBe(0);
    const result = RunResultSchema.parse(JSON.parse(await readFile(output, 'utf8')));

    // The same task-level outcome: the answer, the steps and the version that wrote it.
    expect(desktop).toMatchObject({ status: 'done', graduateVersion: 1 });
    expect(result.status).toBe('succeeded');
    expect(result.answer).toBe(desktop.text);
    expect(result.steps).toEqual(
      desktop.steps.map((step) => ({
        tool: step.name,
        detail: step.detail,
        status: step.status,
        summary: step.meta,
        ms: expect.any(Number),
      })),
    );
    // With the version and setup recorded: the package digest and harness, and the local model.
    const store = openEngineStore(join(machine.dataDir, 'architect.db'));
    const version = store.versions.get('grd_desk', 1);
    store.close();
    expect(result.agent).toMatchObject({
      id: 'grd_desk',
      version: desktop.graduateVersion,
      digest: version?.digest,
      harness_hash: version?.manifest.harness.hash,
      contract_version: version?.contractVersion,
      model: { runtime: 'ollama', name: 'muse-glimmer:30b', base_url: machine.model.url },
    });
    expect(result.architect.cli_version).toMatch(/^\d+\.\d+\.\d+$/);

    // The same loader and runtime: the model was sent the same system prompt, history, tools and
    // tool results by both, turn for turn. Only the sampler seed differs between replies.
    const [first, second, third, fourth] = machine.model.chats();
    const sent = (chat: typeof first) => ({ messages: chat?.messages, tools: chat?.tools });
    expect(sent(third)).toEqual(sent(first));
    expect(sent(fourth)).toEqual(sent(second));

    // And the command kept the workspace's network guard: every connection it made went to the
    // local model, through the guard.
    const observed = (await readFile(log, 'utf8'))
      .split('\n')
      .filter((entry) => entry !== '')
      .map((entry) => JSON.parse(entry) as ObservedConnection);
    const connects = observed.filter((entry) => entry.type === 'connect');
    expect(connects.length).toBeGreaterThan(0);
    for (const entry of connects) {
      if (entry.type !== 'connect') continue;
      expect({ host: entry.host, port: String(entry.port), guarded: entry.guarded }).toEqual({
        host: '127.0.0.1',
        port: new URL(machine.model.url).port,
        guarded: true,
      });
    }
  }, 60_000);

  it('refuses a graduate whose model is not on this computer, as the workspace does', async () => {
    const machine = await machineWith([]);
    const store = openEngineStore(join(machine.dataDir, 'architect.db'));
    const installation = store.installations.get('grd_desk');
    if (!installation) throw new Error('no installation');
    store.installations.put({
      ...installation,
      model: { ...installation.model, baseUrl: 'https://api.example.com/v1' },
    });
    store.close();
    const work = await tempDir('a10-remote');
    const input = join(work, 'request.json');
    await writeFile(input, JSON.stringify({ format: 'architect.run-request/1', task: QUESTION }));
    const run = await spawnCli(['run', 'service-desk', '--input', input, '--non-interactive'], {
      env: machine.env,
    });
    expect(run.code).toBe(3);
    expect(JSON.parse(run.stdout)).toMatchObject({
      status: 'not_permitted',
      error: { code: 'guard_network' },
    });
    expect(run.stderr).toContain("isn't this computer");
  }, 60_000);
});
