import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { JobSchema, type Job } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { EMPTY_ENGINE, stubEngine } from './fixtures';
import { FLOW_ENGINE, recordedCalls, stubRecorded, taskPlan } from './fixtures-flow';

/*
 * Sweep desk, offered as a science lab in the Lab edition, on a stand-in engine: the Lab home and
 * Describe both offer it, and choosing it makes the job and opens Define without the research
 * group it is never taught on.
 */

const shipped = JobSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../examples/sweep-desk/job/job.json', import.meta.url)),
      'utf8',
    ),
  ),
);
const sweepDesk: Job = {
  ...shipped,
  organizations: shipped.organizations?.filter((org) => org.role === 'train'),
};

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.close();
});

test('offers a science lab in the Lab edition and starts Sweep desk from it', async () => {
  const { app, page } = launched;
  await stubEngine(app, {
    ...FLOW_ENGINE,
    ...EMPTY_ENGINE,
    'jobs:get': sweepDesk,
    'jobs:save': sweepDesk,
    'jobs:taskPlan': { ...taskPlan, study: { state: 'unstudied', token: '' } },
  });
  await stubRecorded(app, 'jobs:createSample', sweepDesk);

  await updateSettings(page, { onboarded: true, comparisonMode: false, edition: 'personal' });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, '/new');
  await expect(page.getByRole('button', { name: 'Try the sample job' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try a science lab' })).toHaveCount(0);

  await updateSettings(page, { edition: 'lab' });
  await goTo(page, '/new');
  await expect(page.getByRole('button', { name: 'Try a science lab' })).toBeVisible();

  await goTo(page, '/');
  await expect(page.getByRole('heading', { name: 'Nothing in the lab yet' })).toBeVisible();
  const offer = page.getByRole('button', { name: 'Try a science lab' });
  await expect(page.getByRole('button', { name: 'Try the Academy desk' })).toBeVisible();
  await offer.hover();
  await expect(page.getByRole('tooltip')).toContainText("reads a research group's training runs");
  await settle(page);

  await offer.click();
  expect(await recordedCalls(app, 'jobs:createSample')).toEqual([['sweep-desk']]);
  await expect(page).toHaveURL(new RegExp(`#/jobs/${sweepDesk.id}/define`));
  await expect(page.getByRole('region', { name: 'What Spark understood' })).toBeVisible();
  // Nothing of the group kept for the final test is on the page.
  await expect(page.getByText(/Fennick/)).toHaveCount(0);
});
