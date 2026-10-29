import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Job } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { NOTHING_LOCAL, OLLAMA_READY, stubEngine, stubEngineFailure } from './fixtures';
import {
  COPY_ANSWERS,
  DESCRIPTION,
  emitRunEvents,
  finalTest,
  finished,
  FLOW,
  FLOW_ENGINE,
  FLOW_LOCAL,
  paused,
  recordedCalls,
  REPLY,
  reports,
  roundFourKept,
  startedRun,
  stubByKey,
  stubRecorded,
  stubSequence,
  taskPlan,
  turns,
} from './fixtures-flow';
import { job, trainedJob } from './story';

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
    // Before anything is attached, one quiet line says what drafting reads and the least it needs.
    const needs = page.getByText(
      'CSV, text and Markdown files, with at least 30 rows of records in all',
    );
    await expect(needs).toBeVisible();
    await page.getByRole('textbox', { name: 'Describe the job' }).fill(DESCRIPTION);
    await page.getByRole('button', { name: 'Attach files' }).click();
    await expect(needs).toHaveCount(0);
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
    // A drafted job is reviewed on the next screen: nothing is left to reply to.
    await expect(reply).toHaveCount(0);
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
    await expect(
      permissions
        .getByRole('radiogroup', { name: 'Saving files' })
        .getByRole('radio', { name: 'Ask first' }),
    ).toHaveAttribute('aria-checked', 'true');
    // Nothing offers a setting that does nothing: the agent can't open files outside its job.
    await expect(page.getByText('Opening files outside the job')).toHaveCount(0);

    // With the teacher's key saved and the model on this computer, nothing stands in the way.
    await expect(page.getByRole('heading', { name: 'Before it can start' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start training' })).toBeEnabled();

    // Each place says how fast it practices and where the files go; this computer is too slow.
    const local = page.getByRole('radio', { name: /Train on this computer/ });
    const hosted = page.getByRole('radio', { name: /Train online/ });
    await expect(local).toBeChecked();
    await expect(local).toBeDisabled();
    await expect(local).toContainText('Slower: about 2.5 minutes a task');
    await expect(local).toContainText('Free. Nothing leaves this computer.');
    await expect(local).toContainText('Too slow for the 4-hour limit');
    // A place too slow for the limit offers the setting that would let it train.
    await page.getByRole('button', { name: 'Allow more time' }).click();
    const limits = page.getByRole('dialog', { name: 'Advanced settings' });
    await expect(limits.getByRole('heading', { name: 'Time and budget' })).toBeVisible();
    await expect(limits.getByRole('textbox', { name: 'Training time' })).toHaveValue('240');
    await page.keyboard.press('Escape');
    await expect(limits).toBeHidden();
    await expect(hosted).toBeEnabled();
    await expect(hosted).toContainText('Faster: about 15 seconds a task');
    await expect(hosted).toContainText('About $3 · sends tasks and files online');

    // The plan keeps training apart from the final test, and each dollar under whoever bills it.
    const time = page.getByRole('region', { name: 'Estimated time' });
    const cost = page.getByRole('region', { name: 'Estimated cost' });
    await expect(time).toContainText('No round fits the 4-hour limit');
    await expect(time).toContainText('60 new tasks on this computer');
    await expect(time).toContainText(/In all\s*6\.5 h/);
    await expect(cost).not.toContainText('Online practice');
    await expect(cost).toContainText(/Spark\s*Teaching\s*\$0\.70/);
    // The choices the run below starts with, so every later screen agrees with this one.
    await hosted.click();
    await expect(hosted).toBeChecked();
    await expect(time).toContainText(/Training\s*5 to 10 rounds online\s*4 h/);
    await expect(time).toContainText(/In all\s*6\.5 h/);
    await expect(cost).toContainText(/Online practice\s*Glimmer practicing online\s*\$3/);
    await expect(cost).toContainText(/Spark\s*Teaching\s*\$0\.60/);
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
    // The example tasks: where they came from, then each type with the rule behind it, its
    // tasks in each set and three examples with their expected answers.
    await advanced.getByRole('tab', { name: 'Example tasks' }).click();
    await expect(advanced.getByText('From the tasks you attached.')).toBeVisible();
    await expect(advanced.getByText('170 tasks', { exact: true })).toBeVisible();
    await expect(
      advanced.getByText('60 practice, 40 check, 60 final test, 10 set aside', { exact: true }),
    ).toBeVisible();
    const invoices = advanced.getByRole('region', { name: 'Invoices' });
    await expect(invoices).toContainText('Price a finished job and add its invoice');
    await expect(invoices).toContainText('20 practice, 13 check, 20 final test, 3 set aside');
    await expect(invoices.getByText(/^Expected answer:/)).toHaveCount(3);
    await expect(advanced.getByText(/independently certified/)).toHaveCount(0);
    await capture(page, `flow-advanced-tasks-${theme}`);
    // The tasks were split when they were added and nothing splits them again, so the sets
    // show what they are and say why they can't change.
    await advanced.getByRole('tab', { name: 'Task sets' }).click();
    await expect(
      advanced.getByText(
        "The tasks were split into these sets when they were added, so the sets can't change now.",
      ),
    ).toBeVisible();
    await expect(advanced.getByRole('textbox', { name: 'Practice tasks' })).toHaveCount(0);
    await expect(advanced).toContainText(/Practice tasks[\s\S]*60 tasks/);
    await expect(advanced).toContainText(/Check tasks[\s\S]*40 tasks/);
    await expect(advanced).toContainText(/Final test[\s\S]*60 tasks/);
    await capture(page, `flow-advanced-${theme}`);
    // A field that can change is held to its limits, and says so until it is put right.
    await advanced.getByRole('tab', { name: 'Time and budget' }).click();
    const minutes = advanced.getByRole('textbox', { name: 'Training time' });
    await minutes.fill('0');
    await expect(
      advanced.getByText('Use whole minutes, from 1 up to a week (10,080).'),
    ).toBeVisible();
    await expect(advanced.getByRole('status')).toContainText(
      'Not saved: fix the marked field in Time and budget',
    );
    await minutes.fill('240');
    await expect(advanced.getByRole('alert')).toHaveCount(0);
    await expect(advanced.getByRole('status')).toContainText('Saved');
    await page.keyboard.press('Escape');
    await expect(advanced).toBeHidden();
    await page.getByRole('button', { name: 'Start training' }).click();

    // Train: only the agent's own run starts, with its final test on this computer and Spark
    // free to stop and ask a question.
    await expect(page).toHaveURL(new RegExp(`#/runs/${FLOW.runId}/train$`));
    expect(await recordedCalls(app, 'runs:start')).toEqual([
      [FLOW.jobId, { method: 'architect', lockedTestOn: 'local', interactive: true }],
    ]);

    await resize(TRAIN_HEIGHT);
    const success = page.getByRole('region', { name: 'Score on the check tasks' });
    const rounds = page.getByRole('region', { name: 'Rounds' });
    await expect(success).toContainText('78%');
    await expect(success).toContainText('31 of 40');
    await expect(page.getByRole('list', { name: 'Each round' })).toHaveText(
      'PracticeDiagnoseScore',
    );
    await expect(page.getByRole('status').filter({ hasText: 'Scoring the change' })).toBeVisible();
    await expect(rounds).toContainText('65% → 63%');
    await expect(rounds).toContainText('First draft');
    await expect(rounds).toContainText('No gain');
    await expect(success.getByRole('img')).toHaveAttribute(
      'aria-label',
      'Score on the check tasks by round: 40% at the start, 65% after the first draft, round 2 undone at 63%, ' +
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
    const hidden = attempts.getByText(', Spark sees only the score');
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
    await expect(roundDrawer).toContainText(
      '6 more check tasks passed (26 → 32 of 40). Measured again to rule out luck: 10 more over ' +
        'both (52 → 62 of 80), and no task type got worse.',
    );
    await expect(roundDrawer).toContainText('Measured within this range');
    await expect(roundDrawer.getByText('Measured again', { exact: true })).toBeVisible();
    // What changed says so in a sentence; its lines wait under Details.
    const changed = roundDrawer.getByRole('region', { name: 'What changed' });
    await expect(changed).toContainText('Its instructions and 1 skill.');
    await expect(changed.getByText('Work in integer cents from start to finish.')).toBeHidden();
    await capture(page, `flow-round-${theme}`);
    await changed.getByRole('button', { name: 'Details' }).click();
    await expect(changed.getByText('Work in integer cents from start to finish.')).toBeVisible();
    await expect(roundDrawer).not.toContainText('@@');
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

    // The final test, then the results open by themselves.
    await page.locator('main').evaluate((main) => main.scrollTo({ top: 0 }));
    await emitRunEvents(app, finalTest(23));
    await expect(
      page.getByRole('status').filter({ hasText: 'Final test, Spark disconnected' }),
    ).toBeVisible();
    await expect(page.getByText('23 of 60')).toBeVisible();
    await emitRunEvents(app, finished());
    await expect(page).toHaveURL(new RegExp(`#/runs/${FLOW.runId}/report$`));

    // Results: met every requirement, with the baselines beside it. The side-by-side table is part
    // of comparison mode, a researcher's setting, so it goes on to read it and off to capture.
    await resize(REPORT_HEIGHT);
    await expect(page.getByRole('heading', { name: 'Service desk graduated' })).toBeVisible();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'Tested on 60 tasks it had never seen, offline on this computer, with Spark disconnected.',
      ),
    ).toBeVisible();
    await updateSettings(page, { comparisonMode: true });
    const comparison = page.getByRole('table', { name: 'Compared with simpler methods' });
    await expect(comparison.getByRole('row')).toHaveCount(5);
    const bare = comparison.getByRole('row', { name: /No setup/ });
    await expect(bare).toContainText('40%');
    await expect(bare).toContainText('Glimmer on its own, with no instructions or skills');
    await expect(page.getByText('Up from 40% before training')).toBeVisible();
    await expect(comparison.getByRole('row', { name: /Architect/ })).toContainText('+52 points');
    await expect(page.getByRole('region', { name: 'What helped most' })).toContainText(
      '+5 check tasks',
    );
    await expect(page.getByRole('heading', { name: "What it won't do" })).toBeVisible();
    await updateSettings(page, { comparisonMode: false });
    await expect(comparison).toBeHidden();
    await capture(page, `flow-report-${theme}`);

    await page.getByRole('button', { name: 'Start using Service desk' }).click();
    await expect(page).toHaveURL(new RegExp(`#/agents/${FLOW.graduateId}/chats/${FLOW.chatId}$`));
  });
}

