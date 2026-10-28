import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GuardError,
  type ImportRequest,
  type WorkspaceEvent,
  type WorkspaceMessage,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentHost, type AgentHost } from '../src/agent-host/host';
import { workspaceStore } from '../src/agent-host/store';
import { exportPackage } from '../src/graduates/exporter';
import { importPackage } from '../src/graduates/importer';
import { activeVersion } from '../src/graduates/open';
import { startFakeOllama, type FakeOllama } from './agent-host/fake-ollama';
import {
  fakeLlamaCommand,
  flag,
  recorded,
  standInAdapter,
  storeBase,
  type StoredBase,
} from './support/adapter-runtime';
import {
  addVersion,
  harnessWith,
  newComputer,
  THIS_MACHINE,
  type Computer,
  type ComputerOptions,
} from './support/computer';
import { SAMPLE_CONTENT } from './support/fixtures';

/*
 * Graduates that carry an adapter, served by llama.cpp on the base from Ollama's store (decision
 * 041): in the workspace's agent host, through rollbacks and restarts, and on another computer
 * after an export. llama-server is always the stand-in; nothing here loads a model.
 */

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function computer(options: ComputerOptions = {}): Promise<Computer> {
  const made = await newComputer(THIS_MACHINE, options);
  cleanups.push(() => made.remove());
  return made;
}

/** A computer with the stand-in llama-server, which records into a file of the test's. */
async function withLlamaServer(...flags: string[]): Promise<{ made: Computer; record: string }> {
  const folder = await mkdtemp(join(tmpdir(), 'architect-llama-record-'));
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  const record = join(folder, 'record.jsonl');
  return { made: await computer({ llamaServer: fakeLlamaCommand(record, ...flags) }), record };
}

async function fakeOllama(): Promise<FakeOllama> {
  const started = await startFakeOllama([]);
  cleanups.push(() => started.close());
  return started;
}

function host(made: Computer): AgentHost {
  const opened = createAgentHost({
    store: workspaceStore(made.store, made.dataDir),
    adapters: made.workspaceRuntime(),
  });
  cleanups.push(() => opened.close());
  return opened;
}

/** Sends a message in a chat and waits for the reply to settle. */
async function reply(agent: AgentHost, chatId: string, text: string): Promise<WorkspaceMessage> {
  const settled = new Promise<WorkspaceMessage>((resolve) => {
    const stop = agent.onEvent((event: WorkspaceEvent) => {
      if (event.type !== 'message.updated') return;
      const { message } = event;
      if (message.chatId !== chatId || message.role !== 'agent') return;
      if (message.status === 'streaming') return;
      stop();
      resolve(message);
    });
  });
  await agent.send(chatId, text);
  return settled;
}

const adapterOf = (made: Computer, version: number) =>
  join(made.paths.versionDir('grd_desk', version), 'adapter', 'adapter.gguf');

const starts = (record: string) => recorded(record).filter((entry) => entry.kind === 'start');
const chats = (record: string) => recorded(record).filter((entry) => entry.kind === 'chat');

/** What the stand-in answers once a tool result is in: the adapters' scales it was sent. */
const scaled = (scale: number) => `lora=[{"id":0,"scale":${scale}}]`;

