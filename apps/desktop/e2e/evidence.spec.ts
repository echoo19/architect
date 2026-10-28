import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Experiment, Measurement, TypeScore } from '@architect/shared';
import { goTo, launchApp, type LaunchedApp } from './app';
import {
  recordedComparison,
  recordedComparisonReport,
  recordedData,
  recordedSummary,
  roundWith,
  type RecordedSummary,
} from './recorded';

/*
 * The evidence screens on a run recorded with the engine's fakes on the returns desk (the
 * global setup records it): the app's own engine reads its records, so every number on screen
 * is checked against what the engine stored, never against numbers written here.
 */

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let summary: RecordedSummary;

test.beforeAll(async () => {
  summary = await recordedSummary();
  launched = await launchApp({
    data: recordedData(),
    settings: { onboarded: true, theme: 'dark' },
  });
  const visible = await launched.app.evaluate(({ BrowserWindow }) => {
    const [main] = BrowserWindow.getAllWindows();
    if (!main) throw new Error('No window');
    main.setContentSize(1440, 900);
    return main.isVisible();
  });
  expect(visible).toBe(false);
});

test.afterAll(async () => {
  await launched?.close();
});

function experiments(page: Page): Promise<Experiment[]> {
  return page.evaluate((id) => window.architect.mentoring.experiments(id), summary.runId);
}

/** The round row in the Rounds panel, by its number. */
function roundRow(page: Page, round: number): Locator {
  return page
    .getByRole('region', { name: 'Rounds' })
    .getByRole('button')
    .filter({ hasText: new RegExp(`^${String(round).padStart(2, '0')}`) });
}

