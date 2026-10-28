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
const TRAIN_HEIGHT = 1270;
const REPORT_HEIGHT = 2060;
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
    // Comparison mode is a researcher's setting, so the screens that get captured leave it off.
    await applySettings(page, { theme, onboarded: true, comparisonMode: false });
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
    await expect(page.getByRole('region', { name: 'What it does' })).toContainText(
      'Prices a finished job from the rate card',
    );
    await expect(page.getByRole('region', { name: "What it won't do" })).toContainText(
      'Issues refunds or credits',
    );
    // The write setting names the files it covers, in the same words as the agent's own setting.
    const permissions = page.getByRole('region', { name: 'Permissions' });
    await expect(permissions).toContainText('invoices.csv, bookings.csv');
    for (const setting of ['Saving changes to your files', 'Opening files outside the job']) {
      await expect(
        permissions
          .getByRole('radiogroup', { name: setting })
          .getByRole('radio', { name: 'Ask first' }),
      ).toHaveAttribute('aria-checked', 'true');
    }

    // Each place says how fast it practices and where the files go; this computer is too slow.
    const local = page.getByRole('radio', { name: /This computer/ });
    const hosted = page.getByRole('radio', { name: /Hosted on OpenRouter/ });
    await expect(local).toBeChecked();
    await expect(local).toBeDisabled();
    await expect(local).toContainText('About 2.5 minutes a task');
    await expect(local).toContainText('Free · Glimmer practices here');
    await expect(local).toContainText('Too slow for the 4-hour limit');
    // A place too slow for the limit offers the setting that would let it train.
    await page.getByRole('button', { name: 'Raise the time limit' }).click();
    const limits = page.getByRole('dialog', { name: 'Advanced settings' });
    await expect(limits.getByRole('heading', { name: 'Time and budget' })).toBeVisible();
    await expect(limits.getByRole('textbox', { name: 'Training time' })).toHaveValue('240');
    await page.keyboard.press('Escape');
    await expect(limits).toBeHidden();
    await expect(hosted).toBeEnabled();
    await expect(hosted).toContainText('About 15 seconds a task');
    await expect(hosted).toContainText('About $3 · tasks and files go to OpenRouter');

    // The plan keeps training apart from the final test, and each dollar under whoever bills it.
    const time = page.getByRole('region', { name: 'Estimated time' });
    const cost = page.getByRole('region', { name: 'Estimated cost' });
    await expect(time).toContainText('No round fits the 4-hour limit');
    await expect(time).toContainText('60 new tasks on this computer');
    await expect(time).toContainText(/In all\s*6\.5 h/);
    await expect(cost).not.toContainText('OpenRouter');
    await expect(cost).toContainText(/Meta\s*Spark\s*\$0\.70/);
    // The choices the run below starts with, so every later screen agrees with this one.
    await hosted.click();
    await expect(hosted).toBeChecked();
    await expect(time).toContainText(/Training\s*5 to 10 rounds on OpenRouter\s*4 h/);
    await expect(time).toContainText(/In all\s*6\.5 h/);
    await expect(cost).toContainText(/OpenRouter\s*Glimmer practice\s*\$3/);
    await expect(cost).toContainText(/Meta\s*Spark\s*\$0\.60/);
    // The total is the figures above it added up.
    await expect(cost).toContainText(/In all\s*\$3\.60/);
    await expect(page.getByText('About $0.60 expected', { exact: true })).toBeVisible();
    await expect(page.getByText('Keep Architect open while it trains')).toBeVisible();
    // Comparison mode is off, so nothing on the screen offers or mentions a comparison.
    await expect(page.getByText(/comparison|simpler versions/i)).toHaveCount(0);
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

    // Train: only the agent's own run starts.
    await expect(page).toHaveURL(new RegExp(`#/runs/${FLOW.runId}/train$`));
    expect(await recordedCalls(app, 'runs:start')).toEqual([[FLOW.jobId, { method: 'architect' }]]);

    await resize(TRAIN_HEIGHT);
    const success = page.getByRole('region', { name: 'Check tasks right' });
    const rounds = page.getByRole('region', { name: 'Rounds' });
    await expect(success).toContainText('78%');
    await expect(success).toContainText('31 of 40, average of 2 measurements');
    await expect(page.getByRole('list', { name: 'Each round' })).toHaveText(
      'PracticeDiagnoseScore',
    );
    await expect(page.getByRole('status').filter({ hasText: 'Scoring the change' })).toBeVisible();
    await expect(rounds).toContainText('65% → 63%');
    await expect(rounds).toContainText('First draft');
    await expect(rounds).toContainText('Reverted');
    await expect(success.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Check tasks right by round: 40% at the start, 65% after the first draft, round 2 reverted at 63%, ' +
        '78% after round 3, round 4 in progress. Target 90%.',
    );
    const resources = page.getByRole('region', { name: 'Resources' });
    await expect(resources).toContainText('1 h 46 min / 4 h');
    await expect(resources.getByRole('meter', { name: 'Time' })).toHaveAttribute(
      'aria-valuetext',
      '1 h 46 min of 4 h',
    );
    await expect(page.getByRole('region', { name: 'Current round' })).toContainText(
      /Spark expects\s*\+3 to \+6 check tasks/,
    );
    await expect(
      page.getByRole('heading', { name: 'Round 4: Allow for zone travel time' }),
    ).toBeVisible();
    // A check task is listed, marked as one the mentor never sees.
    const attempts = page.getByRole('region', { name: 'Latest attempts' });
    const hidden = attempts.getByText(', hidden from Spark');
    await expect(attempts).toContainText('Practice task, round 4');
    await expect(attempts).toContainText('Check task, round 3');
    await expect(hidden).toHaveCount(1);
    await capture(page, `flow-train-${theme}`);

    // Live: round 4 is kept and round 5 starts.
    await emitRunEvents(app, roundFourKept());
    await expect(success).toContainText('85%');
    await expect(rounds).toContainText('78% → 85%');
    await expect(page.getByRole('region', { name: 'Current round' })).toContainText('Round 5');
    await expect(attempts.getByRole('button').first()).toContainText('9 Birch Ln');
    // The check task has scrolled out of the five latest, and its mark goes with it.
    await expect(attempts).not.toContainText('Check task');
    await expect(hidden).toHaveCount(0);

    // An attempt's trace, then a round's changes, each in a drawer that Escape closes.
    await resize(900);
    const failed = page.getByRole('button', { name: /14 Alder St/ });
    await failed.click();
    const traceDrawer = page.getByRole('dialog');
    await expect(traceDrawer.getByText('Failed', { exact: true })).toBeVisible();
    await expect(traceDrawer).toContainText(
      'Scheduling · Practice task, round 4 · using the setup from round 3',
    );
    // Each step reads the way the workspace words it; the first is open, with its evidence.
    const steps = traceDrawer.getByRole('list', { name: "Glimmer's steps" });
    await expect(steps).toContainText('Read data/technicians.csv 3 rows');
    await expect(steps).toContainText('Searched data/bookings.csv for /,T-(07|11),2026-10-28,/');
    await expect(steps).toContainText('Ran code');
    await expect(traceDrawer).toContainText(
      'Loaded the skill book-urgent-calls, which matches the request',
    );
    // A table read shows its rows.
    await expect(traceDrawer.getByRole('row', { name: /T-11 Marcus O\./ })).toBeVisible();
    await capture(page, `flow-trace-${theme}`);
    // Two steps on, code shows folded, with what it gave back under it.
    await steps.locator('[aria-current="step"]').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(traceDrawer.getByText(/^Step 3 of 4$/)).toBeVisible();
    await expect(traceDrawer.getByRole('button', { name: 'Code', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(traceDrawer.getByText('=> "08:00"')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(traceDrawer).toBeHidden();
    await expect(failed).toBeFocused();

    await rounds.getByRole('button', { name: /Cents, not dollars/ }).click();
    const roundDrawer = page.getByRole('dialog', { name: 'Round 3: Cents, not dollars' });
    await expect(
      roundDrawer.getByText('Work in integer cents from start to finish.'),
    ).toBeVisible();
    await expect(roundDrawer).toContainText(
      '6 more check tasks passed (26 → 32 of 40). Measured again to rule out luck: 10 more over ' +
        'both (52 → 62 of 80), and no task type got worse.',
    );
    await expect(roundDrawer).toContainText('Within the prediction');
    await expect(roundDrawer.getByText('Measured again', { exact: true })).toBeVisible();
    await expect(roundDrawer).not.toContainText('@@');
    await capture(page, `flow-round-${theme}`);
    await page.keyboard.press('Escape');
    await expect(roundDrawer).toBeHidden();

    // A blank start's first round is Spark's whole first draft, kept without a keep check.
    await rounds.getByRole('button', { name: /Work from the office files/ }).click();
    const draftDrawer = page.getByRole('dialog', { name: 'Round 1: Work from the office files' });
    await expect(draftDrawer).toContainText(
      'Spark wrote it from the job and its example tasks, before watching Glimmer work. It is the ' +
        'starting point; later rounds keep only measured gains.',
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

    // Report: met every requirement, with the baselines beside it. The side-by-side table is part
    // of comparison mode, so the setting goes on for this screen.
    await updateSettings(page, { comparisonMode: true });
    await resize(REPORT_HEIGHT);
    await expect(page.getByRole('heading', { name: 'Service desk graduated' })).toBeVisible();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'Final test of 60 unseen tasks, offline on this computer, with Spark disconnected.',
      ),
    ).toBeVisible();
    const comparison = page.getByRole('table', { name: 'Compared with simpler methods' });
    await expect(comparison.getByRole('row')).toHaveCount(5);
    const bare = comparison.getByRole('row', { name: /No setup/ });
    await expect(bare).toContainText('40%');
    await expect(bare).toContainText('Glimmer on its own, with no instructions or skills');
    await expect(page.getByText('Up from 40% with no setup')).toBeVisible();
    await expect(comparison.getByRole('row', { name: /Architect/ })).toContainText('+52 points');
    await expect(page.getByRole('region', { name: 'What helped most' })).toContainText(
      '+5 check tasks, average of 2 measurements',
    );
    await expect(page.getByRole('heading', { name: "What it won't do" })).toBeVisible();
    await capture(page, `flow-report-${theme}`);

    await page.getByRole('button', { name: 'Start using Service desk' }).click();
    await expect(page).toHaveURL(new RegExp(`#/agents/${FLOW.graduateId}/chats/${FLOW.chatId}$`));
  });
}

