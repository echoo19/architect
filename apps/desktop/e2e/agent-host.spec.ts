import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  harnessToFiles,
  hashHarness,
  metaToFile,
  readHarness,
  readPackage,
  writePackage,
  type PackageEntry,
} from '@architect/harness';
import {
  DEFAULT_STUDENT,
  type GraduateSummary,
  type HarnessTool,
  type Job,
  type WorkspaceChat,
  type WorkspaceMessage,
} from '@architect/shared';
import {
  BASE_NAME,
  flag,
  recorded,
  standInCommand,
  storeBase,
  withAdapter,
  type StoredBase,
} from './adapters';
import { goTo, launchApp, type LaunchedApp } from './app';
import { startFakeOllama, startFakeStudent, type FakeOllama } from './models';

test.describe.configure({ mode: 'serial' });

/*
 * The workspace's agent host in the app itself: its own process, the tool sandbox it forks, and
 * a network guard that lets nothing but this computer's model runtime through.
 */

/** A tool of the kind the mentor writes: it reads a table of the job's data inside the sandbox. */
const LABOR_COST: HarnessTool = {
  name: 'labor_cost',
  description: 'Labor cost in cents for hours of work by a technician tier.',
  parameters: {
    type: 'object',
    properties: { tier: { type: 'string' }, hours: { type: 'number' } },
    required: ['tier', 'hours'],
  },
  code: `function run(args, ctx) {
  var rates = ctx.readTable('rates.csv', { where: [{ column: 'tier', op: '=', value: args.tier }] });
  return { tier: args.tier, labor_cents: rates[0].hourly_rate_cents * args.hours };
}`,
};

/** The sample job's records, which a graduate's `data/` folder is bound to. */
const SAMPLE_DATA = fileURLToPath(
  new URL('../../../examples/home-services/job/data', import.meta.url),
);

let launched: LaunchedApp;
/** Where graduates are exported to and repackaged in. */
let folders: string;
/** A graduate trained on the sample job against a student that answers nothing, exported. */
let trained: string;
/** The app's Ollama, which llama-server's start asks to let go of the GPU. It never chats. */
let gpuOllama: FakeOllama;
/** Ollama's store on this test computer: a tiny base, and nothing else. */
let base: StoredBase;
/** What the stand-in llama-server recorded: its starts and chat requests. */
let llamaRecord: string;

test.beforeAll(async () => {
  folders = await mkdtemp(join(tmpdir(), 'architect-e2e-graduates-'));
  const models = join(folders, 'ollama-models');
  base = await storeBase(models);
  llamaRecord = join(folders, 'llama-server.jsonl');
  gpuOllama = await startFakeOllama([{ text: 'Ollama is never asked to chat here.' }]);
  launched = await launchApp({
    env: { OLLAMA_MODELS: models, ARCHITECT_LLAMA_SERVER_COMMAND: standInCommand(llamaRecord) },
    settings: {
      defaultStudent: {
        runtime: 'ollama',
        baseUrl: gpuOllama.baseUrl,
        model: DEFAULT_STUDENT.model,
        contextLength: DEFAULT_STUDENT.contextLength,
      },
    },
  });
  trained = await exportTrainedGraduate();
});

test.afterAll(async () => {
  await launched?.close();
  await gpuOllama?.close();
  // Quitting stopped every llama-server the app started: none outlives it.
  for (const entry of recorded(llamaRecord).filter((line) => line.kind === 'start')) {
    expect(isRunning(entry.pid ?? 0)).toBe(false);
  }
  await rm(folders, { recursive: true, force: true });
});

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function exportTrainedGraduate(): Promise<string> {
  const { page, app } = launched;
  const student = await startFakeStudent();
  try {
    const job: Job = await page.evaluate(() => window.architect.jobs.createSample());
    const local: Job['student']['local'] = {
      runtime: 'openai_compatible',
      baseUrl: student.baseUrl,
      model: 'fake-student',
      contextLength: 16_384,
    };
    await page.evaluate((next) => window.architect.jobs.save(next), {
      ...job,
      student: { ...job.student, local },
    });
    const run = await page.evaluate(
      (id) => window.architect.runs.start(id, { method: 'bare', seed: 7 }),
      job.id,
    );
    await expect
      .poll(() => page.evaluate((id) => window.architect.runs.get(id), run.id), { timeout: 90_000 })
      .toMatchObject({ run: { status: 'finished' } });
    const graduate = await page.evaluate((id) => window.architect.graduates.accept(id), run.id);

    // The system dialog is answered in main, so nothing appears on screen.
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, folders);
    await page.evaluate(() =>
      window.architect.files.pick({ title: 'Graduate folders', directory: true }),
    );
    const exported = await page.evaluate(
      ([id, target]) => window.architect.graduates.exportFolder(id, target),
      [graduate.id, folders] as const,
    );
    await page.evaluate((id) => window.architect.graduates.remove(id), graduate.id);
    return exported.folder;
  } finally {
    student.server.close();
  }
}