async function openRound(page: Page, round: number): Promise<Locator> {
  await roundRow(page, round).click();
  const drawer = page.getByRole('dialog', { name: new RegExp(`^Round ${round}`) });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function closeDrawer(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('shows each round as its experiment ended, rejected and stopped ones included', async () => {
  const { page } = launched;
  await goTo(page, `/runs/${summary.runId}/train`);
  const stored = await experiments(page);
  expect(stored.map((item) => item.disposition)).toEqual(
    summary.rounds.map((round) => round.disposition),
  );
  // Five different outcomes in five different words: none runs two together.
  const words = {
    kept: 'Kept',
    reverted: 'No gain',
    rejected: 'Made it worse',
    invalid: "Couldn't be tried",
    stopped: 'Stopped',
  };
  const headlines = {
    kept: 'Kept',
    reverted: 'Undone, no gain',
    rejected: 'Undone, made things worse',
    invalid: "Couldn't be tried",
    stopped: 'Stopped',
  };
  for (const experiment of stored) {
    await expect(roundRow(page, experiment.round)).toContainText(words[experiment.disposition]);
  }
  // The budget stop shows where it happened: after the last round, as training's end.
  await expect(page.getByRole('region', { name: 'Rounds' })).toContainText(
    'The time limit ran out',
  );

  // A rejected round says what it harmed, with the loss the record holds, in its row and drawer.
  const rejected = stored.find((item) => item.disposition === 'rejected');
  if (!rejected) throw new Error('No rejected experiment was recorded.');
  const [worst] = rejected.regressions;
  if (!worst) throw new Error('The rejected experiment recorded no loss.');
  const loss = `went from ${worst.before} to ${worst.after}`;
  await expect(roundRow(page, rejected.round)).toContainText(`${worst.before} → ${worst.after}`);
  const drawer = await openRound(page, rejected.round);
  await expect(drawer.getByText(headlines.rejected, { exact: true })).toBeVisible();
  await expect(drawer).toContainText(loss);
  await expect(drawer.getByRole('table', { name: 'Check tasks by type' })).toContainText(
    `Lost ${worst.before - worst.after} passes`,
  );
  await closeDrawer(page);

  // A stopped round gives the engine's own reason, and nothing measured or kept.
  const stopped = stored.find((item) => item.disposition === 'stopped');
  if (!stopped) throw new Error('No stopped experiment was recorded.');
  await expect(roundRow(page, stopped.round)).toContainText(words.stopped);
  const stoppedDrawer = await openRound(page, stopped.round);
  await expect(stoppedDrawer.getByText(headlines.stopped, { exact: true })).toBeVisible();
  await expect(stoppedDrawer).toContainText(stopped.reason);
  await expect(stoppedDrawer).toContainText("It isn't in the agent.");
  await expect(stoppedDrawer).toContainText('Not measured');
  // The plateau shows as it happened: the repair its category's plateau set aside.
  await expect(stoppedDrawer.getByRole('region', { name: 'Worked examples' })).toContainText(
    'so its teaching stopped',
  );
  await closeDrawer(page);

  // An invalid round says why the runner refused it before any measurement.
  const invalid = stored.find((item) => item.disposition === 'invalid');
  if (!invalid) throw new Error('No invalid experiment was recorded.');
  const invalidDrawer = await openRound(page, invalid.round);
  await expect(invalidDrawer.getByText(headlines.invalid, { exact: true })).toBeVisible();
  // Retraining the model is what a run can't do here, said in plain words; the engine's own
  // sentence stays in the record.
  await expect(invalidDrawer).toContainText("which this computer can't do. Nothing changed.");
  await closeDrawer(page);
});

test('reconciles the training screen with the stored records (A05)', async () => {
  const { page } = launched;
  await goTo(page, `/runs/${summary.runId}/train`);
  const stored = await experiments(page);
  const lessons = await page.evaluate(
    (id) => window.architect.mentoring.lessons(id),
    summary.runId,
  );
  const changes = stored.filter((item) => item.kind !== 'draft');
  const resources = page.getByRole('region', { name: 'Resources' });
  await expect(resources).toContainText(
    new RegExp(
      `Changes kept\\s*${changes.filter((item) => item.disposition === 'kept').length}\\s*/\\s*${changes.length}`,
    ),
  );
  // Every example is listed, and the count over them adds up to the ticks in the list.
  const verified = lessons.filter((lesson) => lesson.status === 'verified').length;
  const examples = page.getByRole('region', { name: 'Worked examples' });
  await expect(examples).toContainText(`${verified} of ${lessons.length} passed the checker`);
  const rows = examples.getByRole('listitem');
  await expect(rows).toHaveCount(lessons.length);
  await expect(rows.getByRole('img', { name: 'Passed the checker' })).toHaveCount(verified);
  await expect(rows.getByRole('img', { name: 'Failed the checker' })).toHaveCount(
    lessons.length - verified,
  );
});

test("opens a lesson's attempt at the step its finding points to", async () => {
  const { page } = launched;
  await goTo(page, `/runs/${summary.runId}/train`);
  const kept = roundWith(summary, 'kept');
  const drawer = await openRound(page, kept);

  // The round's examples, with the repair first: replayed from the step before the failure.
  const examples = drawer.getByRole('region', { name: 'Worked examples' });
  const repair = examples.getByRole('button').filter({ hasText: 'Replayed from step' }).first();
  await repair.click();
  const lesson = page.getByRole('dialog');
  await expect(lesson).toContainText("Spark's example passed the checker");
  await expect(lesson.getByRole('button', { name: 'Back' })).toBeVisible();
  // The correction plays back from the checkpoint: Glimmer's steps replayed, then Spark's own.
  const replayed = summary.repair.failureTurn - 1;
  await expect(lesson).toContainText(
    replayed > 1 ? `Glimmer's steps 1 to ${replayed}, replayed` : "Glimmer's step 1, replayed",
  );
  await expect(lesson).toContainText(`Spark takes over at step ${summary.repair.failureTurn}`);
  const correction = lesson.getByRole('list', { name: "Spark's correction" });
  await expect(correction.locator('[aria-current="step"]')).toContainText(
    String(summary.repair.failureTurn),
  );

  // The finding opens Glimmer's attempt at the step it suspects, with Spark's note on it.
  await lesson
    .getByRole('button', { name: `Open Glimmer's attempt at step ${summary.repair.failureTurn}` })
    .click();
  const attempt = page.getByRole('dialog');
  await expect(attempt).toContainText('Failed');
  const steps = attempt.getByRole('list', { name: "Glimmer's steps" });
  const current = steps.locator('[aria-current="step"]');
  await expect(current).toContainText(String(summary.repair.failureTurn));
  await expect(attempt).toContainText('Spark suspects this step');
  const nav = attempt.getByText(new RegExp(`^Step ${summary.repair.failureTurn} of \\d+$`));
  await expect(nav).toBeVisible();

  // The keyboard moves through the steps, as the mouse does.
  await current.focus();
  await page.keyboard.press('ArrowUp');
  await expect(steps.locator('[aria-current="step"]')).toContainText(
    String(summary.repair.failureTurn - 1),
  );
  await page.keyboard.press('Home');
  await expect(attempt.getByText(/^Step 1 of \d+$/)).toBeVisible();
  await attempt.getByRole('button', { name: 'Step after' }).click();
  await expect(attempt.getByText(/^Step 2 of \d+$/)).toBeVisible();
  // Each call reads the way the workspace words it, with the raw call folded under it.
  await expect(attempt.getByRole('button', { name: 'Raw call' }).first()).toHaveAttribute(
    'aria-expanded',
    'false',
  );

  // Back to the lesson, then the round.
  await attempt.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('dialog')).toContainText("Spark's example passed the checker");
  await page.getByRole('dialog').getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('dialog', { name: new RegExp(`^Round ${kept}`) })).toBeVisible();
  await closeDrawer(page);
});

