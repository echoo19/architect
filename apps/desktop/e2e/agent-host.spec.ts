import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { hashHarness, readGraduate, writeGraduate } from '@architect/harness';
import type {
  GraduateSummary,
  HarnessTool,
  Job,
  WorkspaceChat,
  WorkspaceMessage,
} from '@architect/shared';
import { launchApp, type LaunchedApp } from './app';
import { startFakeOllama, startFakeStudent } from './models';

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

let launched: LaunchedApp;
/** Where graduates are exported to and rewritten in. */
let folders: string;
/** A graduate trained on the sample job against a student that answers nothing, exported. */
let trained: string;

test.beforeAll(async () => {
  launched = await launchApp();
  folders = await mkdtemp(join(tmpdir(), 'architect-e2e-graduates-'));
  trained = await exportTrainedGraduate();
});

test.afterAll(async () => {
  await launched?.close();
  await rm(folders, { recursive: true, force: true });
});

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
    const folder = join(folders, 'trained');
    await page.evaluate(([id, target]) => window.architect.graduates.exportFolder(id, target), [
      graduate.id,
      folder,
    ] as const);
    await page.evaluate((id) => window.architect.graduates.remove(id), graduate.id);
    return folder;
  } finally {
    student.server.close();
  }
}

/** Imports a copy of the trained graduate whose model runs at `baseUrl`, with `tools` added. */
async function importGraduate(
  id: string,
  baseUrl: string,
  tools: HarnessTool[] = [],
): Promise<GraduateSummary> {
  const source = await readGraduate(trained);
  const harness = { ...source.harness, tools: [...source.harness.tools, ...tools] };
  harness.meta = { ...harness.meta, hash: hashHarness(harness) };
  const folder = join(folders, id);
  await writeGraduate(folder, {
    ...source,
    harness,
    manifest: {
      ...source.manifest,
      id,
      harness: { version: harness.meta.version, hash: harness.meta.hash },
      student: { ...source.manifest.student, runtime: 'ollama', baseUrl },
    },
  });
  return launched.page.evaluate((path) => window.architect.graduates.importFolder(path), folder);
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

test('does not open a graduate whose model is not on this computer', async () => {
  const graduate = await importGraduate('grd_remote', 'https://api.example.com/v1');
  const message = await launched.page.evaluate(
    (id) =>
      window.architect.workspace.createChat(id).then(
        () => 'opened',
        (error: Error) => error.message,
      ),
    graduate.id,
  );
  expect(message).toContain("example.com, which isn't this computer");
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
