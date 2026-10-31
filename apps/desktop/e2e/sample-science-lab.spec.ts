import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { JobSchema, type Job } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { EMPTY_ENGINE, stubEngine } from './fixtures';
import { FLOW_ENGINE, recordedCalls, stubRecorded, taskPlan } from './fixtures-flow';

/*
 * The science lab, offered in the Lab edition only, on a stand-in engine: one offer opens a
 * choice of its two specialists, Sweep desk and Assay desk, and choosing one makes its job and
 * opens Define without the organization it is never taught on. The personal edition doesn't
 * offer it.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));

/** A shipped job as the library keeps it: the organization kept for the final test is not in it. */
function shipped(folder: string): Job {
  const job = JobSchema.parse(
    JSON.parse(
      readFileSync(
        fileURLToPath(new URL(`../../../examples/${folder}/job/job.json`, import.meta.url)),
        'utf8',
      ),
    ),
  );
  return { ...job, organizations: job.organizations?.filter((org) => org.role === 'train') };
}

const SPECIALISTS = [
  { name: 'Sweep desk', sample: 'sweep-desk', job: shipped('sweep-desk'), unseen: /Fennick/ },
  { name: 'Assay desk', sample: 'assay-desk', job: shipped('assay-desk'), unseen: /Corvid/ },
] as const;

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

for (const [index, { name, sample, job, unseen }] of SPECIALISTS.entries()) {
  test(`the Lab's science lab offers ${name}, and choosing it opens its Define`, async () => {
    const { app, page } = launched;
    await stubEngine(app, {
      ...FLOW_ENGINE,
      ...EMPTY_ENGINE,
      'jobs:get': job,
      'jobs:save': job,
      'jobs:taskPlan': { ...taskPlan, study: { state: 'unstudied', token: '' } },
    });
    await stubRecorded(app, 'jobs:createSample', job);
    await updateSettings(page, { onboarded: true, comparisonMode: false, edition: 'lab' });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await goTo(page, '/new');
    await expect(offer()).toBeVisible();
    await goTo(page, '/');
    await expect(page.getByRole('heading', { name: 'Nothing in the lab yet' })).toBeVisible();

    await offer().click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveCount(SPECIALISTS.length);
    if (index === 0) {
      await settle(page);
      await page.screenshot({
        path: join(OUT_DIR, 'lab-science-dark.png'),
        animations: 'disabled',
      });
    }
    await menu.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click();
    expect(await recordedCalls(app, 'jobs:createSample')).toEqual([[sample]]);
    await expect(page).toHaveURL(new RegExp(`#/jobs/${job.id}/define`));
    // Nothing of the organization kept for the final test is on the page.
    await expect(page.getByText(unseen)).toHaveCount(0);
  });
}