describe('serving a version that carries an adapter', () => {
  it('answers through llama.cpp with its adapter at its scale on every request, never through Ollama', async () => {
    const { made, record } = await withLlamaServer();
    const base = storeBase(made.modelsDir);
    const ollama = await fakeOllama();
    await addVersion(made, {
      graduateId: 'grd_desk',
      baseUrl: ollama.url,
      adapter: standInAdapter(base.header),
      adapterIdentity: { scale: 0.75, baseDigest: base.digest },
    });
    expect(made.library.summary('grd_desk').manifest.student.adapter).toEqual({ scale: 0.75 });

    const agent = host(made);
    await agent.openGraduate('grd_desk');
    const chat = await agent.createChat('grd_desk');
    expect(await reply(agent, chat.id, 'Which invoices are open?')).toMatchObject({
      status: 'done',
      text: scaled(0.75),
      graduateVersion: 1,
    });

    // One server: the base from Ollama's store, the version's own adapter loaded unapplied.
    const [started, ...more] = starts(record);
    expect(more).toEqual([]);
    expect(flag(started?.argv, '--alias')).toBe('muse-glimmer:30b');
    expect(flag(started?.argv, '--lora')).toBe(adapterOf(made, 1));
    expect(started?.argv).toContain('--lora-init-without-apply');
    expect(flag(started?.argv, '--host')).toBe('127.0.0.1');
    // Both turns of the reply (the read, then the answer) applied the adapter at its scale.
    expect(chats(record).map((entry) => entry.body?.['lora'])).toEqual([
      [{ id: 0, scale: 0.75 }],
      [{ id: 0, scale: 0.75 }],
    ]);
    expect(ollama.requests).toEqual([]);
  });

  it('rolls back to the earlier version with its own adapter, harness and scale, and keeps them after a restart', async () => {
    const { made: first, record } = await withLlamaServer();
    let made = first;
    const base = storeBase(made.modelsDir);
    await addVersion(made, {
      graduateId: 'grd_desk',
      harness: harnessWith('Service desk', { system: 'Harness of version one.' }),
      adapter: standInAdapter(base.header, 1),
      adapterIdentity: { scale: 1, baseDigest: base.digest },
    });
    await addVersion(made, {
      graduateId: 'grd_desk',
      parent: 1,
      harness: harnessWith('Service desk', { system: 'Harness of version two.' }),
      adapter: standInAdapter(base.header, 2),
      adapterIdentity: { scale: 0.5, baseDigest: base.digest },
    });
    made.library.promote('grd_desk', 2);
    const agent = host(made);
    await agent.openGraduate('grd_desk');
    const chat = await agent.createChat('grd_desk');
    expect(await reply(agent, chat.id, 'First?')).toMatchObject({
      text: scaled(0.5),
      graduateVersion: 2,
    });

    made.library.rollback('grd_desk', 1);
    expect(await reply(agent, chat.id, 'Second?')).toMatchObject({
      text: scaled(1),
      graduateVersion: 1,
    });
    // The server restarted with version one's adapter in place of version two's.
    expect(starts(record).map((entry) => flag(entry.argv, '--lora'))).toEqual([
      adapterOf(made, 2),
      adapterOf(made, 1),
    ]);
    const system = (index: number) => {
      const messages = chats(record)[index]?.body?.['messages'] as { content?: string }[];
      return messages[0]?.content ?? '';
    };
    expect(system(0)).toContain('Harness of version two.');
    expect(system(2)).toContain('Harness of version one.');
    expect(system(2)).not.toContain('Harness of version two.');

    await agent.close();
    made = made.restart();
    cleanups.push(() => made.remove());
    const again = host(made);
    await again.openGraduate('grd_desk');
    const after = await again.createChat('grd_desk');
    expect(await reply(again, after.id, 'After the restart?')).toMatchObject({
      text: scaled(1),
      graduateVersion: 1,
    });
    expect(
      starts(record)
        .map((entry) => flag(entry.argv, '--lora'))
        .at(-1),
    ).toBe(adapterOf(made, 1));
  });

  it('refuses a base of another build and an adapter that changed, and says how to put it right', async () => {
    const { made, record } = await withLlamaServer();
    // The build its adapter was trained on is elsewhere; Ollama here has another under its name.
    const trainedOn = storeBase(join(made.dataDir, 'elsewhere'));
    storeBase(made.modelsDir, 'muse-glimmer:30b', 3);
    await addVersion(made, {
      graduateId: 'grd_desk',
      adapter: standInAdapter(trainedOn.header),
      adapterIdentity: { baseDigest: trainedOn.digest },
    });
    const agent = host(made);
    const refused = await agent.openGraduate('grd_desk').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(GuardError);
    expect((refused as GuardError).message).toContain(
      "Version 1 of Service desk wasn't opened. muse-glimmer:30b on this computer is another build",
    );
    expect((refused as GuardError).message).toContain(
      `Install the build of muse-glimmer:30b whose weights are ${trainedOn.digest}`,
    );

    // With the right build in place it opens; an adapter changed afterwards never loads.
    storeBase(made.modelsDir);
    await agent.openGraduate('grd_desk');
    const file = adapterOf(made, 1);
    await writeFile(file, Buffer.concat([await readFile(file), Buffer.from('changed')]));
    const chat = await agent.createChat('grd_desk');
    const failed = await reply(agent, chat.id, 'Still there?');
    expect(failed.status).toBe('error');
    expect(failed.error).toContain("isn't the file it was installed with");
    expect(starts(record)).toEqual([]);
  });

  it('never runs a version with an adapter on a runtime that would leave the adapter out', async () => {
    const made = await computer();
    const base = storeBase(made.modelsDir);
    const ollama = await fakeOllama();
    await addVersion(made, {
      graduateId: 'grd_desk',
      baseUrl: ollama.url,
      adapter: standInAdapter(base.header),
      adapterIdentity: { baseDigest: base.digest },
    });
    const installation = await made.library.bind('grd_desk', {
      model: { runtime: 'openai_compatible', baseUrl: `${ollama.url}/v1`, model: 'muse-glimmer' },
    });
    expect(installation.status).toBe('needs_attention');
    expect(installation.reasons).toContainEqual(
      expect.stringContaining('Set its model to muse-glimmer:30b on Ollama.'),
    );
    await expect(host(made).openGraduate('grd_desk')).rejects.toThrow(
      "carries a LoRA adapter, which llama.cpp applies to its base from Ollama's model store",
    );
    expect(ollama.requests).toEqual([]);
  });
});

