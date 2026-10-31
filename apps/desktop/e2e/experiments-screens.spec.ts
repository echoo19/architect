import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  costUsd,
  mentorPreset,
  type ArmRow,
  type ComparisonReport,
  type ExperimentInput,
} from '@architect/shared';
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

/** The library's fields: the returns desk after another, as a Field page names it. */
const LIBRARY = [
  {
    id: 'home-services',
    name: 'Home services',
    createdAt: '2026-10-20T09:00:00.000Z',
    taskCount: 96,
  },
  {
    id: 'returns-desk',
    name: 'Returns desk',
    createdAt: '2026-10-22T09:00:00.000Z',
    taskCount: 180,
  },
  { id: 'empty-draft', name: 'Empty draft', createdAt: '2026-10-29T09:00:00.000Z', taskCount: 0 },
];

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

/**
 * What 1,000 of the recording's attempts cost at Spark's price: each reads 30,000 tokens and
 * writes 800, as the dry run's hosted Glimmer attempts do.
 */
const SPARK_PER_THOUSAND =
  1000 * costUsd(mentorPreset('meta-spark').pricing, { inputTokens: 30_000, outputTokens: 800 });

/**
 * The recorded comparison with the teacher alone beside its arms, as the engine reports one
 * (decision 095): Spark's blank-harness reference row again as the teacher's own run, named
 * after the model, hosted, at Spark's price for the recording's attempts. The engine's own
 * tests run the real arm.
 */
