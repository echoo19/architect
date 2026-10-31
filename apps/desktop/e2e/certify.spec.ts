import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Job } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { SAMPLE, SAMPLE_ENGINE, stubEngine } from './fixtures';
import {
  CERTIFIED_DESK_REPORT,
  CERTIFIED_REPORT,
  HANDOFF_CHAT,
  HANDOFF_MESSAGES,
  UNCERTIFIED_REPORT,
} from './fixtures-certify';
import { FIELD_AGENT, FIELD_CAPABILITIES, FIELD_JOB } from './fixtures-field';
import { FLOW, FLOW_ENGINE, recordedCalls, stubByKey, stubRecorded } from './fixtures-flow';
import { LAB, stubLab } from './fixtures-lab';
import { installModelsFake, MODELS } from './fixtures-models';
import { CHATS, engineSeed, installFakeEngine } from './fixtures-workspace';
import { job, storyReport } from './story';

/*
 * Certified answers (decision 077) against the stand-in engine: the certificate on the report,
 * in Models and in the Lab, its settings with their cost in the inspector, and an answer the
 * agent wasn't sure of handed to a person in chat, in the personal edition.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };

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

async function reloadAt(path: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

async function openReport(report = CERTIFIED_REPORT): Promise<void> {
  await stubEngine(launched.app, {
    ...SAMPLE_ENGINE,
    'graduates:list': [FIELD_AGENT],
    'jobs:get': FIELD_JOB,
    'reports:get': report,
    'mentoring:capabilities': FIELD_CAPABILITIES,
  });
  await reloadAt(`/runs/${SAMPLE.runId}/report`);
}

test('states the certificate, its curve and whether it held where it was not calibrated', async () => {
  await openReport();
  const section = page.getByRole('region', { name: 'Certified answers' });
  await expect(section).toContainText(
    'When Academy desk answers, it is wrong on at most 8% of requests like these, with 95% confidence. It handed 22% to a person.',
  );
  await expect(section).toContainText(
    'Measured on 77 calibration tasks it was never taught on, 5 attempts each: it answers when 4 of 5 agree; target 10% at 95% confidence.',
  );
  await expect(section).toContainText('An organization it never saw tests this assumption');
  await expect(
    section.getByRole('figure', {
      name: 'Wrong answers against the share answered, at each agreement threshold',
    }),
  ).toBeVisible();
  const checks = section.getByRole('list', { name: 'Where the bound was checked' });
  await expect(checks.getByRole('listitem')).toHaveCount(3);
  await expect(checks.getByRole('listitem').nth(0)).toContainText(
    'Final test, organizations it was taught on',
  );
  await expect(checks.getByRole('listitem').nth(0)).toContainText('Held');
  await expect(checks.getByRole('listitem').nth(1)).toContainText('Harbor Learning');
  await expect(checks.getByRole('listitem').nth(2)).toContainText('Real academy');
  await expect(checks.getByRole('listitem').nth(2)).toContainText('Not held');
  await expect(checks.getByRole('listitem').nth(2)).toContainText('Answered 21 of 30, 3 wrong');

  await section.evaluate((element) => {
    let box = element.parentElement;
    while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (!box) throw new Error('The report does not scroll.');
    box.scrollTop += element.getBoundingClientRect().top - box.getBoundingClientRect().top - 24;
  });
  await capture('report-certificate-dark.png');
});

test('says why no certificate was issued, and how many tasks would do', async () => {
  await openReport(UNCERTIFIED_REPORT);
  const section = page.getByRole('region', { name: 'Certified answers' });
  await expect(section).toContainText(
    "No certificate: 24 calibration tasks can't show a bound of 10%; about 38 would.",
  );
  await expect(section.getByRole('list', { name: 'Where the bound was checked' })).toHaveCount(0);
});

test('a report without a certificate has no certificate section', async () => {
  await openReport({ ...CERTIFIED_REPORT, certificate: undefined } as typeof CERTIFIED_REPORT);
  await expect(page.getByRole('table', { name: 'Final test by organization' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Certified answers' })).toHaveCount(0);
});

test('shows each version’s certificate in Models', async () => {
  await installModelsFake(launched.app);
  await launched.app.evaluate(
    ({ ipcMain }, { academyDeskId, report }) => {
      ipcMain.removeHandler('graduates:report');
      ipcMain.handle('graduates:report', (_event, id: string, number: number) =>
        id === academyDeskId && number === 2
          ? { ok: true, value: report }
          : { ok: false, error: { message: `No locked test measured version ${number}.` } },
      );
    },
    { academyDeskId: MODELS.academyDeskId, report: CERTIFIED_REPORT },
  );
  await reloadAt('/models');
  const table = page.getByRole('table', { name: 'Models' });
  await expect(table.getByRole('columnheader', { name: /Certified/ })).toBeVisible();
  const academyDesk = table.getByRole('row', { name: /^Academy desk\s+version 2/ });
  await expect(academyDesk).toContainText('≤ 8%');
});

test('shows a recent graduate’s certificate in the Lab', async () => {
  await stubLab(launched.app);
  await stubByKey(launched.app, 'reports:get', {
    [LAB.academyDeskRun]: { ...CERTIFIED_REPORT, runId: LAB.academyDeskRun },
    run_clinic: storyReport,
  });
  await reloadAt('/');
  const finished = page.getByRole('region', { name: 'Recently finished' });
  await expect(finished).toContainText('Certified');
  await expect(finished).toContainText('≤ 8%');
});

test('sets the certificate in the inspector, with what it costs before a run', async () => {
  const certified: Job = {
    ...job,
    budget: { ...job.budget, maxWallMinutes: 1_200 },
    evaluation: {
      ...job.evaluation,
      certify: { k: 5, epsilon: 0.1, delta: 0.05, calibration: 30 },
    },
  };
  await stubEngine(launched.app, {
    ...FLOW_ENGINE,
    'jobs:get': certified,
    'connections:huggingFace': { source: null },
  });
  await stubRecorded(launched.app, 'jobs:save', certified);
  await updateSettings(page, { comparisonMode: false });
  await reloadAt(`/jobs/${FLOW.jobId}/define`);
  await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  const inspector = page.getByRole('complementary', { name: 'Advanced settings' });
  await inspector.getByRole('tab', { name: 'Evaluation' }).click();
  const group = inspector.getByRole('region', { name: 'Certified answers' });
  await expect(group.getByRole('switch', { name: 'Answer only when sure' })).toBeChecked();
  await expect(group.getByRole('textbox', { name: 'Tries per request' })).toHaveValue('5');
  await expect(group.getByRole('textbox', { name: 'Wrong at most' })).toHaveValue('10');
  await expect(group.getByRole('textbox', { name: 'Confidence' })).toHaveValue('95');
  await expect(group).toContainText('30 tasks');
  await expect(group).toContainText(`The final test makes ${5 * (job.splits.test + 30)} tries`);
  await group.getByRole('textbox', { name: 'Tries per request' }).fill('3');
  await expect
    .poll(async () => {
      const calls = await recordedCalls(launched.app, 'jobs:save');
      return (calls.at(-1)?.[0] as Job | undefined)?.evaluation.certify?.k;
    })
    .toBe(3);
  await expect(group).toContainText(`The final test makes ${3 * (job.splits.test + 30)} tries`);
});

test('in the personal edition, hands a request it is unsure of to a person, attempts shown', async () => {
  await updateSettings(page, { edition: 'personal' });
  await installFakeEngine(
    launched.app,
    engineSeed({
      chats: [HANDOFF_CHAT, ...Object.values(CHATS)],
      messages: HANDOFF_MESSAGES,
      report: CERTIFIED_DESK_REPORT,
    }),
  );
  await reloadAt(`/agents/${HANDOFF_CHAT.graduateId}/chats/${HANDOFF_CHAT.id}`);
  await expect(page.getByText("I'm not sure about this one", { exact: false })).toBeVisible();
  await expect(page.getByText('Please hand it to a person.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /^Worked for/ }).click();
  const steps = page.getByRole('list', { name: 'Steps' });
  await expect(steps.getByRole('listitem')).toHaveCount(6);
  await expect(steps).toContainText('Attempt 1 of 5:');
  await expect(steps).toContainText('{"refund_cents":4500}');
  await expect(steps.getByText('differs')).toHaveCount(3);
  await capture('chat-handoff-dark.png');

  // A new chat says when it answers and when it hands a request on, in the same words.
  await reloadAt(`/agents/${HANDOFF_CHAT.graduateId}/chats/${CHATS.fresh.id}`);
  await expect(
    page.getByText('When Service desk answers, it is wrong on at most 8%', { exact: false }),
  ).toBeVisible();

  // The report says the certificate in the same words in this edition.
  await openReport();
  await expect(page.getByRole('region', { name: 'Certified answers' })).toContainText(
    'When Academy desk answers, it is wrong on at most 8%',
  );
});
