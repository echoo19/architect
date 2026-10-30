import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { ArmRow, ComparisonReport, ExperimentInput } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { EMPTY_ENGINE, stubEngine } from './fixtures';
import { finishExperiments, installExperimentsFake } from './fixtures-experiments';
import { recordedComparisonReport } from './recorded';

/*
 * The Experiments place against the stand-in engine (decision 074): the list, designing one with
 * its estimate before anything spends, preregistering and starting it, its live state with no
 * locked result, and its results once they are released, read like a short paper.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const FOLDER = 'C:/fields/returns-desk';

/** Organizations the stand-in's results split into: two taught, one generated and one real never seen. */
const ORGS = [
  { org: 'trailhead', orgName: 'Trailhead Outfitters', seen: true, synthetic: true, share: 6 },
  { org: 'summit', orgName: 'Summit Supply', seen: true, synthetic: true, share: 6 },
  { org: 'ridgeline', orgName: 'Ridgeline Gear', seen: false, synthetic: true, share: 4 },
  { org: 'real-shop', orgName: 'Corner Bike Shop', seen: false, synthetic: false, share: 4 },
] as const;

/** A row's skills spread over the organizations, each skill's passes kept as recorded. */
function withOrganizations(row: ArmRow): ArmRow {
  const perOrg = row.perType.flatMap((type) => {
    let left = type.pass;
    return ORGS.map(({ share, ...org }) => {
      const total = Math.round((type.total * share) / 20);
      const pass = Math.min(total, left);
      left -= pass;
      return { type: type.type, label: type.label, ...org, pass, total };
    });
  });
  return { ...row, perOrg };
}

/** The recorded comparison as a field's would read: the same counts, split by organization. */
function asField(report: ComparisonReport): ComparisonReport {
  return {
    ...report,
    backends: report.backends.map((backend) => ({
      ...backend,
      rows: backend.rows.map(withOrganizations),
    })),
  };
}

const OTHER: ExperimentInput = {
  name: 'Draft against targeted, two seeds',
  jobDir: 'C:/fields/returns-desk',
  arms: [{ arm: 'bare' }, { arm: 'draft' }, { arm: 'targeted' }, { arm: 'repeat' }],
  seeds: { mentoring: 2, lockedTest: [201, 202] },
  rounds: 3,
  caps: { studentUsd: 12, sparkUsd: 6, computeUsd: 0, wallMinutes: 600 },
};

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
  await updateSettings(page, { onboarded: true });
  await stubEngine(launched.app, { ...EMPTY_ENGINE, 'files:pick': [FOLDER] });
  await installExperimentsFake(launched.app, asField(await recordedComparisonReport()));
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

const heading = (name: string) => page.getByRole('heading', { name, level: 1 });
const dialog = () => page.getByRole('dialog');