test('trains three simpler versions beside the agent when comparison mode is on', async () => {
  const { app, page } = launched;
  await stubFlow();
  await applySettings(page, { theme: 'dark', onboarded: true, comparisonMode: true });
  await resize(DEFINE_HEIGHT);
  await goTo(page, `/jobs/${FLOW.jobId}/define`);
  await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
  const hosted = page.getByRole('radio', { name: /Hosted on OpenRouter/ });
  await hosted.click();
  await expect(hosted).toBeChecked();

  // Unticked, the plan is the agent's own training and the final test.
  const compare = page.getByRole('checkbox', {
    name: 'Also train three simpler versions to compare',
  });
  await expect(compare).not.toBeChecked();
  await expect(
    page.getByText('Adds 11.5 h · $3 OpenRouter · $0.06 Meta', { exact: true }),
  ).toBeVisible();
  const time = page.getByRole('region', { name: 'Estimated time' });
  const cost = page.getByRole('region', { name: 'Estimated cost' });
  await expect(time).not.toContainText('Comparison');
  await expect(time).toContainText(/In all\s*6\.5 h/);
  await expect(cost).toContainText(/In all\s*\$3\.60/);

  // Ticked, the plan adds the comparison to the time and to each bill.
  await compare.click();
  await expect(time).toContainText(/Comparison\s*Three simpler versions\s*11\.5 h/);
  await expect(time).toContainText(/In all\s*18 h/);
  await expect(cost).toContainText(/OpenRouter\s*Glimmer practice\s*\$6/);
  await expect(cost).toContainText(/Meta\s*Spark\s*\$0\.65/);
  await expect(cost).toContainText(/In all\s*\$6\.65/);

  // The baselines reuse the agent's seed, so the four runs compare like for like.
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${FLOW.runId}/train$`));
  expect(await recordedCalls(app, 'runs:start')).toEqual([
    [FLOW.jobId, { method: 'architect' }],
    [FLOW.jobId, { method: 'bare', seed: FLOW.seed }],
    [FLOW.jobId, { method: 'one_shot', seed: FLOW.seed }],
    [FLOW.jobId, { method: 'self_reflection', seed: FLOW.seed }],
  ]);
});

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