for (const theme of THEMES) {
  test(`says in the results' details where a drafted job's final test came from (${theme})`, async () => {
    const { app, page } = launched;
    await stubFlow();
    const drafted = {
      ...reports[FLOW.runId]!,
      tasks: { source: 'generated' as const, draftingUsd: 0.04 },
    };
    await stubByKey(app, 'reports:get', { ...reports, [FLOW.runId]: drafted });
    await applySettings(page, { theme, onboarded: true, comparisonMode: false });
    await resize(REPORT_HEIGHT);
    await goTo(page, `/runs/${FLOW.runId}/report`);
    await expect(page.getByRole('heading', { name: 'Service desk graduated' })).toBeVisible();

    // Behind the stats' Details: what drafting cost, and what the final test's answers rest on.
    await expect(page.getByText(/independently certified/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Details' }).first().click();
    await expect(page.getByText('Drafting the job')).toBeVisible();
    await expect(page.getByText('$0.04, before training')).toBeVisible();
    await expect(
      page.getByText(
        "The final test's requests were made by Architect from your files, following a job Spark drafted. Answers are checked against that job, not independently certified as right for your business.",
      ),
    ).toBeVisible();
    await capture(page, `flow-report-drafted-${theme}`);
  });
}

for (const theme of THEMES) {
  test(`says beside the score that a confirmed rule made the expected answers, with the rule under Details (${theme})`, async () => {
    const { app, page } = launched;
    await stubFlow();
    const ruled = {
      ...reports[FLOW.runId]!,
      tasks: {
        source: 'generated' as const,
        draftingUsd: 0.04,
        rules: [
          {
            typeId: 'cost',
            label: 'Ticket totals',
            version: '2a3e028da93a',
            statement:
              'Start with (labor hours rounded up to a multiple of 0.5) times 65 times 0.9 when member (customers.csv) is yes. Add parts cost. The result is rounded to the nearest cent, halves going up.',
            passages: [
              { file: 'policy.md', passage: 'Labor is billed at $65 an hour, in half-hour steps.' },
              { file: 'policy.md', passage: 'Members get 10% off labor, never off parts.' },
              {
                file: 'answers',
                passage: 'No, labor only',
                question: 'Does the 10% off for members also apply to the parts?',
              },
            ],
            conventions: [
              'Numbers are read as written. A cell that is empty, N/A or not a number leaves its row out; it is never counted as zero.',
              'All arithmetic is exact until a rounding step.',
            ],
            cases: { total: 160, eligible: 108 },
            excluded: [{ reason: 'parts_cost is empty or N/A', count: 52, example: 'T-2001' }],
            branches: [
              { label: 'member (customers.csv) is yes', cases: 40, changes: 40 },
              { label: 'member (customers.csv) is no', cases: 68, changes: 68 },
            ],
            flags: [
              'The rounding step (to the nearest cent, halves going up) never changed a value in your records, so no task shows it at work.',
            ],
            confirmedAt: '2026-10-29T12:00:00.000Z',
            expression: {
              op: 'round' as const,
              arg: { op: 'col' as const, column: 'parts_cost', from: 'row' as const },
              increment: '0.01',
              mode: 'half_up' as const,
            },
          },
        ],
      },
    };
    await stubByKey(app, 'reports:get', { ...reports, [FLOW.runId]: ruled });
    await applySettings(page, { theme, onboarded: true, comparisonMode: false });
    await resize(REPORT_HEIGHT);
    await goTo(page, `/runs/${FLOW.runId}/report`);
    await expect(page.getByRole('heading', { name: 'Service desk graduated' })).toBeVisible();

    // Right under the score, where it is read: the expected answers follow a rule that was
    // confirmed, and the score doesn't say the rule matches the business.
    const note =
      "Expected answers were calculated by Architect using Spark's interpretation of your policy, which you confirmed. This score measures agreement with that rule on held-out cases; it does not independently establish that the rule matches your business policy.";
    await expect(page.getByText(note)).toBeVisible();
    await expect(page.getByRole('region', { name: 'The rule for Ticket totals' })).toHaveCount(0);

    // Behind Details: the rule and its version, where it came from, how it was read, what was left
    // out, what each side did, and whether teaching ran.
    await page.getByRole('button', { name: 'Details' }).first().click();
    const rule = page.getByRole('region', { name: 'The rule for Ticket totals' });
    await expect(rule).toContainText('Start with (labor hours rounded up to a multiple of 0.5)');
    await expect(rule).toContainText('2a3e028da93a');
    await expect(rule).toContainText('2026-10-29');
    await expect(rule).toContainText('108 of 160');
    await expect(rule).toContainText('Members get 10% off labor, never off parts.');
    await expect(rule).toContainText('your answer');
    // An answer is read with the question it answered.
    await expect(rule).toContainText(
      'Does the 10% off for members also apply to the parts? No, labor only',
    );
    await expect(rule).toContainText('52 rows: parts_cost is empty or N/A, such as T-2001');
    await expect(rule).toContainText(
      'member (customers.csv) is yes: 40 cases, 40 where it changed',
    );
    await expect(page.getByText(/^Teaching (ran for|did not run)/)).toBeVisible();
    await rule.getByRole('button', { name: 'The rule exactly as Architect evaluates it' }).click();
    await expect(rule).toContainText('"column": "parts_cost"');
    await capture(page, `flow-report-rule-${theme}`);
  });
}

for (const theme of THEMES) {
  test(`keeps Start training off until the job's plan is known, and says so when it cannot be read (${theme})`, async () => {
    const { app, page } = launched;
    await stubFlow();
    await applySettings(page, { theme, onboarded: true, comparisonMode: false });
    await resize(DEFINE_HEIGHT);
    const start = page.getByRole('button', { name: 'Start training' });
    // Away from the job first, so that opening it reads its plan again.
    await goTo(page, '/');

    // The plan says whether the job has a rule to confirm. Until it is read, nothing says there is none.
    await app.evaluate(({ ipcMain }, plan) => {
      ipcMain.removeHandler('jobs:taskPlan');
      ipcMain.handle(
        'jobs:taskPlan',
        () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, value: plan }), 2_500)),
      );
    }, taskPlan);
    await goTo(page, `/jobs/${FLOW.jobId}/define`);
    await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
    await expect(page.getByText('Checking the job', { exact: true })).toBeVisible();
    await expect(start).toBeDisabled();
    await expect(page.getByText('Keep Architect open while it trains')).toBeVisible({
      timeout: 10_000,
    });
    await expect(start).toBeEnabled();

    // A plan that can't be read leaves it off, with the reason and a way to try again.
    await stubEngineFailure(app, { 'jobs:taskPlan': 'The engine did not answer.' });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const alert = page.getByRole('alert').filter({ hasText: "Couldn't check whether this job" });
    await expect(alert).toContainText('The engine did not answer.');
    await expect(alert).toContainText("Training can't start until it is checked.");
    await expect(page.getByText("Couldn't check the job", { exact: true })).toBeVisible();
    await expect(start).toBeDisabled();
    await capture(page, `flow-define-unreadable-${theme}`);

    // Read at last, the job has no rule to wait for, and training may start.
    await stubEngine(app, { 'jobs:taskPlan': taskPlan });
    await alert.getByRole('button', { name: 'Try again' }).click();
    await expect(alert).toHaveCount(0);
    await expect(page.getByText('Keep Architect open while it trains')).toBeVisible();
    await expect(start).toBeEnabled();
  });
}

