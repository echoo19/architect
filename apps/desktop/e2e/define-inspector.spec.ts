import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Job } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import { FLOW, FLOW_ENGINE, recordedCalls, stubRecorded } from './fixtures-flow';
import { job } from './story';

/*
 * The job's settings in the inspector at Define's right, against the stand-in engine: the footer
 * button opens it on the tab it kept, each tab holds the fields the engine checks, a change is
 * saved through the job's own save with Undo, and a value the engine would refuse is said where
 * it is typed and not saved.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const WIDTH = 1440;
const HEIGHT = 1100;

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;

/** The job with time to spare, so nothing on the page waits on the time limit. */
const roomy: Job = { ...job, budget: { ...job.budget, maxWallMinutes: 1_200 } };

test.beforeAll(async () => {
  launched = await launchApp();
  await mkdir(OUT_DIR, { recursive: true });
  const visible = await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      const [main] = BrowserWindow.getAllWindows();
      if (!main) throw new Error('No window');
      main.setContentSize(size.width, size.height);
      return main.isVisible();
    },
    { width: WIDTH, height: HEIGHT },
  );
  expect(visible).toBe(false);
  await launched.page.waitForFunction((h) => window.innerHeight === h, HEIGHT);
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(page: Page, name: string): Promise<void> {
  // A toast from the last change would cover the inspector's foot.
  for (const dismiss of await page.getByRole('button', { name: 'Dismiss' }).all()) {
    await dismiss.click();
  }
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, `${name}.png`),
    animations: 'disabled',
    timeout: 15_000,
  });
}

async function openDefine(page: Page): Promise<Locator> {
  const { app } = launched;
  await stubEngine(app, {
    ...FLOW_ENGINE,
    'jobs:get': roomy,
    'connections:huggingFace': { source: null },
  });
  await stubRecorded(app, 'jobs:save', roomy);
  await updateSettings(page, { onboarded: true, comparisonMode: false });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, `/jobs/${FLOW.jobId}/define`);
  await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
  return page.getByRole('complementary', { name: 'Advanced settings' });
}

/** The last job the screen sent to be saved. */
async function lastSaved(): Promise<Job | undefined> {
  const calls = await recordedCalls(launched.app, 'jobs:save');
  return calls.at(-1)?.[0] as Job | undefined;
}