function withTeacher(report: ComparisonReport): ComparisonReport {
  const table = report.backends.find((backend) => backend.backend === 'reference');
  const reference = table?.rows.find((row) => row.arm === 'reference');
  if (table === undefined || reference === undefined) throw new Error('No Spark reference ran.');
  const teacher: ArmRow = {
    ...reference,
    arm: 'teacher',
    label: 'Spark alone',
    runId: 'run_teacher',
    model: 'Spark',
    runsOn: 'hosted',
    perThousandUsd: SPARK_PER_THOUSAND,
  };
  const own = { ...table, backend: 'teacher' as const, label: 'Spark alone, as the agent' };
  return {
    ...report,
    backends: [...report.backends, { ...own, rows: [teacher], paired: [], repeats: [] }],
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

/** The taught student against the teacher alone, on the same field. */
const TEACHER: ExperimentInput = {
  name: 'Taught against the teacher',
  jobId: 'returns-desk',
  hypothesis:
    'The taught student passes about as many final-test tasks as Spark alone, for far less.',
  primaryComparison: { a: 'targeted', b: 'teacher', group: 'all' },
  arms: [{ arm: 'bare' }, { arm: 'draft' }, { arm: 'targeted' }, { arm: 'teacher' }],
  seeds: { mentoring: 1, lockedTest: [101] },
  rounds: 2,
  caps: { studentUsd: 20, sparkUsd: 6, computeUsd: 0, wallMinutes: 600 },
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
  await updateSettings(page, { onboarded: true, edition: 'lab' });
  await stubEngine(launched.app, { ...EMPTY_ENGINE, 'jobs:list': LIBRARY, 'files:pick': [FOLDER] });
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

/** Whether `first` sits above `second` on the page. */
async function above(first: Locator, second: Locator): Promise<boolean> {
  const [top, bottom] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  return top !== null && bottom !== null && top.y < bottom.y;
}
const dialog = () => page.getByRole('dialog');

test('starts empty with one way in', async () => {
  await goTo(page, '/experiments');
  await expect(page.getByRole('heading', { name: 'No experiments yet' })).toBeVisible();
  await page.getByRole('button', { name: 'New experiment' }).click();
  await expect(page).toHaveURL(/#\/experiments\/new$/);
  await expect(heading('New experiment')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preregister' })).toBeDisabled();
  // A field from the library by default, the first with tasks; a folder for a job not in it.
  const field = page.getByRole('region', { name: 'Field' });
  await expect(field.getByRole('combobox', { name: 'Field' })).toHaveText('Home services');
  await expect(field.getByRole('button', { name: 'Choose folder' })).toBeVisible();
});

test('designs an experiment on a field of the library and shows its estimate before anything spends', async () => {
  // As "New experiment" on the returns desk's Field page opens it: that field chosen.
  await goTo(page, '/experiments/new/returns-desk');
  const field = page.getByRole('region', { name: 'Field' });
  await expect(field.getByRole('combobox', { name: 'Field' })).toHaveText('Returns desk');
  await field.getByRole('button', { name: 'Use field' }).click();
  await expect(page).toHaveURL(/#\/experiments\/cmp_1$/);
  await expect(heading('Returns desk')).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(field).toContainText('In your library');
  expect(await page.evaluate(() => window.architect.experiments.get('cmp_1'))).toMatchObject({
    experiment: { input: { jobId: 'returns-desk' } },
  });

  // The hypothesis comes first, and nothing is preregistered without it and its comparison.
  const hypothesis = page.getByRole('region', { name: 'Hypothesis' });
  expect(await above(hypothesis, field)).toBe(true);
  await expect(page.getByText('State the hypothesis.')).toBeVisible();
  await hypothesis
    .getByRole('textbox', { name: 'Hypothesis' })
    .fill(
      "Targeted mentoring passes more of the desks Glimmer never sees than Glimmer alone, since Spark's fixes come from the failures it found.",
    );
  await expect(page.getByText('Choose the primary comparison.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preregister' })).toBeDisabled();
  await hypothesis.getByRole('combobox', { name: 'Arm A' }).click();
  await page.getByRole('option', { name: 'Targeted mentoring' }).click();
  await expect(hypothesis.getByRole('combobox', { name: 'Arm B' })).toHaveText('Glimmer alone');
  await hypothesis.getByRole('combobox', { name: 'Part of the final test' }).click();
  await page.getByRole('option', { name: 'the organizations it has never seen' }).click();
  await expect(page.getByRole('button', { name: 'Preregister' })).toBeEnabled();

  const arms = page.getByRole('toolbar', { name: 'Arms' });
  await expect(arms.getByRole('button')).toHaveCount(10);
  for (const name of ['One-shot adapter', 'Failure-specific adapter']) {
    await expect(arms.getByRole('button', { name })).toBeDisabled();
  }
  // The weights arms can't run here; a cluster plan for the field is one step away.
  await expect(page.getByRole('button', { name: 'Plan cluster training' })).toBeVisible();
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
          primaryComparison: { a: 'targeted', b: 'bare', group: 'unseen' },
          seeds: { lockedTest: [101, 102] },
          arms: expect.arrayContaining([{ arm: 'targeted', sparkUsd: 5 }, { arm: 'repeat' }]),
        },
      },
    });
  await heading('Returns desk').scrollIntoViewIfNeeded();
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
  await expect(page.getByRole('region', { name: 'Preregistration' })).toContainText(
    'Returns desk, in your library',
  );
  await expect(page.getByRole('region', { name: 'Hypothesis' })).toContainText(
    'Targeted mentoring minus Glimmer alone, on the organizations it has never seen',
  );

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
  await expect(page.getByText(/Task by task, the difference is \+23 points/)).toBeVisible();
  // The hypothesis leads, with what was measured on the part of the test it named.
  const hypothesis = page.getByRole('region', { name: 'Hypothesis' });
  expect(await above(hypothesis, page.getByRole('figure').first())).toBe(true);
  await expect(hypothesis).toContainText(/Targeted mentoring \d+% · \d+ of \d+, Glimmer alone/);
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
  await expect(pairs).toContainText('Failure-specific adapter vs Glimmer alone');
});

test('sets the teacher alone beside the taught student, by accuracy and cost per 1,000 requests', async () => {
  await installExperimentsFake(
    launched.app,
    withTeacher(asField(await recordedComparisonReport())),
  );
  const id = await page.evaluate(async (input) => {
    const planned = await window.architect.experiments.plan(input);
    await window.architect.experiments.preregister(planned.experiment.id);
    await window.architect.experiments.start(planned.experiment.id, {});
    return planned.experiment.id;
  }, TEACHER);
  await finishExperiments(launched.app);
  await goTo(page, `/experiments/${id}`);
  await expect(page.getByText('Finished', { exact: true })).toBeVisible();
  const table = page.getByRole('table', { name: 'Accuracy against cost' });
  await table.scrollIntoViewIfNeeded();
  // Every row names the model that answered and where; the teacher and the student side by side.
  const teacher = table.getByRole('row').filter({ hasText: 'Spark alone' });
  await expect(teacher).toContainText('Hosted');
  await expect(teacher).toContainText(/\$\d/);
  await expect(
    table.getByRole('row').filter({ hasText: 'Targeted mentoring' }).first(),
  ).toContainText('Glimmer');
  await expect(table).toContainText('This computer');
  await expect(page.getByText('Table 2.', { exact: false })).toBeVisible();
  await page.getByText('Table 2.', { exact: false }).scrollIntoViewIfNeeded();
  await capture('experiment-teacher-arm-dark.png');
});
