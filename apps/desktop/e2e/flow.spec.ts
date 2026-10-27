import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import {
  DESCRIPTION,
  emitRunEvents,
  finalTest,
  finished,
  FLOW,
  FLOW_ENGINE,
  paused,
  recordedCalls,
  REPLY,
  reports,
  roundFourKept,
  startedRun,
  stubByKey,
  stubRecorded,
  stubSequence,
  turns,
} from './fixtures-flow';

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const WIDTH = 1440;
const THEMES = ['dark', 'light'] as const;

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
  await resize(900);
  await mkdir(OUT_DIR, { recursive: true });
});

test.afterAll(async () => {
  await launched?.close();
});

/** The design's artboards are 900 to 1380 tall; screenshots use the same heights. */
async function resize(height: number): Promise<void> {
  const visible = await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      const [main] = BrowserWindow.getAllWindows();
      if (!main) throw new Error('No window');
      main.setContentSize(size.width, size.height);
      return main.isVisible();
    },
    { width: WIDTH, height },
  );
  expect(visible).toBe(false);
  await launched.page.waitForFunction((h) => window.innerHeight === h, height);
}

async function capture(page: Page, name: string): Promise<void> {
  // The pointer would otherwise leave a hover highlight wherever the last click was.
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, `${name}.png`),
    animations: 'disabled',
    timeout: 15_000,
  });
}