/**
 * Repackages the trained graduate as agent `id` with `tools` added to its harness, then imports
 * it with its `data/` bound to a copy of the sample records and its model at `baseUrl`.
 */
async function importGraduate(
  id: string,
  baseUrl: string,
  tools: HarnessTool[] = [],
): Promise<GraduateSummary> {
  const { manifest } = await readPackage(trained);
  const source = await readHarness(join(trained, 'harness'));
  const harness = { ...source, tools: [...source.tools, ...tools] };
  harness.meta = { ...harness.meta, hash: hashHarness(harness) };
  const entries: PackageEntry[] = [
    ...Object.entries(harnessToFiles(harness)).map(([path, content]) => ({
      path: `harness/${path}`,
      content,
    })),
    { path: 'harness/harness.yaml', content: metaToFile(harness.meta) },
    ...manifest.integrity.files
      .filter((file) => !file.path.startsWith('harness/'))
      .map((file) => ({ path: file.path, source: join(trained, ...file.path.split('/')) })),
  ];
  const { integrity: _integrity, ...draft } = manifest;
  const folder = join(folders, id);
  await writePackage(
    folder,
    {
      ...draft,
      identity: { ...draft.identity, agentId: id },
      harness: { ...draft.harness, hash: harness.meta.hash },
    },
    entries,
  );
  const data = join(folders, `${id}-records`);
  await cp(SAMPLE_DATA, data, { recursive: true });
  const imported = await launched.page.evaluate(
    ([path, records, url]) =>
      window.architect.graduates.importPackage(path, {
        bindings: { data: records },
        grants: { writes: 'ask', resources: { data: 'read_write', output: 'read_write' } },
        model: { runtime: 'ollama', baseUrl: url, model: 'muse-glimmer:30b' },
        loadModel: false,
      }),
    [folder, data, baseUrl] as const,
  );
  return imported.graduate;
}

/** Starts a chat with a graduate and sends its first message. */
async function startChat(graduateId: string, text: string): Promise<WorkspaceChat> {
  const { page } = launched;
  const chat = await page.evaluate((id) => window.architect.workspace.createChat(id), graduateId);
  await page.evaluate(([id, message]) => window.architect.workspace.send(id, message), [
    chat.id,
    text,
  ] as const);
  return chat;
}

/** Waits until the graduate has finished answering in the chat. */
async function settledReply(chatId: string): Promise<WorkspaceMessage> {
  const { page } = launched;
  let reply: WorkspaceMessage | undefined;
  await expect
    .poll(
      async () => {
        const messages = await page.evaluate(
          (id) => window.architect.workspace.messages(id),
          chatId,
        );
        reply = messages.find((message) => message.role === 'agent');
        return reply?.status ?? 'streaming';
      },
      { timeout: 60_000 },
    )
    .not.toBe('streaming');
  if (!reply) throw new Error('The graduate never started an answer.');
  return reply;
}

test('runs a tool the mentor wrote in the sandbox and answers from its result', async () => {
  const model = await startFakeOllama([
    { toolCall: { name: 'labor_cost', arguments: { tier: 'lead', hours: 2 } } },
    { text: 'Two hours of lead time comes to $276.00.' },
  ]);
  try {
    const graduate = await importGraduate('grd_labor', model.baseUrl, [LABOR_COST]);
    const chat = await startChat(graduate.id, 'What do two hours of lead time cost?');
    const reply = await settledReply(chat.id);

    expect(reply).toMatchObject({
      status: 'done',
      text: 'Two hours of lead time comes to $276.00.',
      steps: [{ kind: 'tool', name: 'labor_cost', status: 'done' }],
    });
    // The model was handed what the tool worked out from the job's rates: 2 hours at 13,800.
    expect(model.chats).toHaveLength(2);
    const toolMessage = model.chats[1]?.find((message) => message.role === 'tool');
    expect(toolMessage).toMatchObject({ tool_name: 'labor_cost' });
    expect(toolMessage?.content).toContain('27600');
  } finally {
    await model.close();
  }
});

