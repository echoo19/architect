import { cp, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PackageError, type WorkspaceEvent, type WorkspaceMessage } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentHost, type AgentHost } from '../src/agent-host/host';
import { workspaceStore } from '../src/agent-host/store';
import { activeVersion } from '../src/graduates/open';
import { startFakeOllama, type FakeOllama } from './agent-host/fake-ollama';
import { addVersion, harnessWith, newComputer, type Computer } from './support/computer';
import { makeJob, SAMPLE_FILES } from './support/fixtures';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function computer(): Promise<Computer> {
  const made = await newComputer();
  cleanups.push(() => made.remove());
  return made;
}

async function model(script: Parameters<typeof startFakeOllama>[0]): Promise<FakeOllama> {
  const started = await startFakeOllama(script);
  cleanups.push(() => started.close());
  return started;
}

function host(made: Computer): AgentHost {
  const opened = createAgentHost({
    store: workspaceStore(made.store, made.dataDir),
    adapters: made.workspaceRuntime(),
    gpu: made.workspaceGpu,
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

describe('graduate versions', () => {
  it('keeps a candidate apart until it is accepted and then promoted, as separate steps', async () => {
    const made = await computer();
    const { library } = made;
    await addVersion(made, { graduateId: 'grd_desk' });
    made.clock.advance(60_000);
    await addVersion(made, {
      graduateId: 'grd_desk',
      parent: 1,
      state: 'candidate',
      harness: harnessWith('Service desk', { system: 'Version two of the desk.' }),
    });

    expect(library.summary('grd_desk')).toMatchObject({ activeVersion: 1, versions: 2 });
    expect(library.versions('grd_desk')).toMatchObject([
      { version: 1, state: 'accepted', active: true },
      { version: 2, state: 'candidate', active: false, parent: 1 },
    ]);
    expect(() => library.promote('grd_desk', 2)).toThrow("hasn't been accepted");
    expect(library.acceptVersion('grd_desk', 2)).toMatchObject({
      state: 'accepted',
      active: false,
    });
    expect(library.summary('grd_desk').activeVersion).toBe(1);

    expect(library.promote('grd_desk', 2)).toMatchObject({ activeVersion: 2 });
    expect(() => library.rejectVersion('grd_desk', 2)).toThrow('the one chats run on');
    expect(() => library.rollback('grd_desk', 2)).not.toThrow();
    expect(() => library.rollback('grd_desk', 3)).toThrow('has no version 3');
    expect(
      library.history('grd_desk').map(({ kind, version, from }) => [kind, version, from]),
    ).toEqual([
      ['created', 1, undefined],
      ['accepted', 1, undefined],
      ['promoted', 1, undefined],
      ['created', 2, undefined],
      ['accepted', 2, undefined],
      ['promoted', 2, 1],
    ]);
  });

  it('never rewrites a version: accepting one changes its record, not its folder', async () => {
    const made = await computer();
    const first = await addVersion(made, { graduateId: 'grd_desk', state: 'candidate' });
    const folder = made.paths.fromStored(first.path);
    const before = await readFile(join(folder, 'graduate.json'), 'utf8');
    made.library.acceptVersion('grd_desk', 1);
    expect(await readFile(join(folder, 'graduate.json'), 'utf8')).toBe(before);
    expect(made.library.summary('grd_desk').manifest.acceptedAt).toBeDefined();
    await expect(activeVersion(made.store, made.paths, 'grd_desk')).resolves.toMatchObject({
      version: { digest: first.digest },
    });
  });
});

describe('A06: a graduate after a restart and a rollback', () => {
  it('restores the harness and the adapter of the version it rolls back to, together', async () => {
    let made = await computer();
    await addVersion(made, {
      graduateId: 'grd_desk',
      harness: harnessWith('Service desk', { system: 'Harness of version one.' }),
      adapter: 'LORA WEIGHTS OF VERSION ONE',
      adapterIdentity: { scale: 1, trainingJobId: 'trn_one' },
    });
    await addVersion(made, {
      graduateId: 'grd_desk',
      parent: 1,
      harness: harnessWith('Service desk', { system: 'Harness of version two.' }),
      adapter: 'LORA WEIGHTS OF VERSION TWO',
      adapterIdentity: { scale: 0.75, trainingJobId: 'trn_two' },
    });
    made.library.promote('grd_desk', 2);

    // What the adapter runtime would be asked to serve: the base by name, and the version's own
    // GGUF LoRA at the scale it was measured at.
    const readActive = async () => {
      const active = await activeVersion(made.store, made.paths, 'grd_desk');
      const served = active.adapter;
      const file = served?.adapters[0];
      return {
        version: active.version.version,
        system: await readFile(join(active.harnessDir, 'AGENTS.md'), 'utf8'),
        adapter: await readFile(file?.path ?? '', 'utf8'),
        model: served?.model,
        scale: file === undefined ? undefined : served?.scales[file.key],
        trainingJobId: active.version.manifest.model.adapter?.trainingJobId,
      };
    };
    expect(await readActive()).toEqual({
      version: 2,
      system: 'Harness of version two.',
      adapter: 'LORA WEIGHTS OF VERSION TWO',
      model: 'muse-glimmer:30b',
      scale: 0.75,
      trainingJobId: 'trn_two',
    });

    made.library.rollback('grd_desk', 1);
    const rolledBack = {
      version: 1,
      system: 'Harness of version one.',
      adapter: 'LORA WEIGHTS OF VERSION ONE',
      model: 'muse-glimmer:30b',
      scale: 1,
      trainingJobId: 'trn_one',
    };
    expect(await readActive()).toEqual(rolledBack);

    made = made.restart();
    cleanups.push(() => made.remove());
    expect(made.library.summary('grd_desk').activeVersion).toBe(1);
    expect(await readActive()).toEqual(rolledBack);
    expect(made.library.history('grd_desk').at(-1)).toMatchObject({
      kind: 'rolled_back',
      version: 1,
      from: 2,
    });

    // A version's adapter is checked with the rest of it, so one never loads with another's.
    const active = await activeVersion(made.store, made.paths, 'grd_desk');
    await writeFile(active.adapter?.adapters[0]?.path ?? '', 'LORA WEIGHTS OF VERSION TWO');
    const refused = await activeVersion(made.store, made.paths, 'grd_desk').catch(
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(PackageError);
    expect((refused as PackageError).code).toBe('checksum');
  });

  it('never sends a version with an adapter to Ollama, which would leave the adapter out', async () => {
    const made = await computer();
    const ollama = await model([{ text: 'unused' }]);
    await addVersion(made, {
      graduateId: 'grd_desk',
      adapter: 'LORA WEIGHTS',
      baseUrl: ollama.url,
    });
    // llama.cpp serves it (graduate-adapters.test.ts); a file that isn't a GGUF LoRA never loads.
    await expect(host(made).openGraduate('grd_desk')).rejects.toThrow(
      "The adapter for Service desk v1 is missing or isn't a GGUF file.",
    );
    expect(ollama.requests).toEqual([]);
  });

  it('reopens after a restart on the version it was rolled back to and answers offline', async () => {
    let made = await computer();
    const ollama = await model([{ text: 'Version one answers.' }, { text: 'Still version one.' }]);
    await addVersion(made, { graduateId: 'grd_desk', baseUrl: ollama.url });
    await addVersion(made, {
      graduateId: 'grd_desk',
      parent: 1,
      baseUrl: ollama.url,
      harness: harnessWith('Service desk', { system: 'Version two.' }),
    });
    made.library.promote('grd_desk', 2);
    made.library.rollback('grd_desk', 1);

    made = made.restart();
    cleanups.push(() => made.remove());
    const agent = host(made);
    await agent.openGraduate('grd_desk');
    const chat = await agent.createChat('grd_desk');
    expect(chat.graduateVersion).toBe(1);
    expect(await reply(agent, chat.id, 'Are you there?')).toMatchObject({
      status: 'done',
      text: 'Version one answers.',
      graduateVersion: 1,
    });
    expect(ollama.chats()[0]?.messages[0]?.content).toContain('You are the service desk');
    expect(ollama.chats()[0]?.messages[0]?.content).not.toContain('Version two.');
  });

  it('moves a chat to a promoted version between replies, and records which one answered', async () => {
    const made = await computer();
    const ollama = await model([{ text: 'One.' }, { text: 'Two.' }]);
    await addVersion(made, { graduateId: 'grd_desk', baseUrl: ollama.url });
    await addVersion(made, {
      graduateId: 'grd_desk',
      parent: 1,
      baseUrl: ollama.url,
      harness: harnessWith('Service desk', { system: 'The promoted desk.' }),
    });
    const agent = host(made);
    await agent.openGraduate('grd_desk');
    const chat = await agent.createChat('grd_desk');
    expect((await reply(agent, chat.id, 'First?')).graduateVersion).toBe(1);

    made.library.promote('grd_desk', 2);
    expect((await reply(agent, chat.id, 'Second?')).graduateVersion).toBe(2);
    expect(ollama.chats()[1]?.messages[0]?.content).toContain('The promoted desk.');
    const versions = (await agent.messages(chat.id)).map((message) => message.graduateVersion);
    expect(versions).toEqual([undefined, 1, undefined, 2]);
  });

  it('works in a newly bound folder from its next reply, and opening it again mid-reply waits', async () => {
    const made = await computer();
    const read = { toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }] };
    const ollama = await model([
      read,
      { text: 'Read the first folder.', delayMs: 40 },
      read,
      { text: 'Read the second folder.' },
    ]);
    await addVersion(made, { graduateId: 'grd_desk', baseUrl: ollama.url });
    const agent = host(made);
    await agent.openGraduate('grd_desk');
    const chat = await agent.createChat('grd_desk');
    const first = reply(agent, chat.id, 'What is on file?');

    const second = join(made.dataDir, 'second-folder');
    await cp(made.paths.workspaceDir('grd_desk'), second, { recursive: true });
    await writeFile(
      join(second, 'invoices.csv'),
      'invoice_id,customer_id,total_cents,due_date,paid\nINV-SECOND,C-1,100,2026-12-01,false\n',
    );
    await made.library.bind('grd_desk', { bindings: { data: second } });
    await expect(agent.openGraduate('grd_desk')).resolves.toBeUndefined();
    expect((await first).text).toBe('Read the first folder.');
    expect(ollama.chats()[1]?.messages.at(-1)?.content).toContain('INV-1');

    expect((await reply(agent, chat.id, 'And now?')).text).toBe('Read the second folder.');
    expect(ollama.chats()[3]?.messages.at(-1)?.content).toContain('INV-SECOND');
  });

  it('saves a new file in the output folder its installation bound, apart from its data', async () => {
    const made = await computer();
    const report = '# Overdue\n\nRuiz, Ben owes $45.50.\n';
    const ollama = await model([
      {
        toolCalls: [{ name: 'write', arguments: { path: 'output/overdue.md', content: report } }],
      },
      { text: 'Saved the overdue report.' },
    ]);
    const job = makeJob({
      id: 'job_desk',
      data: { files: SAMPLE_FILES, output: { description: 'Reports for the office.' } },
      permissions: { writes: 'allow', unseenFiles: 'never' },
    });
    await addVersion(made, { graduateId: 'grd_desk', job, baseUrl: ollama.url });
    const { manifest } = (await activeVersion(made.store, made.paths, 'grd_desk')).version;
    expect(manifest.contract.outputs.folder).toEqual({ description: 'Reports for the office.' });
    expect(manifest.resources.map((resource) => resource.name)).toEqual(['data', 'output']);

    const agent = host(made);
    await agent.openGraduate('grd_desk');
    const chat = await agent.createChat('grd_desk');
    expect((await reply(agent, chat.id, 'Write up who is overdue.')).text).toBe(
      'Saved the overdue report.',
    );
    const output = made.paths.outputDir('grd_desk');
    expect(await readFile(join(output, 'overdue.md'), 'utf8')).toBe(report);
    const inData = join(made.paths.workspaceDir('grd_desk'), 'output');
    expect(
      await stat(inData).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
  });
});
