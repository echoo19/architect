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
/** Tall enough for each screen's whole page, so a screenshot shows everything on it. */
const DEFINE_HEIGHT = 1580;
const TRAIN_HEIGHT = 1380;
const REPORT_HEIGHT = 1660;
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
    await expect(chips).toHaveCount(6);
    await expect(chips.first()).toHaveText('jobs.csv');
    await capture(page, `flow-describe-${theme}`);
    await page.getByRole('button', { name: 'Send' }).click();

    // Clarify: the mentor reads the files, asks, and drafts the job.
    await expect(page.getByText('Read 6 files')).toBeVisible();
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

    // Define: the drafted job, where it trains, and every field in Advanced settings.
    await expect(page).toHaveURL(new RegExp(`#/jobs/${FLOW.jobId}/define$`));
    await resize(DEFINE_HEIGHT);
    await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What it does' })).toBeVisible();
    await expect(page.getByRole('heading', { name: "What it won't do" })).toBeVisible();
    const local = page.getByRole('radio', { name: /This computer/ });
    const hosted = page.getByRole('radio', { name: /Hosted on OpenRouter/ });
    await expect(local).toBeChecked();
    await expect(local).toContainText('Too slow for the time limit of 4 hours');
    await expect(hosted).toContainText('billed by OpenRouter');
    await expect(page.getByText('About 7 hours in all on this computer, plus up to')).toBeVisible();
    await expect(
      page.getByText('A hosted copy fits 5 to 10 rounds in the time this computer fits none.'),
    ).toBeHidden();
    // The choices the run below starts with, so every later screen agrees with this one.
    await hosted.click();
    await expect(hosted).toBeChecked();
    await page
      .getByRole('checkbox', { name: 'Also train three simpler versions to compare against' })
      .click();
    await expect(page.getByText("About 18 hours in all on OpenRouter's copy, about")).toBeVisible();
    await capture(page, `flow-define-${theme}`);

    await page.getByRole('button', { name: 'Advanced settings' }).click();
    const advanced = page.getByRole('dialog', { name: 'Advanced settings' });
    await expect(advanced).toBeVisible();
    await advanced.getByRole('tab', { name: 'Task sets' }).click();
    const practice = advanced.getByRole('textbox', { name: 'Practice tasks' });
    await practice.fill('200');
    await expect(
      advanced.getByText('These add up to 310 tasks, but the job has 170.'),
    ).toBeVisible();
    await expect(advanced.getByRole('status')).toContainText('Not saved: fix the marked field');
    await practice.fill('60');
    await expect(advanced.getByRole('alert')).toHaveCount(0);
    await expect(advanced.getByRole('status')).toContainText('Saved');
    await capture(page, `flow-advanced-${theme}`);
    await page.keyboard.press('Escape');
    await expect(advanced).toBeHidden();
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

    await resize(TRAIN_HEIGHT);
    const success = page.getByRole('region', { name: 'Check tasks right' });
    const rounds = page.getByRole('region', { name: 'Rounds' });
    await expect(success).toContainText('78%');
    await expect(success).toContainText('31 of 40 on average, over 2 checks');
    await expect(page.getByRole('status').filter({ hasText: 'Scoring the change' })).toBeVisible();
    await expect(rounds).toContainText('65% to 63%');
    await expect(rounds).toContainText('First draft');
    await expect(rounds).toContainText('Reverted');
    await expect(success.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Check tasks right by round: 40% at the start, 65% after the first draft, round 2 reverted at 63%, ' +
        '78% after round 3, round 4 in progress. Target 90%.',
    );
    await expect(page.getByRole('region', { name: 'Resources' })).toContainText(
      '1 h 46 min of 4 h',
    );
    await expect(page.getByRole('region', { name: 'Current round' })).toContainText(
      '+3 to +6 more of the 40 check tasks right',
    );
    await capture(page, `flow-train-${theme}`);

    // Live: round 4 is kept and round 5 starts.
    await emitRunEvents(app, roundFourKept());
    await expect(success).toContainText('85%');
    await expect(rounds).toContainText('78% to 85%');
    await expect(page.getByRole('region', { name: 'Current round' })).toContainText('Round 5');
    await expect(
      page.getByRole('region', { name: 'Latest attempts' }).getByRole('button').first(),
    ).toContainText('9 Birch Ln');

    // An attempt's trace, then a round's changes, each in a drawer that Escape closes.
    await resize(900);
    const failed = page.getByRole('button', { name: /14 Alder St/ });
    await failed.click();
    const traceDrawer = page.getByRole('dialog');
    await expect(traceDrawer.getByText('Failed', { exact: true })).toBeVisible();
    await expect(traceDrawer.getByText('read_table').first()).toBeVisible();
    await expect(traceDrawer).toContainText('using the setup from round 3');
    await expect(traceDrawer).toContainText(
      'Loaded the skill book-urgent-calls automatically, because the request matched it',
    );
    await expect(traceDrawer).toContainText('step-by-step instructions');
    await capture(page, `flow-trace-${theme}`);
    await page.keyboard.press('Escape');
    await expect(traceDrawer).toBeHidden();
    await expect(failed).toBeFocused();

    await rounds.getByRole('button', { name: /Cents, not dollars/ }).click();
    const roundDrawer = page.getByRole('dialog', { name: 'Round 3: Cents, not dollars' });
    await expect(
      roundDrawer.getByText('Work in integer cents from start to finish.'),
    ).toBeVisible();
    await expect(roundDrawer).toContainText(
      '6 more check tasks passed on the first check (26 to 32 of 40). Run a second time to ' +
        'rule out luck: 10 more over both checks (52 to 62 of 80), and no task type got worse.',
    );
    await expect(roundDrawer).toContainText("The first check was inside Spark's predicted range.");
    await expect(roundDrawer.getByText('Average of the two checks')).toBeVisible();
    await expect(roundDrawer).not.toContainText('@@');
    await capture(page, `flow-round-${theme}`);
    await page.keyboard.press('Escape');
    await expect(roundDrawer).toBeHidden();

    // A blank start's first round is Spark's whole first draft, kept without a keep check.
    await rounds.getByRole('button', { name: /Work from the office files/ }).click();
    const draftDrawer = page.getByRole('dialog', { name: 'Round 1: Work from the office files' });
    await expect(draftDrawer).toContainText(
      "Spark wrote the agent's first full setup from the job and its example tasks, before " +
        'watching it work. It is kept as the starting point; later rounds keep only measured gains.',
    );
    await expect(draftDrawer).not.toContainText('Run a second time');
    await page.keyboard.press('Escape');
    await expect(draftDrawer).toBeHidden();

    // Pause waits for the engine to say it has paused.
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.getByRole('button', { name: 'Pausing' })).toBeDisabled();
    await emitRunEvents(app, paused());
    await expect(page.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(await recordedCalls(app, 'runs:pause')).toEqual([[FLOW.runId]]);

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    const stop = page.getByRole('dialog', { name: 'Stop training?' });
    await expect(stop).toContainText('keeps its best version so far (the setup from round 4)');
    await expect(stop).toContainText('Glimmer takes the 60-task final test');
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
    await resize(REPORT_HEIGHT);
    await expect(page.getByRole('heading', { name: 'Service desk graduated' })).toBeVisible();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        "Glimmer, your agent's model, took a final test of 60 tasks it had never seen, " +
          'offline on this computer, with Spark, the mentor, disconnected.',
      ),
    ).toBeVisible();
    const comparison = page.getByRole('table');
    await expect(comparison.getByRole('row')).toHaveCount(5);
    const bare = comparison.getByRole('row', { name: /No setup/ });
    await expect(bare).toContainText('40%');
    await expect(bare).toContainText('Glimmer on its own, with no instructions or skills');
    await expect(
      page.getByText('Up from 40% before training (Glimmer with no setup)'),
    ).toBeVisible();
    await expect(comparison.getByRole('row', { name: /Architect/ })).toContainText('+52 points');
    await expect(page.getByRole('region', { name: 'What helped most' })).toContainText(
      '+5 check tasks a check, on average over 2',
    );
    await expect(page.getByRole('heading', { name: "What it won't do" })).toBeVisible();
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
