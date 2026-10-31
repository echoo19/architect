import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { JobSchema, type Job, type StudyBrief, type StudyState } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { EMPTY_ENGINE, stubEngine } from './fixtures';
import { FLOW_ENGINE, recordedCalls, stubRecorded, taskPlan } from './fixtures-flow';

/*
 * Academy desk, the tutor, offered as a sample job on a fresh install, on a stand-in engine: choosing it
 * makes the job, Define asks the teacher to study the academies' material, and training waits
 * until the person confirms the brief.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));

// The shipped job as the library keeps it: the academy kept for the final test is not in it.
const shipped = JobSchema.parse(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('../../../examples/academy/job/job.json', import.meta.url)),
      'utf8',
    ),
  ),
);
const academyDesk: Job = {
  ...shipped,
  organizations: shipped.organizations?.filter((org) => org.role === 'train'),
};

const brief: StudyBrief = {
  organizations: [
    { id: 'copperfield', name: 'Copperfield Learning' },
    { id: 'thistlewood', name: 'Thistlewood Learning' },
  ],
  skills: [
    {
      taskType: 'assign',
      label: 'Assign',
      text: 'Set follow-up questions of the same topic the student has not tried, in the band.',
      needs: ['policy.md', 'questions.csv', 'attempts.csv'],
      steps: ['Read the practice count in policy.md.'],
      quotes: [],
      own: true,
    },
  ],
  connections: [],
  rules: [],
  differences: [],
  questions: [],
  outOfScope: [],
  dropped: 0,
};

const studied: StudyState = { state: 'needed', token: 'c0ffee00c0ffee00', brief };

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
  await mkdir(OUT_DIR, { recursive: true });
});

test.afterAll(async () => {
  await launched?.close();
});

test('starts Academy desk from a fresh install and reaches the brief to confirm', async () => {
  const { app, page } = launched;
  await stubEngine(app, {
    ...FLOW_ENGINE,
    ...EMPTY_ENGINE,
    'jobs:get': academyDesk,
    'jobs:save': academyDesk,
    'jobs:taskPlan': { ...taskPlan, study: { state: 'unstudied', token: '' } },
    'jobs:study': studied,
    'jobs:confirmStudy': {
      ...studied,
      state: 'confirmed',
      confirmedAt: '2026-10-30T15:00:00.000Z',
    },
  });
  await stubRecorded(app, 'jobs:createSample', academyDesk);
  await updateSettings(page, { onboarded: true, comparisonMode: false, edition: 'lab' });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, '/');

  await expect(page.getByRole('heading', { name: 'Nothing in the lab yet' })).toBeVisible();
  const offer = page.getByRole('button', { name: 'Try the Academy desk' });
  await expect(page.getByRole('button', { name: 'Try the sample job' })).toBeVisible();
  await offer.hover();
  await expect(page.getByRole('tooltip')).toContainText('for the staff of test-prep academies');
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, 'start-academy-desk-dark.png'),
    animations: 'disabled',
  });

  await offer.click();
  expect(await recordedCalls(app, 'jobs:createSample')).toEqual([['academy']]);
  await expect(page).toHaveURL(new RegExp(`#/jobs/${academyDesk.id}/define`));

  const section = page.getByRole('region', { name: 'What Spark understood' });
  await expect(section).toBeVisible();
  const start = page.getByRole('button', { name: 'Start training' });
  await expect(start).toBeDisabled();
  const waiting = page.getByText('Confirm the brief first', { exact: true });
  await expect(waiting).toBeVisible();
  await section.getByRole('button', { name: 'Study the material' }).click();
  await expect(section.getByRole('article', { name: 'The brief' })).toBeVisible();
  // Nothing of the academy kept for the final test is on the page.
  await expect(page.getByText(/Juniper/)).toHaveCount(0);

  await section.getByRole('button', { name: 'Confirm and continue' }).click();
  await expect(section.getByText('Confirmed on Oct 30')).toBeVisible();
  // The brief no longer holds training back; what's left is this stand-in computer's own setup.
  await expect(waiting).toHaveCount(0);
});