test('trains three simpler versions beside the agent when comparison mode is on', async () => {
  const { app, page } = launched;
  await stubFlow();
  await applySettings(page, { theme: 'dark', onboarded: true, comparisonMode: true });
  await resize(DEFINE_HEIGHT);
  await goTo(page, `/jobs/${FLOW.jobId}/define`);
  await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();
  const hosted = page.getByRole('radio', { name: /Train online/ });
  await hosted.click();
  await expect(hosted).toBeChecked();

  // Unticked, the plan is the agent's own training and the final test.
  const compare = page.getByRole('checkbox', {
    name: 'Also train three simpler versions to compare',
  });
  await expect(compare).not.toBeChecked();
  await expect(
    page.getByText('Adds 11.5 h · $3 Online practice · $0.06 Spark', { exact: true }),
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
  await expect(cost).toContainText(/Online practice\s*Glimmer practicing online\s*\$6/);
  await expect(cost).toContainText(/Spark\s*Teaching\s*\$0\.65/);
  await expect(cost).toContainText(/In all\s*\$6\.65/);

  // The baselines reuse the agent's seed, so the four runs compare like for like.
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${FLOW.runId}/train$`));
  expect(await recordedCalls(app, 'runs:start')).toEqual([
    [FLOW.jobId, { method: 'architect', lockedTestOn: 'local', interactive: true }],
    [FLOW.jobId, { method: 'bare', seed: FLOW.seed, lockedTestOn: 'local' }],
    [FLOW.jobId, { method: 'one_shot', seed: FLOW.seed, lockedTestOn: 'local' }],
    [FLOW.jobId, { method: 'self_reflection', seed: FLOW.seed, lockedTestOn: 'local' }],
  ]);
});

for (const theme of THEMES) {
  test(`says what a run needs before it starts, with one action for each (${theme})`, async () => {
    const { app, page } = launched;
    await stubFlow();
    // Nothing is in place yet: no teacher key, and Glimmer isn't downloaded.
    await stubEngine(app, {
      'secrets:status': { meta: false, openrouter: false },
      'connections:detectLocal': OLLAMA_READY,
    });
    await applySettings(page, { theme, onboarded: true, comparisonMode: false });
    await resize(DEFINE_HEIGHT);
    await goTo(page, `/jobs/${FLOW.jobId}/define`);
    await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();

    const needs = page.getByRole('region', { name: 'Before it can start' });
    await expect(needs).toContainText('Spark needs a Meta key');
    await expect(needs).toContainText('Meta bills your account for it');
    await expect(needs).toContainText("Glimmer isn't on this computer yet");
    await expect(needs).toContainText('Practice and the final test run on it');
    // A run that can't start says so on its button and in the footer, and starts nothing.
    const start = page.getByRole('button', { name: 'Start training' });
    await expect(start).toBeDisabled();
    await expect(page.getByText('Spark needs a Meta key, and 1 more')).toBeVisible();
    await capture(page, `flow-define-needs-${theme}`);

    // The teacher's key is one dialog away, opened on the teacher's own provider.
    await needs.getByRole('button', { name: 'Add a Meta key' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add an API key' });
    await expect(dialog.getByRole('combobox', { name: 'Provider' })).toContainText('Meta');
    await stubEngine(app, {
      'connections:add': { secretRef: 'meta', models: 3 },
      'secrets:status': { meta: true, openrouter: false },
    });
    await dialog.getByLabel('API key').fill('key-for-the-test');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(needs).not.toContainText('Spark needs a Meta key');
    await expect(needs).toContainText("Glimmer isn't on this computer yet");

    // The download is on the row too; once the model is there the whole list is gone.
    await expect(needs.getByRole('button', { name: 'Download · 17 GB' })).toBeVisible();
    await stubEngine(app, { 'ollama:install': null, 'connections:detectLocal': FLOW_LOCAL });
    await needs.getByRole('button', { name: 'Download · 17 GB' }).click();
    await expect(page.getByRole('heading', { name: 'Before it can start' })).toHaveCount(0);
    await expect(start).toBeEnabled();
    await expect(page.getByText('Keep Architect open while it trains')).toBeVisible();
  });
}

test('says when Ollama is not running, and looks again when asked', async () => {
  const { app, page } = launched;
  await stubFlow();
  await stubEngine(app, { 'connections:detectLocal': NOTHING_LOCAL });
  await applySettings(page, { theme: 'dark', onboarded: true, comparisonMode: false });
  await resize(DEFINE_HEIGHT);
  await goTo(page, `/jobs/${FLOW.jobId}/define`);

  const needs = page.getByRole('region', { name: 'Before it can start' });
  await expect(needs).toContainText("Ollama isn't running");
  await expect(needs).toContainText('Glimmer runs through Ollama on this computer');
  await expect(page.getByRole('button', { name: 'Start training' })).toBeDisabled();
  await stubEngine(app, { 'connections:detectLocal': FLOW_LOCAL });
  await needs.getByRole('button', { name: 'Check again' }).click();
  await expect(page.getByRole('heading', { name: 'Before it can start' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start training' })).toBeEnabled();
});

test('asks the online copy before it starts, and stays when it does not answer', async () => {
  const { app, page } = launched;
  await stubFlow();
  await stubEngine(app, {
    'jobs:get': trainedJob,
    'connections:testStudent': {
      ok: false,
      error: 'OpenRouter did not answer in time.',
      hint: 'Check your connection, then try again.',
    },
  });
  await applySettings(page, { theme: 'dark', onboarded: true, comparisonMode: false });
  await resize(DEFINE_HEIGHT);
  await goTo(page, `/jobs/${FLOW.jobId}/define`);

  // Everything saved is in place, so nothing is listed until the copy is asked.
  await expect(page.getByRole('radio', { name: /Train online/ })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Before it can start' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start training' }).click();
  const needs = page.getByRole('region', { name: 'Before it can start' });
  await expect(needs).toContainText("OpenRouter didn't answer");
  await expect(needs).toContainText('OpenRouter did not answer in time. Check your connection');
  await expect(page).toHaveURL(new RegExp(`#/jobs/${FLOW.jobId}/define$`));
  expect(await recordedCalls(app, 'runs:start')).toEqual([]);

  // Once it answers, one press of Try again clears the list and the run can start.
  await stubEngine(app, { 'connections:testStudent': COPY_ANSWERS });
  await needs.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Before it can start' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${FLOW.runId}/train$`));
  expect(await recordedCalls(app, 'runs:start')).toEqual([
    [FLOW.jobId, { method: 'architect', lockedTestOn: 'local', interactive: true }],
  ]);
});

test('still asks for the model on this computer when practice and the final test both run online', async () => {
  const { app, page } = launched;
  await stubFlow();
  // Everything is online and saved, and Ollama runs without the model.
  await stubEngine(app, {
    'jobs:get': trainedJob,
    'connections:detectLocal': OLLAMA_READY,
    'connections:testStudent': COPY_ANSWERS,
  });
  await applySettings(page, { theme: 'dark', onboarded: true, comparisonMode: false });
  await resize(DEFINE_HEIGHT);
  await goTo(page, `/jobs/${FLOW.jobId}/define`);
  await expect(page.getByRole('radio', { name: /Train online/ })).toBeChecked();
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  const advanced = page.getByRole('dialog', { name: 'Advanced settings' });
  await advanced.getByRole('tab', { name: 'Ready when' }).click();
  const where = advanced.getByRole('radiogroup', { name: 'Where the final test runs' });
  await where.getByRole('radio', { name: /On the online copy/ }).click();
  await page.keyboard.press('Escape');
  await expect(advanced).toBeHidden();

  // Nothing in the run itself uses this computer now, but the finished agent runs on it, so the
  // run says so before it starts instead of after hours of training and a bill.
  const needs = page.getByRole('region', { name: 'Before it can start' });
  await expect(needs).toContainText("Glimmer isn't on this computer yet");
  await expect(needs).toContainText(
    'The finished agent runs on it, so it has to be here when training ends.',
  );
  const start = page.getByRole('button', { name: 'Start training' });
  await expect(start).toBeDisabled();
  expect(await recordedCalls(app, 'runs:start')).toEqual([]);

  // With the model downloaded the list is gone, and the run starts with both ends online.
  await stubEngine(app, { 'ollama:install': null, 'connections:detectLocal': FLOW_LOCAL });
  await needs.getByRole('button', { name: 'Download · 17 GB' }).click();
  await expect(page.getByRole('heading', { name: 'Before it can start' })).toHaveCount(0);
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${FLOW.runId}/train$`));
  expect(await recordedCalls(app, 'runs:start')).toEqual([
    [FLOW.jobId, { method: 'architect', lockedTestOn: 'hosted', interactive: true }],
  ]);
});

for (const theme of THEMES) {
  test(`takes the final test on the online copy when asked (${theme})`, async () => {
    const { app, page } = launched;
    await stubFlow();
    await applySettings(page, { theme, onboarded: true, comparisonMode: false });
    await resize(DEFINE_HEIGHT);
    await goTo(page, `/jobs/${FLOW.jobId}/define`);
    await expect(page.getByRole('heading', { name: 'Service desk', level: 1 })).toBeVisible();

    // By default the final test is taken on this computer, which the plan shows.
    const time = page.getByRole('region', { name: 'Estimated time' });
    const cost = page.getByRole('region', { name: 'Estimated cost' });
    await expect(time).toContainText(/Final test\s*60 new tasks on this computer\s*2\.5 h/);
    await expect(cost).not.toContainText('Online final test');

    await page.getByRole('button', { name: 'Advanced settings' }).click();
    const advanced = page.getByRole('dialog', { name: 'Advanced settings' });
    await advanced.getByRole('tab', { name: 'Ready when' }).click();
    const where = advanced.getByRole('radiogroup', { name: 'Where the final test runs' });
    const here = where.getByRole('radio', { name: /On this computer/ });
    const online = where.getByRole('radio', { name: /On the online copy/ });
    await expect(here).toBeChecked();
    await expect(here).toContainText('About 2.5 hours for 60 tasks · Free');
    await expect(here).toContainText('The agent is marked ready when it passes.');
    await expect(online).toContainText('About 15 minutes for 60 tasks · About $0.20');
    await expect(online).toContainText(
      'The agent is marked as tested online. You can test it on this computer later.',
    );
    await online.click();
    await expect(online).toBeChecked();
    await capture(page, `flow-advanced-final-test-${theme}`);
    await page.keyboard.press('Escape');
    await expect(advanced).toBeHidden();

    // The plan follows the choice: a quarter of an hour, and a line on the host's bill.
    await expect(time).toContainText(/Final test\s*60 new tasks online\s*15 min/);
    await expect(cost).toContainText(
      /Online final test\s*Glimmer taking the final test online\s*\$0\.20/,
    );

    await page.getByRole('button', { name: 'Start training' }).click();
    await expect(page).toHaveURL(new RegExp(`#/runs/${FLOW.runId}/train$`));
    expect(await recordedCalls(app, 'runs:start')).toEqual([
      [FLOW.jobId, { method: 'architect', lockedTestOn: 'hosted', interactive: true }],
    ]);
  });
}