test('starts empty with one way in', async () => {
  await goTo(page, '/experiments');
  await expect(page.getByRole('heading', { name: 'No experiments yet' })).toBeVisible();
  await page.getByRole('button', { name: 'New experiment' }).click();
  await expect(page).toHaveURL(/#\/experiments\/new$/);
  await expect(heading('New experiment')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preregister' })).toBeDisabled();
});

test('designs an experiment and shows its estimate before anything spends', async () => {
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await expect(page).toHaveURL(/#\/experiments\/cmp_1$/);
  await expect(heading('Returns desk')).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();

  const arms = page.getByRole('toolbar', { name: 'Arms' });
  await expect(arms.getByRole('button')).toHaveCount(9);
  for (const name of ['One-shot adapter', 'Failure-specific adapter']) {
    await expect(arms.getByRole('button', { name })).toBeDisabled();
  }
  await arms.getByRole('button', { name: 'Decoding repeat' }).click();
  await expect(arms.getByRole('button', { name: 'Decoding repeat' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  const estimate = page.getByRole('region', { name: 'Estimate' });
  await expect(estimate.getByText('Assumed prices')).toBeVisible();
  await expect(estimate.getByText('Decoding repeat')).toBeVisible();
  await expect(estimate.getByText('Calibration')).toBeVisible();
  await expect(estimate.getByRole('meter', { name: 'Spark' })).toBeVisible();

  const settings = page.getByRole('complementary', { name: 'Experiment settings' });
  await settings.getByRole('tab', { name: 'Evaluation' }).click();
  await settings.getByLabel('Seeds').fill('101, 102');
  await expect(
    page.getByRole('region', { name: 'Seeds and rounds' }).getByText('Repeat', { exact: true }),
  ).toBeVisible();
  await settings.getByRole('tab', { name: 'Spark' }).click();
  await settings.getByLabel('Targeted mentoring').fill('5');
  await expect
    .poll(() => page.evaluate(() => window.architect.experiments.get('cmp_1')))
    .toMatchObject({
      experiment: {
        input: {
          seeds: { lockedTest: [101, 102] },
          arms: expect.arrayContaining([{ arm: 'targeted', sparkUsd: 5 }, { arm: 'repeat' }]),
        },
      },
    });
  await capture('experiment-new-dark.png');
  await estimate.scrollIntoViewIfNeeded();
  await capture('experiment-new-estimate-dark.png');
});

test('preregisters, saying what freezes, then starts and runs without a locked result', async () => {
  await page.getByRole('button', { name: 'Preregister' }).click();
  await expect(dialog().getByText(/frozen\. Nothing in the plan can change/)).toBeVisible();
  await dialog().getByRole('button', { name: 'Preregister' }).click();
  await expect(page.getByText('Preregistered', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Preregistration' })).toContainText('3f9a1c07');

  await page.getByRole('button', { name: 'Start' }).click();
  await expect(dialog().getByText(/It may spend up to/)).toBeVisible();
  await dialog().getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText('Running', { exact: true }).first()).toBeVisible();
  const arms = page.getByRole('table', { name: 'Arms' });
  await expect(arms.getByRole('row')).toHaveCount(6);
  await expect(page.getByText('Results open here once every arm is done teaching.')).toBeVisible();

  const text = await page.locator('main').innerText();
  for (const sealed of ['Ridgeline', 'Corner Bike', 'final test', 'Final test', 'locked']) {
    expect(text).not.toContain(sealed);
  }
  await capture('experiment-running-dark.png');

  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Running', { exact: true }).first()).toBeVisible();
});

test('lists every experiment with its status, field, arms, spend and caps', async () => {
  await page.evaluate(async (input) => {
    const second = await window.architect.experiments.plan(input);
    await window.architect.experiments.preregister(second.experiment.id);
    await window.architect.experiments.plan({ ...input, name: 'Spark reference only' });
  }, OTHER);
  await finishExperiments(launched.app);
  await goTo(page, '/experiments');
  const table = page.getByRole('table', { name: 'Experiments' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table).toContainText('Finished');
  await expect(table).toContainText('Preregistered');
  await expect(table).toContainText('Draft');
  await expect(table).toContainText('Returns desk');
  await capture('experiments-list-dark.png');
  await table.getByRole('row').filter({ hasText: 'Finished' }).click();
  await expect(page).toHaveURL(/#\/experiments\/cmp_1$/);
});

test('reads the released results like a short paper', async () => {
  await expect(page.getByText('Finished', { exact: true })).toBeVisible();
  await expect(page.getByText(/Task by task, the difference is \+23\.3 points/)).toBeVisible();
  const plot = page.getByRole('figure', { name: /Final-test pass rate, Hosted/ });
  await expect(plot.getByRole('group', { name: 'Organizations it was taught on' })).toBeVisible();
  await expect(plot.getByRole('group', { name: 'Ridgeline Gear, never seen' })).toBeVisible();
  await expect(
    plot.getByRole('group', { name: 'Corner Bike Shop, real, never seen' }),
  ).toBeVisible();
  const pairs = page.getByRole('table', { name: 'Paired comparisons' });
  await expect(pairs).toContainText('Gain shown');
  await expect(pairs).toContainText('No gain shown');
  await expect(page.getByRole('table', { name: /Skills of/ })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Spend and latency' })).toBeVisible();
  await capture('experiment-results-dark.png');
  await page.getByText('Table 1.', { exact: false }).scrollIntoViewIfNeeded();
  await capture('experiment-results-tables-dark.png');

  await page.getByRole('radio', { name: 'Ollama' }).click();
  await expect(
    page.getByRole('figure', { name: /Final-test pass rate, This computer/ }),
  ).toBeVisible();
  await expect(pairs).toContainText('Failure-specific adapter vs Bare student');
});
