import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { JobSchema, type Job } from '@architect/shared';
import { goTo, launchApp, updateSettings, type LaunchedApp } from './app';
import { EMPTY_ENGINE, stubEngine } from './fixtures';
import { FLOW_ENGINE, recordedCalls, stubRecorded, taskPlan } from './fixtures-flow';

/*
 * The Assay desk, a science lab sample, offered in the Lab edition only, on a stand-in engine:
 * choosing it makes the job and opens Define. The personal edition doesn't offer it.
 */

// The shipped job as the library keeps it: the lab kept for the final test is not in it.
const shipped = JobSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../examples/assay-desk/job/job.json', import.meta.url)),
      'utf8',
    ),
  ),
);
const assay: Job = {
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

const offer = () => launched.page.getByRole('button', { name: 'Try a science lab' });

test('the personal edition offers no science lab', async () => {
  const { app, page } = launched;
  await stubEngine(app, { ...FLOW_ENGINE, ...EMPTY_ENGINE });
  await updateSettings(page, { onboarded: true, comparisonMode: false, edition: 'personal' });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, '/new');
  await expect(page.getByRole('button', { name: 'Try the sample job' })).toBeVisible();
  await expect(offer()).toHaveCount(0);
});

test('the Lab offers the Assay desk, and choosing it opens its Define', async () => {
  const { app, page } = launched;
  await stubEngine(app, {
    ...FLOW_ENGINE,
    ...EMPTY_ENGINE,
    'jobs:get': assay,
    'jobs:save': assay,
    'jobs:taskPlan': taskPlan,
  });
  await stubRecorded(app, 'jobs:createSample', assay);
  await updateSettings(page, { onboarded: true, comparisonMode: false, edition: 'lab' });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, '/new');
  await expect(offer()).toBeVisible();
  await goTo(page, '/');
  await expect(page.getByRole('heading', { name: 'Nothing in the lab yet' })).toBeVisible();
  await offer().hover();
  await expect(page.getByRole('tooltip')).toContainText('plate-reader exports');

  await offer().click();
  expect(await recordedCalls(app, 'jobs:createSample')).toEqual([['assay-desk']]);
  await expect(page).toHaveURL(new RegExp(`#/jobs/${assay.id}/define`));
  // Nothing of the lab kept for the final test is on the page.
  await expect(page.getByText(/Corvid/)).toHaveCount(0);
});