/** The configuration's per-type scores the capability breakdown reads, as the engine picks it. */
function checkScores(stored: Experiment[]): TypeScore[] {
  for (const experiment of [...stored].reverse()) {
    const labels =
      experiment.disposition === 'kept' ? ['candidate', 'H1/A1'] : ['incumbent', 'H1/A0'];
    const measured = experiment.measurements.find((item: Measurement) =>
      labels.includes(item.label),
    );
    if (measured) return measured.perType;
  }
  throw new Error('No experiment measured the check tasks.');
}

test('reconciles the capability breakdown with the stored experiments and the final test (A05)', async () => {
  const { page } = launched;
  await goTo(page, `/runs/${summary.runId}/report`);
  const stored = await experiments(page);
  const card = await page.evaluate((id) => window.architect.reports.get(id), summary.runId);
  const job = await page.evaluate((id) => window.architect.jobs.get(id), summary.jobId);
  const table = page.getByRole('table', { name: 'Results by task type' });
  await expect(table).toBeVisible();
  const check = checkScores(stored);
  for (const type of job.taskTypes) {
    const row = table.getByRole('row', { name: new RegExp(type.label) });
    const meters = row.getByRole('meter');
    const dev = check.find((item) => item.type === type.id);
    const final = card.test.perType.find((item) => item.type === type.id);
    await expect(meters.nth(1)).toHaveAttribute(
      'aria-valuetext',
      new RegExp(`^${dev?.pass} of ${dev?.total} passed`),
    );
    await expect(meters.nth(2)).toHaveAttribute(
      'aria-valuetext',
      `${final?.pass} of ${final?.total} passed`,
    );
  }
});

test('keeps practice, check tasks, the final test and install checks apart', async () => {
  const { page } = launched;
  await goTo(page, `/runs/${summary.runId}/report`);
  const table = page.getByRole('table', { name: 'Results by task type' });
  const headers = table.getByRole('columnheader');
  await expect(headers.nth(1)).toContainText('Practice tasks');
  await expect(headers.nth(2)).toContainText('Check tasks');
  await expect(headers.nth(3)).toContainText('Final test');
  // Each kind has its own bar.
  await expect(table.locator('[data-kind="practice"]')).toHaveCount(3);
  await expect(table.locator('[data-kind="check"]')).toHaveCount(3);
  await expect(table.locator('[data-kind="final"]')).toHaveCount(3);
  // Spark was measured on the check tasks only: its tick is on those bars and nowhere else.
  const references = await page.evaluate(
    (id) => window.architect.mentoring.references(id),
    summary.runId,
  );
  expect(references.map((record) => record.split)).toEqual(['dev']);
  await expect(table.locator('[data-kind="check"] [data-marker]')).toHaveCount(3);
  await expect(table.locator('[data-kind="final"] [data-marker]')).toHaveCount(0);
  await expect(table.locator('[data-kind="practice"] [data-marker]')).toHaveCount(0);
  // Spark's own score stands beside the bar it marks, where it was measured on the same tasks.
  await expect(table.getByText(/Spark \d+ of \d+/)).toHaveCount(3);
  // This computer's checks stand apart, named as this computer's.
  await expect(page.getByText('Works on this computer')).toBeVisible();
  // A comparison with no record says so, and why, from what the records lack, under Details.
  const comparisons = page.getByRole('table', { name: 'Comparisons' });
  await expect(comparisons.getByRole('row')).toHaveCount(4);
  const section = page.locator('section[aria-labelledby="comparisons"]');
  await section.getByRole('button', { name: 'Details' }).click();
  for (const arm of ['Glimmer with trained weights', 'Glimmer with both']) {
    await expect(section).toContainText(
      `${arm} wasn't measured: no round measured trained weights`,
    );
  }
  await expect(
    comparisons.getByRole('row', { name: /Spark doing the tasks itself/ }),
  ).toContainText('Not run');
  // The run started from a setup, so the student before any change is named for it.
  await expect(
    comparisons.getByRole('row', { name: /Glimmer with the starting setup/ }),
  ).toBeVisible();
});