for (const theme of THEMES) {
  test(`chooses what the teacher may change, and keeps the last way to change the agent on (${theme})`, async () => {
    const { app, page } = launched;
    await stubFlow();
    // The job is saved as it is sent, and no Hugging Face token comes from anywhere.
    await stubRecorded(app, 'jobs:save', job);
    await stubEngine(app, { 'connections:huggingFace': { source: null } });
    await applySettings(page, { theme, onboarded: true, comparisonMode: false });
    await resize(DEFINE_HEIGHT);
    await goTo(page, `/jobs/${FLOW.jobId}/define`);
    await page.getByRole('button', { name: 'Advanced settings' }).click();
    const advanced = page.getByRole('dialog', { name: 'Advanced settings' });
    await advanced.getByRole('tab', { name: 'Teacher' }).click();
    const section = advanced.getByRole('region', { name: 'What Spark may change' });
    const kinds = [
      'Instructions and steps',
      'What it reads when',
      'Small tools',
      'Its weights',
      'Questions for you',
    ];
    // A job that never chose has every kind on, and the weights say what they need.
    for (const kind of kinds) {
      await expect(section.getByRole('switch', { name: kind })).toBeChecked();
    }
    await expect(section).toContainText('Needs a Hugging Face token, added in Settings');
    await expect(section.getByRole('switch', { name: 'Its weights' })).toBeEnabled();

    await section.getByRole('switch', { name: 'Small tools' }).click();
    await section.getByRole('switch', { name: 'Questions for you' }).click();
    await expect(advanced.getByRole('status')).toContainText('Saved');
    const saved = (await recordedCalls(app, 'jobs:save')).map(([sent]) => sent as Job);
    expect(saved.at(-1)?.interventions).toEqual(['procedure', 'retrieval', 'weights']);
    const toBottom = () =>
      section.evaluate((element) => {
        const panel = element.closest('[role="tabpanel"]');
        if (panel) panel.scrollTop = panel.scrollHeight;
      });
    await toBottom();
    await capture(page, `flow-advanced-teacher-${theme}`);

    // Leave only the weights, which the app knows can't be trained here: the switch holds, and
    // says why, and Start training says there is nothing for the teacher to do.
    await section.getByRole('switch', { name: 'Instructions and steps' }).click();
    await section.getByRole('switch', { name: 'What it reads when' }).click();
    await expect(section.getByRole('switch', { name: 'Its weights' })).toBeDisabled();
    await expect(section.getByRole('switch', { name: 'Its weights' })).toBeChecked();
    await expect(section).toContainText(
      'Stays on: the only way left to change the agent. Its weights need a Hugging Face token, added in Settings.',
    );
    await expect(advanced.getByRole('status')).toContainText('Saved');
    expect(((await recordedCalls(app, 'jobs:save')).at(-1)?.[0] as Job).interventions).toEqual([
      'weights',
    ]);
    await toBottom();
    await capture(page, `flow-advanced-teacher-last-${theme}`);

    await page.keyboard.press('Escape');
    await expect(advanced).toBeHidden();
    const needs = page.getByRole('region', { name: 'Before it can start' });
    await expect(needs).toContainText('Spark has nothing it may change');
    await expect(needs).toContainText(
      'Only its weights are on, and they need a Hugging Face token, added in Settings. Turn something else on, or put that right.',
    );
    await expect(page.getByRole('button', { name: 'Start training' })).toBeDisabled();
    expect(await recordedCalls(app, 'runs:start')).toEqual([]);

    // Its button opens the Teacher tab, where a kind is turned on again and the hold lifts.
    await needs.getByRole('button', { name: "Open Spark's settings" }).click();
    await expect(advanced.getByRole('region', { name: 'What Spark may change' })).toBeVisible();
    await advanced.getByRole('switch', { name: 'Instructions and steps' }).click();
    await page.keyboard.press('Escape');
    await expect(needs).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start training' })).toBeEnabled();
  });
}