test('opens from the footer, keeps its tab, and saves each change with Undo', async () => {
  const { page } = launched;
  const inspector = await openDefine(page);
  // Closed, the page is the job and where it trains, with no cap slider of its own.
  await expect(inspector).toHaveCount(0);
  await expect(page.getByRole('slider')).toHaveCount(0);
  const toggle = page.getByRole('button', { name: 'Advanced settings', exact: true });
  await toggle.click();
  await expect(inspector).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const tabs = inspector.getByRole('tab');
  await expect(tabs).toHaveText(['Spark', 'Glimmer', 'Teaching', 'Evaluation', 'Budget']);

  // Teacher: the models as tiles, how hard it thinks, and the cap.
  await inspector.getByRole('tab', { name: 'Spark' }).click();
  const teacher = inspector.getByRole('radiogroup', { name: 'Teacher' });
  await expect(teacher.getByRole('radio', { name: 'Spark 1.3', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(inspector.getByRole('slider', { name: 'Spark spending cap' })).toBeVisible();
  await capture(page, 'define-inspector-teacher-dark');

  await inspector.getByRole('radio', { name: 'High' }).click();
  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(page.getByText('How hard Spark thinks saved', { exact: true })).toBeVisible();
  expect((await lastSaved())?.mentor).toMatchObject({ reasoningEffort: 'high' });
  await undo.click();
  await expect
    .poll(async () => (await lastSaved())?.mentor)
    .toMatchObject({
      reasoningEffort: 'medium',
    });
  await expect(inspector.getByRole('radio', { name: 'Medium' })).toHaveAttribute(
    'aria-checked',
    'true',
  );

  // Student: the model here, where it practices, the online copy and the context.
  await inspector.getByRole('tab', { name: 'Glimmer' }).click();
  await expect(inspector.getByRole('radiogroup', { name: 'Runs on' })).toBeVisible();
  await expect(inspector.getByRole('textbox', { name: 'Context' })).toHaveValue('16384');
  await capture(page, 'define-inspector-student-dark');

  // Teaching: what Spark may change, the rounds and the rule a change must pass to stay.
  await inspector.getByRole('tab', { name: 'Teaching' }).click();
  const kinds = inspector.getByRole('region', { name: 'What Spark may change' });
  await expect(kinds.getByRole('switch', { name: 'Small tools' })).toBeChecked();
  await expect(inspector.getByRole('textbox', { name: 'No skill loses more than' })).toBeVisible();
  await expect(
    inspector.getByRole('textbox', { name: 'Measured again on new seeds' }),
  ).toBeVisible();
  await capture(page, 'define-inspector-teaching-dark');
  await kinds.getByRole('switch', { name: 'Small tools' }).click();
  await expect(page.getByText('Small tools saved', { exact: true })).toBeVisible();
  expect((await lastSaved())?.interventions).toEqual([
    'procedure',
    'retrieval',
    'weights',
    'clarification',
  ]);

  // A value the engine would refuse is said where it is typed, and nothing is saved.
  const saves = (await recordedCalls(launched.app, 'jobs:save')).length;
  const rounds = inspector.getByRole('textbox', { name: 'Rounds at most' });
  await rounds.fill('0');
  await expect(inspector.getByText('Use a whole number of rounds from 1 to 100.')).toBeVisible();
  await page.waitForTimeout(800);
  expect((await recordedCalls(launched.app, 'jobs:save')).length).toBe(saves);
  await rounds.fill('8');
  await expect(inspector.getByRole('alert')).toHaveCount(0);
  await expect.poll(async () => (await lastSaved())?.budget.maxRounds).toBe(8);
  // Back as it was, so every capture prices the same job.
  await rounds.fill('12');
  await expect.poll(async () => (await lastSaved())?.budget.maxRounds).toBe(12);

  // Evaluation: ready when, the final test and its seeds, the sets, the grading.
  await inspector.getByRole('tab', { name: 'Evaluation' }).click();
  await expect(
    inspector.getByRole('radiogroup', { name: 'Where the final test runs' }),
  ).toBeVisible();
  const seeds = inspector.getByRole('textbox', { name: 'Final test seeds' });
  await seeds.fill('11, 12');
  await expect.poll(async () => (await lastSaved())?.evaluation.lockedTestSeeds).toEqual([11, 12]);
  await seeds.fill('11, 11');
  await expect(inspector.getByText('Use each seed once.')).toBeVisible();
  await seeds.fill('11, 12, 13');
  await expect
    .poll(async () => (await lastSaved())?.evaluation.lockedTestSeeds)
    .toEqual([11, 12, 13]);
  await capture(page, 'define-inspector-evaluation-dark');

  // Budget: what is expected against each cap, then the caps. A time limit that stops training
  // before its last round and retraining with no compute are said plainly, beside Start training
  // too, with the fix; the online price is the one the card beside the page shows.
  await inspector.getByRole('tab', { name: 'Budget' }).click();
  await expect(inspector.getByRole('meter', { name: 'Spark' })).toBeVisible();
  await expect(inspector.getByRole('meter', { name: 'Training time' })).toBeVisible();
  const notes = inspector.getByRole('note');
  await expect(notes.first()).toContainText('time limit may stop training after');
  await expect(notes.nth(1)).toContainText("its compute cap is $0, so it won't run");
  await expect(page.getByText(/^The 20-hour limit fits .* of 12 rounds$/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^Allow \d+ hours$/ }).first()).toBeVisible();
  await capture(page, 'define-inspector-budget-dark');

  // Closed and opened again, it is on the tab it was left on.
  await toggle.click();
  await expect(inspector).toHaveCount(0);
  await toggle.click();
  await expect(inspector.getByRole('tab', { name: 'Budget' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // And on the page again, after the screen is left and opened anew.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  await expect(inspector.getByRole('tab', { name: 'Budget' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('shows the organizations it practices on, and the ones it has never seen only by count', async () => {
  const { app, page } = launched;
  const inspector = await openDefine(page);
  const field: Job = {
    ...roomy,
    organizations: [
      { id: 'northside', name: 'Northside Plumbing', synthetic: true, role: 'train' },
      { id: 'lakeview', name: 'Lakeview Electric', synthetic: true, role: 'train' },
      { id: 'harbor', name: 'Harbor Heating', synthetic: true, role: 'transfer' },
    ],
  };
  await stubEngine(app, { 'jobs:get': field });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
  await inspector.getByRole('tab', { name: 'Evaluation' }).click();
  const orgs = inspector.getByRole('region', { name: 'Organizations' });
  await expect(orgs).toContainText('Northside Plumbing');
  await expect(orgs).toContainText('1 it has never seen');
  await expect(orgs).toContainText('Never seen');
  // A sealed organization is never named before the final test, and nothing here unseals it.
  await expect(orgs).not.toContainText('Harbor');
  await expect(orgs.getByRole('switch')).toHaveCount(0);
  await expect(orgs.getByRole('button')).toHaveCount(0);
});

test('offers certified answers in the personal edition only to a job that already has them', async () => {
  const { app, page } = launched;
  const inspector = await openDefine(page);
  await updateSettings(page, { edition: 'personal' });
  const evaluation = async () => {
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Advanced settings', exact: true }).click();
    await inspector.getByRole('tab', { name: 'Evaluation' }).click();
    await expect(inspector.getByRole('region', { name: 'Ready when' })).toBeVisible();
  };
  await evaluation();
  await expect(inspector.getByRole('region', { name: 'Certified answers' })).toHaveCount(0);

  const certified: Job = {
    ...roomy,
    evaluation: { ...roomy.evaluation, certify: { k: 5, epsilon: 0.1, delta: 0.05 } },
  };
  await stubEngine(app, { 'jobs:get': certified });
  await evaluation();
  await expect(inspector.getByRole('region', { name: 'Certified answers' })).toBeVisible();
});