test('never installs or binds a graduate to a model that is not on this computer', async () => {
  const model = await startFakeOllama([{ text: 'Hello.' }]);
  try {
    const graduate = await importGraduate('grd_local', model.baseUrl);
    const message = await launched.page.evaluate(
      (id) =>
        window.architect.graduates
          .bind(id, {
            model: { runtime: 'ollama', baseUrl: 'https://api.example.com/v1', model: 'm' },
          })
          .then(
            () => 'bound',
            (error: Error) => error.message,
          ),
      graduate.id,
    );
    expect(message).toContain("api.example.com isn't this computer");
    const installation = await launched.page.evaluate(
      (id) => window.architect.graduates.installation(id),
      graduate.id,
    );
    expect(installation.model.baseUrl).toBe(model.baseUrl);
  } finally {
    await model.close();
  }
});

test('stops a connection that leaves this computer, even when a local model sends it there', async () => {
  const model = await startFakeOllama([{ redirectToHost: 'localhost.' }]);
  try {
    // Nothing guards this process, so a name for this computer other than `localhost` gets
    // through here. If it didn't, a blocked connection below could not be told from a failed one.
    const control = await fetch(`http://localhost.:${model.port}/api/show`).catch(() => null);
    test.skip(control?.ok !== true, 'This computer does not resolve "localhost." to itself.');

    const graduate = await importGraduate('grd_redirect', model.baseUrl);
    const chat = await startChat(graduate.id, 'Hello');
    // The model's reply sends the host to "localhost.", which the guard refuses; the host asks
    // the model again, so a second request shows the first one was not followed.
    await expect.poll(() => model.hosts.length, { timeout: 30_000 }).toBeGreaterThan(1);
    await launched.page.evaluate((id) => window.architect.workspace.stop(id), chat.id);
    expect(new Set(model.hosts)).toEqual(new Set([`127.0.0.1:${model.port}`]));
  } finally {
    await model.close();
  }
});

test('imports a package with an adapter, opens it, and answers through llama.cpp with the adapter', async () => {
  const { page } = launched;
  const folder = join(folders, 'grd_adapter');
  await withAdapter(trained, folder, 'grd_adapter', base);
  const records = join(folders, 'grd_adapter-records');
  await cp(SAMPLE_DATA, records, { recursive: true });
  const imported = await page.evaluate(
    ([path, data, model]) =>
      window.architect.graduates.importPackage(path, {
        bindings: { data },
        grants: { writes: 'ask', resources: { data: 'read_write' } },
        model: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model },
      }),
    [folder, records, BASE_NAME] as const,
  );

  // Its checks found llama-server and the exact base, and its short request went through it.
  expect(imported.installation.status).toBe('ready');
  expect(imported.installation.checks.map((check) => [check.id, check.status]).slice(-3)).toEqual([
    ['adapter-runtime', 'passed'],
    ['model-available', 'passed'],
    ['model-responds', 'passed'],
  ]);
  expect(imported.graduate.manifest.student.adapter).toEqual({ scale: 1, standIn: true });

  const chat = await startChat(imported.graduate.id, 'Which jobs are open?');
  expect(await settledReply(chat.id)).toMatchObject({
    status: 'done',
    text: 'lora=[{"id":0,"scale":1}]',
    graduateVersion: 1,
  });

  // One start for the check, one for the workspace: each on the base from the store, with the
  // version's adapter, and every request applying it at its scale.
  const lines = recorded(llamaRecord);
  const starts = lines.filter((line) => line.kind === 'start');
  expect(starts).toHaveLength(2);
  for (const start of starts) {
    expect(flag(start.argv, '--alias')).toBe(BASE_NAME);
    expect(flag(start.argv, '--host')).toBe('127.0.0.1');
    expect(flag(start.argv, '--lora')).toMatch(/[\\/]v0001[\\/]adapter[\\/]adapter\.gguf$/);
  }
  const lora = lines.filter((line) => line.kind === 'chat').map((line) => line.body?.['lora']);
  expect(lora.length).toBeGreaterThanOrEqual(3);
  for (const scales of lora) expect(scales).toEqual([{ id: 0, scale: 1 }]);
  // Ollama was asked to let go of the GPU before each start, and never to answer.
  expect(gpuOllama.loadedAsked()).toBeGreaterThanOrEqual(2);
  expect(gpuOllama.chats).toEqual([]);

  // The workspace's status line says the agent runs with its adapter. The page read its agents
  // before this import, which went straight to the API, so it reads them again.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, `/agents/${imported.graduate.id}/chats/${chat.id}`);
  await expect(page.getByText('Stand-in adapter')).toBeVisible();
});