test('cannot take the final test online without an online copy to take it on', async () => {
  const { app, page } = launched;
  await stubFlow();
  const { hosted: _copy, ...student } = job.student;
  await stubEngine(app, { 'jobs:get': { ...job, student } });
  await applySettings(page, { theme: 'dark', onboarded: true, comparisonMode: false });
  await resize(DEFINE_HEIGHT);
  await goTo(page, `/jobs/${FLOW.jobId}/define`);
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  const advanced = page.getByRole('dialog', { name: 'Advanced settings' });
  await advanced.getByRole('tab', { name: 'Ready when' }).click();
  const where = advanced.getByRole('radiogroup', { name: 'Where the final test runs' });
  const online = where.getByRole('radio', { name: /On the online copy/ });
  await expect(online).toBeDisabled();
  await expect(online).toContainText("Choose an online copy under Agent's model first");
  await expect(where.getByRole('radio', { name: /On this computer/ })).toBeChecked();
});

test('keeps a checker file chosen from elsewhere inside the job, and saves that copy from then on', async () => {
  const { app, page } = launched;
  await stubFlow();
  // A job graded by a checker file, as the sample job is, and a file to choose in its place.
  await stubEngine(app, {
    'jobs:get': { ...job, checker: { kind: 'module', path: 'checker.js' } },
    'files:pick': ['D:/Downloads/my-checks.js'],
  });
  // The engine copies a file chosen by its full path into the job and answers with the copy's name.
  await app.evaluate(({ ipcMain }) => {
    const store = globalThis as typeof globalThis & { savedCheckers?: unknown[] };
    store.savedCheckers = [];
    ipcMain.removeHandler('jobs:save');
    ipcMain.handle('jobs:save', (_event, saved: { checker: { kind: string; path?: string } }) => {
      store.savedCheckers?.push(saved.checker);
      const chosen =
        saved.checker.kind === 'module' && /^([A-Za-z]:)?[\\/]/.test(saved.checker.path ?? '');
      const checker = { kind: 'module', path: 'my-checks-3f9a2c1b4d5e.js' };
      return { ok: true, value: chosen ? { ...saved, checker } : saved };
    });
  });
  const savedCheckers = () =>
    app.evaluate(
      () => (globalThis as typeof globalThis & { savedCheckers?: unknown[] }).savedCheckers ?? [],
    );
  await applySettings(page, { theme: 'dark', onboarded: true, comparisonMode: false });
  await resize(DEFINE_HEIGHT);
  await goTo(page, `/jobs/${FLOW.jobId}/define`);
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  const advanced = page.getByRole('dialog', { name: 'Advanced settings' });
  await advanced.getByRole('tab', { name: 'Grading' }).click();
  await expect(advanced.getByText('checker.js', { exact: true }).first()).toBeVisible();
  await expect(
    advanced.getByText(
      'A file you choose is copied into the job when it saves, so moving the original changes nothing.',
    ),
  ).toBeVisible();

  await advanced.getByRole('button', { name: 'Change' }).click();
  await expect(advanced.getByText('my-checks-3f9a2c1b4d5e.js').first()).toBeVisible();
  expect(await savedCheckers()).toEqual([{ kind: 'module', path: 'D:/Downloads/my-checks.js' }]);

  // The next save, of another field, names the copy: the original is never looked for again.
  await advanced.getByRole('tab', { name: 'Time and budget' }).click();
  await advanced.getByRole('textbox', { name: 'Rounds' }).fill('10');
  await expect(advanced.getByRole('status')).toContainText('Saved');
  expect((await savedCheckers()).at(-1)).toEqual({
    kind: 'module',
    path: 'my-checks-3f9a2c1b4d5e.js',
  });
});

