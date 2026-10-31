import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { EvidenceResult, Job, RunDetail } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import { stubFields } from './fixtures-fields';
import { FLOW, FLOW_ENGINE, recordedCalls, stubByKey, stubRecorded } from './fixtures-flow';
import { ACADEMY_DESK_ID, DETAILS, LAB } from './fixtures-lab';
import { installModelsFake } from './fixtures-models';
import { job } from './story';

/*
 * A closed network and an evidence pack (decision 098), against the stand-in engine: the Lab
 * setting that names the hosts teaching may reach, the inspector saying a teacher is outside it
 * and where to fix that, a run's report saying in one line where it went, and a version's
 * evidence exported from Models into a folder the person picks.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const REVIEW_DIR = 'C:\\Users\\dana\\Reviews';

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
  await updateSettings(page, { onboarded: true, edition: 'lab' });
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

async function openAt(path: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

/**
 * Scrolls the pane holding `region` so all of it is in view and the pane's top edge falls on the
 * top of a row, so no row shows cut in half above it.
 */
async function showWhole(region: Locator): Promise<void> {
  await region.evaluate((element) => {
    let pane = element.parentElement;
    while (
      pane &&
      !(pane.scrollHeight > pane.clientHeight && getComputedStyle(pane).overflowY !== 'visible')
    ) {
      pane = pane.parentElement;
    }
    if (!pane) return;
    const bottom = element.getBoundingClientRect().bottom;
    const rows = [...(element.parentElement?.children ?? [])];
    const first =
      rows.find((row) => bottom - row.getBoundingClientRect().top <= pane.clientHeight) ?? element;
    pane.scrollTop += first.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  });
}

const closedNetwork = () =>
  page.evaluate(() => window.architect.settings.get().then((settings) => settings.closedNetwork));

test('names the hosts teaching may reach, in Settings', async () => {
  await openAt('/');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await settings.getByRole('tab', { name: 'Privacy' }).click();
  const toggle = settings.getByRole('switch', { name: 'Closed network' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(settings.getByRole('textbox', { name: 'Host' })).toHaveCount(0);
  await toggle.click();
  await expect.poll(closedNetwork).toEqual({ on: true, hosts: [] });

  const hosts = settings.getByRole('list', { name: 'Hosts inside the network' });
  await expect(hosts.getByRole('listitem')).toHaveText([/This computer\s*Always inside/]);
  const host = settings.getByRole('textbox', { name: 'Host' });
  await host.fill('https://spark.lab.internal/v1');
  await settings.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(settings.getByRole('alert')).toContainText('Enter only the host');
  await host.fill('spark.lab.internal');
  await host.press('Enter');
  await host.fill('VLLM-7.lab.internal:8000');
  await settings.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(hosts.getByRole('listitem')).toHaveCount(3);
  await expect
    .poll(closedNetwork)
    .toEqual({ on: true, hosts: ['spark.lab.internal', 'vllm-7.lab.internal:8000'] });
  await showWhole(settings.getByRole('region', { name: 'Closed network' }));
  await capture('closed-network-settings-dark.png');

  await settings.getByRole('button', { name: 'Remove vllm-7.lab.internal:8000' }).click();
  await expect.poll(closedNetwork).toEqual({ on: true, hosts: ['spark.lab.internal'] });
  await page.keyboard.press('Escape');
  await expect(settings).toHaveCount(0);
});

test('says in the inspector when a model is outside it, and where to add it', async () => {
  const roomy: Job = { ...job, budget: { ...job.budget, maxWallMinutes: 1_200 } };
  await stubEngine(launched.app, {
    ...FLOW_ENGINE,
    'jobs:get': roomy,
    'connections:huggingFace': { source: null },
  });
  await stubRecorded(launched.app, 'jobs:save', roomy);
  await openAt(`/jobs/${FLOW.jobId}/define`);
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Advanced settings' });
  await inspector.getByRole('tab', { name: 'Spark' }).click();
  await expect(inspector.getByRole('alert')).toContainText(
    'api.meta.ai is outside it, so teaching would be refused before anything is sent.',
  );
  await expect(inspector.getByRole('button', { name: 'Open Settings' })).toBeVisible();
  await capture('closed-network-teacher-dark.png');

  // The model on this computer is inside; its online copy is not.
  await inspector.getByRole('tab', { name: 'Glimmer' }).click();
  await expect(inspector.getByText('openrouter.ai is outside it')).toBeVisible();

  await inspector.getByRole('tab', { name: 'Spark' }).click();
  await inspector.getByRole('button', { name: 'Open Settings' }).click();
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('switch', { name: 'Closed network' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test("says on a run's report, in one line, where its teaching went", async () => {
  await stubFields(launched.app);
  const detail = DETAILS[LAB.academyDeskRun] as RunDetail;
  await stubByKey(launched.app, 'runs:get', {
    ...DETAILS,
    [LAB.academyDeskRun]: {
      ...detail,
      contacts: [
        { host: 'spark.lab.internal', requests: 412, inside: true },
        { host: '127.0.0.1:11434', requests: 3_870, inside: true },
      ],
    },
  });
  await openAt(`/runs/${LAB.academyDeskRun}/report`);
  const line = page.getByText('Contacted 2 hosts, both inside the network', { exact: true });
  await expect(line).toBeVisible();
  await capture('closed-network-report-dark.png');
  await line.hover();
  await expect(page.getByRole('tooltip')).toContainText('spark.lab.internal: 412 requests');
  await page.mouse.move(0, 0);
});

test("exports a version's evidence from Models into the folder picked", async () => {
  await installModelsFake(launched.app);
  const folder = `${REVIEW_DIR}\\academy-desk-v2-evidence`;
  const written: EvidenceResult = {
    folder,
    version: 2,
    files: ['README.md', 'evidence.json', 'package/graduate.json', 'MANIFEST.json'],
    bytes: 48_211,
    manifestSha256: '9'.repeat(64),
    weights: 'referenced',
  };
  await stubEngine(launched.app, { 'files:pick': [REVIEW_DIR] });
  await stubRecorded(launched.app, 'graduates:exportEvidence', written);
  await openAt('/models');
  await page
    .getByRole('table', { name: 'Models' })
    .getByRole('row', { name: /^Academy desk\s+version 2/ })
    .click();
  const panel = page.getByRole('complementary', { name: 'Model' });
  await panel.getByRole('button', { name: 'Export evidence' }).click();
  await expect(page.getByText('Evidence exported', { exact: true })).toBeVisible();
  await expect(page.getByText(folder, { exact: true })).toBeVisible();
  expect(await recordedCalls(launched.app, 'graduates:exportEvidence')).toEqual([
    [ACADEMY_DESK_ID, { directory: REVIEW_DIR, version: 2 }],
  ]);
  await capture('closed-network-export-dark.png');
});