async function applySettings(page: Page, patch: Parameters<typeof updateSettings>[1]) {
  await updateSettings(page, patch);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function stubFlow(): Promise<void> {
  const { app } = launched;
  await stubEngine(app, FLOW_ENGINE);
  await stubSequence(app, 'jobs:draftReply', turns.replies);
  await stubByKey(app, 'reports:get', reports);
  await stubRecorded(app, 'runs:start', startedRun);
  await stubRecorded(app, 'runs:pause', null);
  await stubRecorded(app, 'runs:resume', null);
}

for (const theme of THEMES) {
  test(`walks from a description to a graduate (${theme})`, async () => {
    const { app, page } = launched;
    await stubFlow();
    await applySettings(page, { theme, onboarded: true, comparisonMode: true });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    // Describe: the job in plain words, with its files.
    await resize(900);
    await goTo(page, '/new');
    await expect(page.getByRole('heading', { name: 'What should your agent do?' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Describe the job' }).fill(DESCRIPTION);
    await page.getByRole('button', { name: 'Attach files' }).click();
    const chips = page.getByRole('list', { name: 'Attached files' }).getByRole('listitem');
    await expect(chips).toHaveCount(4);
    await expect(chips.first()).toHaveText('jobs.csv');
    await capture(page, `flow-describe-${theme}`);
    await page.getByRole('button', { name: 'Send' }).click();

    // Clarify: the mentor reads the files, asks, and drafts the job.
    await expect(page.getByText('Read 4 files')).toBeVisible();
    await expect(page.getByText(turns.start.message)).toBeVisible();
    const reply = page.getByRole('textbox', { name: 'Reply' });
    await expect(reply).toBeFocused();
    await reply.fill(REPLY);
    await reply.press('Enter');
    await page.getByRole('button', { name: 'Show the line items' }).click();
    const review = page.getByRole('button', { name: 'Review the job' });
    await expect(review).toBeFocused();
    await expect(
      page.getByText("That's everything I need. I've drafted the job for you to review."),
    ).toBeVisible();
    await capture(page, `flow-clarify-${theme}`);
    await review.click();

    // Define: the drafted job, where it trains, and every field under Advanced.
    await expect(page).toHaveURL(new RegExp(`#/jobs/${FLOW.jobId}/define$`));
    await resize(1180);
    await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
    await expect(page.getByRole('radio', { name: /This computer/ })).toBeChecked();
    await capture(page, `flow-define-${theme}`);

    await page.getByRole('button', { name: 'Advanced' }).click();
    const advanced = page.getByRole('dialog', { name: 'Advanced' });
    await expect(advanced).toBeVisible();
    await advanced.getByRole('tab', { name: 'Splits' }).click();
    const practice = advanced.getByRole('textbox', { name: 'Practice' });
    await practice.fill('200');
    await expect(
      advanced.getByText('These add up to 310 tasks, but the job has 170.'),
    ).toBeVisible();
    await practice.fill('60');
    await expect(advanced.getByRole('alert')).toHaveCount(0);
    await capture(page, `flow-advanced-${theme}`);
    await page.keyboard.press('Escape');
    await expect(advanced).toBeHidden();

    await page.getByRole('radio', { name: /Hosted on Together/ }).click();
    await page
      .getByRole('checkbox', { name: 'Also run the three baselines for comparison' })
      .click();
    await page.getByRole('button', { name: 'Start training' }).click();

    // Train: the run and its baselines start on the same seed.
    await expect(page).toHaveURL(new RegExp(`#/runs/${FLOW.runId}/train$`));
    const starts = await recordedCalls(app, 'runs:start');
    expect(starts).toEqual([
      [FLOW.jobId, { method: 'architect' }],
      [FLOW.jobId, { method: 'bare', seed: FLOW.seed }],
      [FLOW.jobId, { method: 'one_shot', seed: FLOW.seed }],
      [FLOW.jobId, { method: 'self_reflection', seed: FLOW.seed }],
    ]);

    await resize(1380);
    const success = page.getByRole('region', { name: 'Task success' });
    const rounds = page.getByRole('region', { name: 'Rounds' });
    await expect(success).toContainText('78%');
    await expect(page.getByRole('status').filter({ hasText: 'Checking the change' })).toBeVisible();
    await expect(rounds).toContainText('58 → 55');
    await expect(success.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Task success by round: 40% before teaching, 58% after round 1, round 2 reverted at 55%, ' +
        '78% after round 3, round 4 in progress. Ready at 90%.',
    );
    await capture(page, `flow-train-${theme}`);

    // Live: round 4 is kept and round 5 starts.
    await emitRunEvents(app, roundFourKept());
    await expect(success).toContainText('85%');
    await expect(rounds).toContainText('78 → 85');
    await expect(page.getByRole('region', { name: 'Current round' })).toContainText('Round 5');
    await expect(
      page.getByRole('region', { name: 'Examples' }).getByRole('button').first(),
    ).toContainText('9 Birch Ln');

    // An attempt's trace, then a round's changes, each in a drawer that Escape closes.
    await resize(900);
    const failed = page.getByRole('button', { name: /14 Alder St/ });
    await failed.click();
    const traceDrawer = page.getByRole('dialog');
    await expect(traceDrawer.getByText('Failed', { exact: true })).toBeVisible();
    await expect(traceDrawer.getByText('read_table').first()).toBeVisible();
    await capture(page, `flow-trace-${theme}`);
    await page.keyboard.press('Escape');
    await expect(traceDrawer).toBeHidden();
    await expect(failed).toBeFocused();

    await rounds.getByRole('button', { name: /Cents, not dollars/ }).click();
    const roundDrawer = page.getByRole('dialog', { name: 'Round 3: Cents, not dollars' });
    await expect(
      roundDrawer.getByText('Work in integer cents from start to finish.'),
    ).toBeVisible();
    await capture(page, `flow-round-${theme}`);
    await page.keyboard.press('Escape');
    await expect(roundDrawer).toBeHidden();

    // Pause waits for the engine to say it has paused.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Pausing' })).toBeDisabled();
    await emitRunEvents(app, paused());
    await expect(page.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(await recordedCalls(app, 'runs:pause')).toEqual([[FLOW.runId]]);

    await page.getByRole('button', { name: 'Stop' }).click();
    const stop = page.getByRole('dialog', { name: 'Stop training?' });
    await expect(stop).toContainText('Glimmer still takes the final test');
    await stop.getByRole('button', { name: 'Keep training' }).click();
    await expect(stop).toBeHidden();

    // The final test, then the report card opens by itself.
    await page.locator('main').evaluate((main) => main.scrollTo({ top: 0 }));
    await emitRunEvents(app, finalTest(23));
    await expect(
      page.getByRole('status').filter({ hasText: 'Final test, Spark disconnected' }),
    ).toBeVisible();
    await expect(page.getByText('23 of 60')).toBeVisible();
    await emitRunEvents(app, finished());
    await expect(page).toHaveURL(new RegExp(`#/runs/${FLOW.runId}/report$`));

    // Report: met every requirement, with the baselines beside it.
    await resize(1240);
    await expect(page.getByRole('heading', { name: 'Service desk graduated' })).toBeVisible();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await expect(
      page.getByText('60 new tasks, offline, on this computer, Spark disconnected.'),
    ).toBeVisible();
    const comparison = page.getByRole('table');
    await expect(comparison.getByRole('row')).toHaveCount(5);
    await expect(comparison.getByRole('row', { name: /Bare student/ })).toContainText('52%');
    await capture(page, `flow-report-${theme}`);

    await page.getByRole('button', { name: 'Start using Service desk' }).click();
    await expect(page).toHaveURL(new RegExp(`#/agents/${FLOW.graduateId}/chats/${FLOW.chatId}$`));
  });
}

test('recovers when the mentor fails, and says so when it is slow', async () => {
  const { app, page } = launched;
  await stubFlow();
  await applySettings(page, { theme: 'dark', onboarded: true, comparisonMode: false });
  await stubSequence(app, 'jobs:draftStart', [
    { error: 'The mentor did not answer in time.' },
    turns.start,
  ]);
  await resize(900);
  await goTo(page, '/new');
  await page.getByRole('textbox', { name: 'Describe the job' }).fill(DESCRIPTION);
  await page.getByRole('button', { name: 'Send' }).click();

  const failure = page.getByRole('alert');
  await expect(failure).toContainText("Spark couldn't answer");
  await expect(failure).toContainText('The mentor did not answer in time.');

  // The retry is slow: the waiting line says so instead of looking stuck.
  await app.evaluate(({ ipcMain }, start) => {
    ipcMain.removeHandler('jobs:draftStart');
    ipcMain.handle(
      'jobs:draftStart',
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, value: start }), 9_000)),
    );
  }, turns.start);
  await failure.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Spark is reading your description' }),
  ).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Still working' })).toBeVisible({
    timeout: 12_000,
  });
  await expect(page.getByText(turns.start.message)).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole('alert')).toHaveCount(0);
});
