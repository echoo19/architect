import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Job, RunEvent } from '@architect/shared';
import { launchApp, type LaunchedApp } from './app';

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let jobId: string;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.close();
});

/** The engine's utility process, found by the name it is started with. */
function enginePid(): Promise<number | null> {
  return launched.app.evaluate(
    ({ app }) =>
      app
        .getAppMetrics()
        .find((metric) => metric.type === 'Utility' && metric.name === 'Architect engine')?.pid ??
      null,
  );
}

/**
 * A student on 127.0.0.1 that streams the same empty answer to every request, so a run can go
 * end to end without a model.
 */
async function startFakeStudent(): Promise<{ baseUrl: string; server: Server }> {
  const chunks = [
    { choices: [{ index: 0, delta: { content: 'ANSWER: {}' }, finish_reason: null }] },
    {
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    },
  ];
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, server };
}

test('starts the engine in its own utility process', async () => {
  await expect.poll(enginePid).toEqual(expect.any(Number));
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

    await expect
      .poll(() => page.evaluate((id) => window.architect.runs.get(id), run.id), {
        timeout: 90_000,
      })
      .toMatchObject({ run: { status: 'finished' } });

    const detail = await page.evaluate((id) => window.architect.runs.get(id), run.id);
    const invoice = detail.recentAttempts.find((attempt) => attempt.taskType === 'invoice');
    expect(invoice?.check).toMatchObject({ pass: false, reason: 'No new invoice row was added.' });

    const report = await page.evaluate((id) => window.architect.reports.get(id), run.id);
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

test('restarts the engine after it is killed', async () => {
  const page = launched.page;
  const before = await enginePid();
  expect(before).toEqual(expect.any(Number));
  process.kill(before as number);

  const failures = new Set<string>();
  await expect
    .poll(
      async () => {
        const result = await page.evaluate(() =>
          window.architect.jobs.list().then(
            (jobs) => jobs.map((job) => job.taskCount),
            (error: Error) => error.message,
          ),
        );
        if (typeof result === 'string') failures.add(result);
        return result;
      },
      { timeout: 30_000 },
    )
    .toEqual([180]);
  for (const failure of failures) expect(failure).toMatch(/^The engine stopped/);
  expect(await enginePid()).not.toBe(before);
  expect(await page.evaluate(() => window.architect.runs.list())).toHaveLength(1);
});
