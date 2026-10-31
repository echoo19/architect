import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Job } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import { FLOW, FLOW_ENGINE, recordedCalls, stubRecorded } from './fixtures-flow';
import { stubFields } from './fixtures-fields';
import { LAB } from './fixtures-lab';
import { job } from './story';

/*
 * Bringing a trained model back (decision 086) against the stand-in engine: the Student tab's
 * server on this computer, which takes only an address on this computer, and Compute's Qualify a
 * trained model, which runs a frozen harness's test with it. No model, no GPU, no money.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 1000 };
const ENDPOINT = { baseUrl: 'http://127.0.0.1:8000/v1', model: 'tutor-ft-7b' };

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp();
  page = launched.page;
  const visible = await launched.app.evaluate(({ BrowserWindow }, size) => {
    const [main] = BrowserWindow.getAllWindows();
    if (!main) throw new Error('No window');
    main.setContentSize(size.width, size.height);
    return main.isVisible();
  }, SIZE);
  expect(visible).toBe(false);
  await mkdir(OUT_DIR, { recursive: true });
  await updateSettings(page, { onboarded: true, edition: 'lab', comparisonMode: false });
});

test.afterAll(async () => {
  await launched?.close();
});

test('the Student tab takes a server on this computer and refuses any other address', async () => {
  const roomy: Job = { ...job, budget: { ...job.budget, maxWallMinutes: 1_200 } };
  await stubEngine(launched.app, {
    ...FLOW_ENGINE,
    'jobs:get': roomy,
    'connections:huggingFace': { source: null },
  });
  await stubRecorded(launched.app, 'jobs:save', roomy);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, `/jobs/${FLOW.jobId}/define`);
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Advanced settings' });
  await inspector.getByRole('tab', { name: 'Glimmer' }).click();

  const address = inspector.getByRole('textbox', { name: 'Server address' });
  const model = inspector.getByRole('textbox', { name: 'Server model name' });
  await model.fill(ENDPOINT.model);
  await address.fill('https://api.together.xyz/v1');
  await expect(inspector.getByText(/api\.together\.xyz is not on this computer/)).toBeVisible();
  await address.fill('http://127.0.0.1/v1');
  await expect(inspector.getByText(/Add the port/)).toBeVisible();
  await page.waitForTimeout(800);
  expect(await recordedCalls(launched.app, 'jobs:save')).toEqual([]);

  await address.fill(ENDPOINT.baseUrl);
  await expect(inspector.getByRole('alert')).toHaveCount(0);
  await expect
    .poll(async () => {
      const saved = (await recordedCalls(launched.app, 'jobs:save')).at(-1)?.[0] as Job | undefined;
      return saved?.student.local;
    })
    .toMatchObject({ runtime: 'openai_compatible', ...ENDPOINT });
});

test('Compute qualifies a trained model on a field, labeled as trained elsewhere', async () => {
  await stubFields(launched.app);
  await launched.app.evaluate(({ ipcMain }, runId) => {
    const store = globalThis as typeof globalThis & { qualifyCalls?: unknown[] };
    store.qualifyCalls = [];
    let held: Record<string, unknown> | null = null;
    let reads = 0;
    const handle = (channel: string, reply: (...args: never[]) => unknown) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (_event, ...args: unknown[]) => ({
        ok: true,
        value: await reply(...(args as never[])),
      }));
    };
    handle('runs:qualify', (request: { runId: string; endpoint: Record<string, unknown> }) => {
      store.qualifyCalls?.push(request);
      held = {
        id: 'qlf_1',
        runId: request.runId,
        jobId: 'job_tutor',
        harnessVersion: 2,
        model: request.endpoint['model'],
        baseUrl: request.endpoint['baseUrl'],
        status: 'testing',
        startedAt: '2026-10-30T20:00:00.000Z',
      };
      reads = 0;
      return held;
    });
    handle('runs:qualifications', () => {
      if (held === null) return [];
      reads += 1;
      if (reads > 1) held = { ...held, status: 'finished' };
      return [held];
    });
    void runId;
  }, LAB.tutorRun);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, '/compute');

  const card = page.getByRole('region', { name: 'Qualify a trained model' });
  await expect(card).toContainText("this computer's GPU");
  await expect(card).toContainText('costs no money');
  await card.getByRole('combobox', { name: 'Field' }).click();
  await page.getByRole('option', { name: 'Tutor' }).click();
  await expect(card.getByRole('combobox', { name: 'Harness version' })).toContainText('Harness');

  const qualify = card.getByRole('button', { name: 'Qualify' });
  await expect(qualify).toBeDisabled();
  await card.getByLabel('Model name').fill(ENDPOINT.model);
  await card.getByLabel('Server address').fill('http://192.168.1.20:8000/v1');
  await expect(card.getByRole('alert')).toContainText('not on this computer');
  await expect(qualify).toBeDisabled();
  await card.getByLabel('Server address').fill(ENDPOINT.baseUrl);
  await expect(qualify).toBeEnabled();
  await qualify.click();

  const listed = card.getByRole('list', { name: 'Qualified models' });
  await expect(listed).toContainText(ENDPOINT.model);
  await expect(listed).toContainText('Trained elsewhere');
  const calls = await launched.app.evaluate(
    () => (globalThis as typeof globalThis & { qualifyCalls?: unknown[] }).qualifyCalls,
  );
  expect(calls).toMatchObject([{ runId: LAB.tutorRun, endpoint: ENDPOINT }]);

  await page.mouse.move(0, 0);
  await card.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, 'compute-bring-back-dark.png'),
    animations: 'disabled',
    timeout: 15_000,
  });
});