test('shows the memory a meter read over the final test, and nothing where it read none', async () => {
  const { page } = launched;
  await goTo(page, `/runs/${summary.runId}/report`);
  const [reading, ...others] = await page.evaluate(
    (id) => window.architect.runs.runtimeMeasurements(id),
    summary.runId,
  );
  expect(others).toEqual([]);
  expect(reading?.peakProcessBytes).not.toBeNull();
  // The figures are for whoever asks: behind the stats' Details.
  await page.getByRole('button', { name: 'Details' }).first().click();
  await expect(
    page.getByText(/^Up to [\d.]+ GB of RAM and [\d.]+ GB of GPU memory$/),
  ).toBeVisible();
  await expect(page.getByText(/^[\d.]+ s, the model loading first$/)).toBeVisible();
  // Only the agent's own final test was metered: its line says so, and no other line does.
  const section = page.locator('section[aria-labelledby="comparisons"]');
  // The comparisons' own Details stay open from the last test, which opened them.
  await expect(section.getByText(/Glimmer with Spark's setup used at most/)).toContainText(
    'GB of GPU memory in its final test',
  );
  await expect(section.getByText(/starting setup used at most/)).toHaveCount(0);
});

test("reads a comparison's own report: each arm as it ended, and one not run with its reason", async () => {
  const report = await recordedComparisonReport();
  const targeted = report.arms.find((arm) => arm.arm === 'targeted');
  const fixed = report.arms.find((arm) => arm.arm === 'fixed');
  if (!targeted?.runId || fixed?.status !== 'not_run') {
    throw new Error('The recorded comparison has no targeted run, or its fixed arm ran.');
  }
  const opened = await launchApp({
    comparison: recordedComparison(),
    settings: { onboarded: true, theme: 'dark' },
  });
  try {
    await goTo(opened.page, `/runs/${targeted.runId}/report`);
    const table = opened.page.getByRole('table', { name: 'Comparisons' });
    await expect(table).toBeVisible();
    await expect(
      opened.page.getByText('Dry run on fakes, no model called', { exact: true }),
    ).toBeVisible();
    // The first look is three rows: the untouched student, this agent and Spark doing the tasks
    // itself. This run's is marked as this agent.
    await expect(table.getByRole('row')).toHaveCount(4);
    const own = table.getByRole('row', { name: /Glimmer taught by Spark/ });
    await expect(own).toContainText('this agent');
    await expect(table.getByRole('row', { name: /Glimmer, untouched/ })).toBeVisible();
    await expect(table.getByRole('row', { name: /Spark doing the tasks itself/ })).toBeVisible();
    // Its final test as the report holds it: one figure on the same kind of copy as the stats
    // above, and what it cost in all, each bill counted once.
    const seed = report.plan.testSeeds[0];
    const rowOf = (backend: string, arm: string) =>
      report.backends
        .find((item) => item.backend === backend)
        ?.rows.find((row) => row.arm === arm && row.seed === seed);
    const hosted = rowOf('hosted', 'targeted');
    const local = rowOf('local-ollama', 'targeted');
    await expect(own).toContainText(`${hosted?.scenarios.pass} of ${hosted?.scenarios.total}`);
    const spent = targeted.spent;
    const total = spent.sparkUsd + (spent.studentUsd ?? 0) + spent.computeUsd;
    await expect(own).toContainText(total.toFixed(2));
    // Nothing is cut off at the right: the table ends inside its page.
    const box = await table.boundingBox();
    const width = await opened.page.evaluate(() => window.innerWidth);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);

    // The other arms wait under their own fold, each as it ended.
    const more = opened.page.getByRole('button', {
      name: `${report.arms.length - 3} more comparisons`,
    });
    await more.click();
    const rest = opened.page.getByRole('table', { name: 'More comparisons' });
    await expect(rest.getByRole('row')).toHaveCount(report.arms.length - 3 + 1);
    // The arm that wasn't run says so, with the runner's reason, and nothing else.
    await expect(rest.getByRole('row', { name: /written rules only/ })).toContainText(
      `Not run: ${fixed.reason}`,
    );
    // The arm the runner stopped says so, with its reason.
    const stopped = report.arms.find((arm) => arm.arm === 'weights-targeted');
    expect(stopped?.status).toBe('stopped');
    await expect(rest.getByRole('row', { name: /trained on its failures/ })).toContainText(
      `Stopped: ${stopped?.reason}`,
    );
    // Spark's second reference, with the setup this agent made, has a row of its own.
    const second = rowOf('reference', 'reference-targeted');
    await expect(rest.getByRole('row', { name: /final setup/ })).toContainText(
      `${second?.scenarios.pass} of ${second?.scenarios.total}`,
    );
    // How sure each score is, this computer's result and the memory a meter read wait under Details.
    await opened.page
      .locator('section[aria-labelledby="comparisons"]')
      .getByRole('button', { name: 'Details' })
      .click();
    const notes = opened.page.locator('section[aria-labelledby="comparisons"]');
    await expect(notes).toContainText(
      `on this computer: ${local?.scenarios.pass} of ${local?.scenarios.total}`,
    );
    await expect(notes).toContainText('GB of GPU memory');
  } finally {
    await opened.close();
  }
});
