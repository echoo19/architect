import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Job, RunEvent } from '@architect/shared';
import { launchApp, type LaunchedApp } from './app';
import { startFakeStudent } from './models';

test.describe.configure({ mode: 'serial' });

const ENGINE = 'Architect engine';
const WORKSPACE = 'Architect workspace';

let launched: LaunchedApp;
let jobId: string;
let runId: string;
let exports: string;

test.beforeAll(async () => {
  launched = await launchApp();
  exports = await mkdtemp(join(tmpdir(), 'architect-e2e-exports-'));
});

test.afterAll(async () => {
  await launched?.close();
  await rm(exports, { recursive: true, force: true });
});

/** A utility process of the app, found by the name it is started with. */
function processId(name: string): Promise<number | null> {
  return launched.app.evaluate(
    ({ app }, serviceName) =>
      app.getAppMetrics().find((metric) => metric.type === 'Utility' && metric.name === serviceName)
        ?.pid ?? null,
    name,
  );
}

/** Kills a utility process and waits until it is back, with a new process id. */
async function killAndAwaitRestart(name: string): Promise<void> {
  const before = await processId(name);
  expect(before).toEqual(expect.any(Number));
  process.kill(before as number);
  await expect
    .poll(
      async () => {
        const after = await processId(name);
        return after !== null && after !== before;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

test('starts the engine and the workspace in utility processes of their own', async () => {
  await expect.poll(() => processId(ENGINE)).toEqual(expect.any(Number));
  await expect.poll(() => processId(WORKSPACE)).toEqual(expect.any(Number));
  const page = launched.page;
  expect(await page.evaluate(() => window.architect.jobs.list())).toEqual([]);
  expect(await page.evaluate(() => window.architect.graduates.list())).toEqual([]);
});

test('creates the sample job with all of its tasks', async () => {
  const page = launched.page;
  const job = await page.evaluate(() => window.architect.jobs.createSample());
  jobId = job.id;
  expect(job.name).toBe('Service desk');

  const jobs = await page.evaluate(() => window.architect.jobs.list());
  expect(jobs).toEqual([expect.objectContaining({ id: jobId, taskCount: 180 })]);
  expect(await page.evaluate(() => window.architect.runs.list())).toEqual([]);

  const again = await page.evaluate(() => window.architect.jobs.createSample());
  expect(again.id).toBe(jobId);
});

test('keeps keys in the main process, encrypted', async () => {
  const page = launched.page;
  await page.evaluate(() => window.architect.secrets.set('meta', 'test-value'));
  const status = await page.evaluate(() => window.architect.secrets.status());
  expect(status).toEqual({
    meta: true,
    baseten: false,
    modal: false,
    together: false,
    openrouter: false,
    deepinfra: false,
  });

  const { dataPath } = await page.evaluate(() => window.architect.app.info());
  const saved = await readFile(join(dataPath, 'secrets.json'), 'utf8');
  expect(saved).not.toContain('test-value');
  expect(Object.keys(JSON.parse(saved) as object)).toEqual(['meta']);

  const refused = await page.evaluate(() =>
    window.architect.secrets.set('github', 'x').then(
      () => 'saved',
      (error: Error) => error.message,
    ),
  );
  expect(refused).toContain('Invalid arguments for secrets.set');
});

test('refuses paths the user did not pick', async () => {
  const page = launched.page;
  const { dataPath } = await page.evaluate(() => window.architect.app.info());
  const message = await page.evaluate(
    (file) =>
      window.architect.jobs.importFile(file).then(
        () => 'imported',
        (error: Error) => error.message,
      ),
    join(dataPath, 'secrets.json'),
  );
  expect(message).toContain('only opens files and folders you choose');
});

test('runs the sample job end to end and grades end states in the sandbox', async () => {
  const page = launched.page;
  const student = await startFakeStudent();
  try {
    const job = await page.evaluate((id) => window.architect.jobs.get(id), jobId);
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

    await page.evaluate(() => {
      const events: RunEvent['type'][] = [];
      Object.assign(window, { runEvents: events });
      window.architect.runs.onEvent((event) => events.push(event.type));
    });
    const run = await page.evaluate(
      (id) => window.architect.runs.start(id, { method: 'bare', seed: 7 }),
      jobId,
    );
    runId = run.id;

    await expect
      .poll(() => page.evaluate((id) => window.architect.runs.get(id), runId), {
        timeout: 90_000,
      })
      .toMatchObject({ run: { status: 'finished' } });

    const detail = await page.evaluate((id) => window.architect.runs.get(id), runId);
    const invoice = detail.recentAttempts.find((item) => item.taskType === 'invoice');
    expect(invoice?.check).toMatchObject({ pass: false, reason: 'No new invoice row was added.' });

    const report = await page.evaluate((id) => window.architect.reports.get(id), runId);
    expect(report.test.score).toEqual({ pass: 0, total: 60 });
    const events = await page.evaluate(
      () => (window as unknown as { runEvents: RunEvent['type'][] }).runEvents,
    );
    expect(events).toContain('attempt.finished');
    expect(events).toContain('graduate.ready');
  } finally {
    student.server.close();
  }
});

test('opens an accepted, exported and re-imported graduate in the workspace', async () => {
  const page = launched.page;
  const accepted = await page.evaluate((id) => window.architect.graduates.accept(id), runId);
  const graduateId = accepted.id;
  expect(await page.evaluate((id) => window.architect.workspace.listChats(id), graduateId)).toEqual(
    [],
  );
  const chat = await page.evaluate((id) => window.architect.workspace.createChat(id), graduateId);
  expect(chat.graduateId).toBe(graduateId);

  // The system dialog is answered in main, so nothing appears on screen.
  await launched.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, exports);
  expect(
    await page.evaluate(() =>
      window.architect.files.pick({ title: 'Export the agent', directory: true }),
    ),
  ).toEqual([exports]);
  const folder = join(exports, 'service-desk');
  await page.evaluate(([id, target]) => window.architect.graduates.exportFolder(id, target), [
    graduateId,
    folder,
  ] as const);
  await page.evaluate((id) => window.architect.graduates.remove(id), graduateId);
  expect(await page.evaluate(() => window.architect.graduates.list())).toEqual([]);

  const imported = await page.evaluate(
    (path) => window.architect.graduates.importFolder(path),
    folder,
  );
  expect(imported.id).toBe(graduateId);
  expect(await page.evaluate((id) => window.architect.workspace.listChats(id), graduateId)).toEqual(
    [],
  );
  const again = await page.evaluate((id) => window.architect.workspace.createChat(id), graduateId);
  expect(await page.evaluate((id) => window.architect.workspace.listChats(id), graduateId)).toEqual(
    [again],
  );
});

/** Lists the jobs' task counts, or says why it couldn't. */
function taskCounts(page: Page): Promise<number[] | string> {
  return page.evaluate(() =>
    window.architect.jobs.list().then(
      (jobs) => jobs.map((job) => job.taskCount),
      (error: Error) => error.message,
    ),
  );
}

/** Starts a chat with a graduate and returns whose it is, or says why it couldn't. */
function chatWith(page: Page, graduateId: string): Promise<string> {
  return page.evaluate(
    (id) =>
      window.architect.workspace.createChat(id).then(
        (chat) => chat.graduateId,
        (error: Error) => error.message,
      ),
    graduateId,
  );
}

test('restarts the engine after it is killed, and calls work again', async () => {
  const page = launched.page;
  const failures = new Set<string>();
  await killAndAwaitRestart(ENGINE);
  await expect
    .poll(
      async () => {
        const result = await taskCounts(page);
        if (typeof result === 'string') failures.add(result);
        return result;
      },
      { timeout: 30_000 },
    )
    .toEqual([180]);
  for (const failure of failures) expect(failure).toMatch(/^The engine stopped/);
  expect(await page.evaluate(() => window.architect.runs.list())).toHaveLength(1);
});

test('restarts the workspace after it is killed, and opens the graduates again', async () => {
  const page = launched.page;
  const [graduate] = await page.evaluate(() => window.architect.graduates.list());
  const graduateId = graduate?.id ?? '';
  expect(graduateId).not.toBe('');
  await killAndAwaitRestart(WORKSPACE);
  await expect.poll(() => chatWith(page, graduateId), { timeout: 30_000 }).toBe(graduateId);
});