describe('A07: a package with an adapter, installed on another computer', () => {
  const GRANTS: ImportRequest['grants'] = { writes: 'ask', resources: { data: 'read_write' } };

  /** The author's graduate with a stand-in adapter trained on their base, exported. */
  async function authored(): Promise<{ archive: string; base: StoredBase }> {
    const author = await computer();
    const base = storeBase(author.modelsDir);
    await addVersion(author, {
      graduateId: 'grd_desk',
      adapter: standInAdapter(base.header),
      adapterIdentity: { scale: 0.8, baseDigest: base.digest, standIn: true },
    });
    const exported = await exportPackage(
      { library: author.library, secrets: { get: async () => undefined } },
      'grd_desk',
      { directory: join(author.dataDir, 'exports') },
    );
    return { archive: exported.archive, base };
  }

  /** Installs the archive on `made` with its own folder of records for `data/`. */
  async function install(made: Computer, archive: string) {
    const folder = join(made.dataDir, 'their-records');
    await mkdir(folder, { recursive: true });
    for (const [name, content] of Object.entries(SAMPLE_CONTENT)) {
      await writeFile(join(folder, name), content, 'utf8');
    }
    return importPackage({ library: made.library }, archive, {
      bindings: { data: folder },
      grants: GRANTS,
    });
  }

  it('installs it where llama-server and its base are missing, and says what each needs', async () => {
    const { archive, base } = await authored();
    const recipient = await computer();
    const result = await install(recipient, archive);
    expect(result).toMatchObject({ version: 1, alreadyInstalled: false });
    expect(result.installation.status).toBe('needs_attention');
    expect(result.installation.reasons).toEqual([
      "llama-server isn't installed, or isn't on PATH. Install llama.cpp (build 10358 or newer), then choose its llama-server in Settings or add its folder to PATH.",
      `Its base, muse-glimmer:30b, isn't in Ollama's model folder on this computer. Download muse-glimmer:30b (about 1 GB), the build whose weights are ${base.digest}: its adapter loads on no other.`,
    ]);
    expect(result.installation.checks.slice(-3)).toMatchObject([
      { id: 'adapter-runtime', status: 'failed' },
      { id: 'model-available', status: 'failed' },
      { id: 'model-responds', status: 'skipped' },
    ]);

    // It opens, since each problem can be fixed here, and a reply says what is missing.
    const agent = host(recipient);
    await agent.openGraduate('grd_desk');
    const chat = await agent.createChat('grd_desk');
    const failed = await reply(agent, chat.id, 'Hello?');
    expect(failed.status).toBe('error');
    expect(failed.error).toContain("llama-server isn't installed");
  });

  it('is ready where llama-server and the exact base are, and answers through llama.cpp', async () => {
    const { archive, base } = await authored();
    const { made: recipient, record } = await withLlamaServer();
    expect(storeBase(recipient.modelsDir).digest).toBe(base.digest);
    const result = await install(recipient, archive);
    expect(result.installation.status).toBe('ready');
    expect(result.installation.reasons).toEqual([]);
    expect(result.installation.checks.slice(-3)).toMatchObject([
      {
        id: 'adapter-runtime',
        status: 'passed',
        detail: `llama-server build 10472, at ${process.execPath}.`,
      },
      {
        id: 'model-available',
        status: 'passed',
        detail: `muse-glimmer:30b in Ollama's store, the build its adapter was trained on (${base.digest.slice(0, 19)}), and its adapter as installed.`,
      },
      { id: 'model-responds', status: 'passed' },
    ]);
    // The check's request applied the adapter, and its server stopped afterwards.
    expect(chats(record)[0]?.body?.['lora']).toEqual([{ id: 0, scale: 0.8 }]);
    expect(recipient.adapterRuntime.status().state).toBe('stopped');
    expect(recipient.library.summary('grd_desk').manifest.student.adapter).toEqual({
      scale: 0.8,
      standIn: true,
    });

    const agent = host(recipient);
    await agent.openGraduate('grd_desk');
    const chat = await agent.createChat('grd_desk');
    expect(await reply(agent, chat.id, 'Which invoices are open?')).toMatchObject({
      status: 'done',
      text: scaled(0.8),
    });
  });

  it('blocks it on a base of another build, naming the exact base it was trained on', async () => {
    const { archive, base } = await authored();
    const { made: recipient } = await withLlamaServer();
    storeBase(recipient.modelsDir, 'muse-glimmer:30b', 3);
    const result = await install(recipient, archive);
    expect(result.installation.status).toBe('blocked');
    expect(result.installation.reasons).toEqual([
      expect.stringMatching(
        /^muse-glimmer:30b on this computer is another build \(weights sha256:[0-9a-f]{12}\) than the one its adapter was trained on/,
      ),
    ]);
    expect(result.installation.reasons[0]).toContain(
      `Install the build of muse-glimmer:30b whose weights are ${base.digest}, the exact base it was trained on, in place of this one. It is about 1 GB.`,
    );
    await expect(activeVersion(recipient.store, recipient.paths, 'grd_desk')).rejects.toThrow(
      "can't run on this computer",
    );
  });

  it('needs attention with a llama-server too old for Glimmer, and says to update it', async () => {
    const { archive } = await authored();
    const { made: recipient, record } = await withLlamaServer('--fake-build', '9000');
    storeBase(recipient.modelsDir);
    const result = await install(recipient, archive);
    expect(result.installation.status).toBe('needs_attention');
    expect(result.installation.reasons).toEqual([
      'llama-server is build 9000, older than 10358, the first that runs Muse Glimmer. Update llama.cpp to build 10358 or newer.',
    ]);
    expect(starts(record)).toEqual([]);
  });
});