test('exports the job file where the person chooses, and says what stays behind', async () => {
  const { app, page } = launched;
  await stubFlow();
  await stubRecorded(app, 'files:save', 'D:/Exports/service-desk.job.json');
  await stubRecorded(app, 'jobs:exportFile', null);
  await applySettings(page, { theme: 'dark', onboarded: true, comparisonMode: false });
  await resize(DEFINE_HEIGHT);
  await goTo(page, `/jobs/${FLOW.jobId}/define`);
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  const advanced = page.getByRole('dialog', { name: 'Advanced settings' });

  await advanced.getByRole('button', { name: 'Export the job file' }).click();
  await expect(
    page.getByText('service-desk.job.json. Its tasks and data files stay on this computer.'),
  ).toBeVisible();
  expect(await recordedCalls(app, 'files:save')).toEqual([
    [
      {
        title: 'Export the job file',
        defaultName: 'service-desk.job.json',
        filters: [{ name: 'Job file', extensions: ['json'] }],
      },
    ],
  ]);
  expect(await recordedCalls(app, 'jobs:exportFile')).toEqual([
    [FLOW.jobId, 'D:/Exports/service-desk.job.json'],
  ]);

  // Closing the save dialog without choosing a file writes nothing.
  await stubRecorded(app, 'files:save', null);
  await stubRecorded(app, 'jobs:exportFile', null);
  await advanced.getByRole('button', { name: 'Export the job file' }).click();
  await expect.poll(() => recordedCalls(app, 'files:save')).toHaveLength(1);
  expect(await recordedCalls(app, 'jobs:exportFile')).toEqual([]);
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

const NOTE =
  "I couldn't settle this from your files and answers, so I left it open:\nWhether cancelled orders count in totals.\n\nI've drafted the job for you to review.";
const TOO_FEW =
  'Your files hold only 3 rows between them, too few to make 30 different tasks to train and test on. Attach more of the records, or a tasks.jsonl file with example requests and their answers, and describe the job again.';

for (const theme of THEMES) {
  test(`shows what a draft left open, beside the way to review it (${theme})`, async () => {
    const { app, page } = launched;
    await stubFlow();
    await applySettings(page, { theme, onboarded: true, comparisonMode: false });
    await stubSequence(app, 'jobs:draftStart', [
      { sessionId: FLOW.sessionId, message: NOTE, options: [], draft: turns.replies[1]?.draft },
    ]);
    await resize(900);
    await goTo(page, '/new');
    await page.getByRole('textbox', { name: 'Describe the job' }).fill(DESCRIPTION);
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(
      page.getByText("I couldn't settle this from your files and answers"),
    ).toBeVisible();
    await expect(page.getByText('Whether cancelled orders count in totals')).toBeVisible();
    // The note stands in the place of the line that says nothing was left open.
    await expect(page.getByText("That's everything I need.")).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review the job' })).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Reply' })).toHaveCount(0);
    await capture(page, `flow-clarify-open-${theme}`);
  });

  test(`says what to attach when the files cannot make a job, and puts the description back (${theme})`, async () => {
    const { app, page } = launched;
    await stubFlow();
    await applySettings(page, { theme, onboarded: true, comparisonMode: false });
    await stubSequence(app, 'jobs:draftStart', [
      { sessionId: FLOW.sessionId, message: TOO_FEW, options: [], ended: true },
    ]);
    await resize(900);
    await goTo(page, '/new');
    await page.getByRole('textbox', { name: 'Describe the job' }).fill(DESCRIPTION);
    await page.getByRole('button', { name: 'Attach files' }).click();
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText('Your files hold only 3 rows between them')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Reply' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Review the job' })).toHaveCount(0);
    await capture(page, `flow-clarify-ended-${theme}`);

    // Starting again leaves the description and its files in the box, to add to.
    await page.getByRole('button', { name: 'Edit the description' }).click();
    await expect(page.getByRole('textbox', { name: 'Describe the job' })).toHaveValue(DESCRIPTION);
    await expect(
      page.getByRole('list', { name: 'Attached files' }).getByRole('listitem'),
    ).toHaveCount(6);
  });
}

test('offers to edit the description when the conversation is gone, since asking again cannot bring it back', async () => {
  const { app, page } = launched;
  await stubFlow();
  await applySettings(page, { theme: 'dark', onboarded: true, comparisonMode: false });
  await stubEngineFailure(app, {
    'jobs:draftReply': {
      message: 'This conversation is no longer open. Describe the job again to start a new one.',
      code: 'draft_not_found',
    },
  });
  await resize(900);
  await goTo(page, '/new');
  await page.getByRole('textbox', { name: 'Describe the job' }).fill(DESCRIPTION);
  await page.getByRole('button', { name: 'Send' }).click();
  const reply = page.getByRole('textbox', { name: 'Reply' });
  await reply.fill('North');
  await reply.press('Enter');

  const failure = page.getByRole('alert');
  await expect(failure).toContainText('This conversation is gone.');
  await expect(failure.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit the description' }).click();
  await expect(page.getByRole('textbox', { name: 'Describe the job' })).toHaveValue(DESCRIPTION);
});
