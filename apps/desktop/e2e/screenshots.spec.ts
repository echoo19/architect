import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { glimmerBuild } from '@architect/shared';
import {
  EMPTY_ENGINE,
  OLLAMA_READY,
  SAMPLE,
  SAMPLE_ENGINE,
  stubEngine,
  stubEngineFailure,
} from './fixtures';
import {
  lessonCount,
  recordedComparison,
  recordedComparisonReport,
  recordedData,
  recordedSummary,
  roundWith,
  type RecordedSummary,
} from './recorded';

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const THEMES = ['dark', 'light'] as const;

/** Every route, with ids the engine doesn't know, so each shows its real empty or error state. */
const ROUTES = [
  { name: 'workspace', path: '/' },
  { name: 'chat', path: '/agents/grd_example/chats/cht_example' },
  { name: 'describe', path: '/new' },
  { name: 'define', path: '/jobs/job_example/define' },
  { name: 'train', path: '/runs/run_example/train' },
  { name: 'report', path: '/runs/run_example/report' },
] as const;

/** The same screens filled with sample engine replies. */
const SAMPLE_ROUTES = [
  { name: 'chat-sample', path: `/agents/${SAMPLE.graduateId}/chats/${SAMPLE.chatId}` },
  { name: 'define-sample', path: `/jobs/${SAMPLE.jobId}/define` },
  { name: 'train-sample', path: `/runs/${SAMPLE.runId}/train` },
  { name: 'report-sample', path: `/runs/${SAMPLE.runId}/report` },
] as const;

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
  const visible = await launched.app.evaluate(({ BrowserWindow }, size) => {
    const [main] = BrowserWindow.getAllWindows();
    if (!main) throw new Error('No window');
    main.setContentSize(size.width, size.height);
    return main.isVisible();
  }, SIZE);
  expect(visible).toBe(false);
  await mkdir(OUT_DIR, { recursive: true });
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(page: Page, file: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

/** Settings changed behind the renderer's back need a reload before its cache sees them. */
async function applySettings(page: Page, patch: Parameters<typeof updateSettings>[1]) {
  await updateSettings(page, patch);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

for (const theme of THEMES) {
  test(`captures every screen in the ${theme} theme`, async () => {
    const page = launched.page;
    await stubEngine(launched.app, { ...EMPTY_ENGINE, 'connections:detectLocal': OLLAMA_READY });
    await applySettings(page, { theme, onboarded: false });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([
      SIZE.width,
      SIZE.height,
    ]);

    await goTo(page, '/welcome');
    await expect(page.getByText('Running · 0.12.6')).toBeVisible();
    await capture(page, `welcome-${theme}.png`);

    await applySettings(page, { onboarded: true });
    for (const route of ROUTES) {
      await goTo(page, route.path);
      await capture(page, `${route.name}-${theme}.png`);
    }

    // Settings and the palette over a workspace that has an agent, a saved mentor key, and
    // Glimmer's GPU-sized build as the agent's model.
    await stubEngine(launched.app, {
      ...SAMPLE_ENGINE,
      'secrets:status': { meta: true, openrouter: true },
    });
    const gpuBuild = glimmerBuild('glimmer-gpu');
    const defaultStudent = await page.evaluate(() =>
      window.architect.settings.get().then((current) => current.defaultStudent),
    );
    await applySettings(page, {
      onboarded: true,
      defaultStudent: { ...defaultStudent, model: gpuBuild.model },
    });
    await goTo(page, `/agents/${SAMPLE.graduateId}/chats/${SAMPLE.chatId}`);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await capture(page, `settings-general-${theme}.png`);
    await page.getByRole('tab', { name: 'Models' }).click();
    await expect(page.getByText('Running · 0.12.6 · 1 model')).toBeVisible();
    await capture(page, `settings-models-${theme}.png`);
    await page.keyboard.press('Escape');

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await capture(page, `palette-${theme}.png`);
    await page.keyboard.press('Escape');
    await updateSettings(page, { defaultStudent });
  });
}

test('captures the empty workspace and a failed action', async () => {
  const page = launched.page;
  await stubEngine(launched.app, EMPTY_ENGINE);
  await stubEngineFailure(launched.app, {
    'jobs:createSample': "The engine isn't running, so the sample job can't be created.",
  });
  for (const theme of THEMES) {
    await applySettings(page, { theme });
    await goTo(page, '/');
    await expect(page.getByRole('heading', { name: 'No agents yet' })).toBeVisible();
    await capture(page, `workspace-empty-${theme}.png`);

    // With creating the sample job made to fail, the app says why in a toast.
    await page.getByRole('button', { name: 'Try the sample job' }).click();
    // Exact, so the toast's screen-reader announcement doesn't also match.
    await expect(page.getByText("Couldn't create the sample job", { exact: true })).toBeVisible();
    await capture(page, `toast-${theme}.png`);
    await page.getByRole('button', { name: 'Dismiss' }).click();
  }
});

test('captures the populated screens with sample engine replies', async () => {
  const page = launched.page;
  await stubEngine(launched.app, SAMPLE_ENGINE);
  for (const theme of THEMES) {
    await applySettings(page, { theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const route of SAMPLE_ROUTES) {
      await goTo(page, route.path);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await capture(page, `${route.name}-${theme}.png`);
    }
  }
});

/*
 * The evidence screens on the run the global setup recorded with the engine's fakes: the app's
 * own engine reads its lessons, experiments, traces and report, so nothing on these screens is
 * a number written for a screenshot. The story's run above, which kept no mentoring records,
 * shows the same screens empty.
 */
test.describe('the evidence screens of a recorded run', () => {
  /** Tall enough for the whole training board and the whole report. */
  const BOARD_HEIGHT = 1840;
  const REPORT_HEIGHT = 1700;
  /** Tall enough for a whole round or example in its drawer, down to the files it changed. */
  const DRAWER_HEIGHT = 2400;
  /** The report without its capabilities and comparisons, when they fail to load. */
  const SHORT_REPORT_HEIGHT = 1300;
  /** A comparison arm's report, with every arm of the comparison in its table. */
  const COMPARISON_REPORT_HEIGHT = 2100;

  let recorded: LaunchedApp;
  let summary: RecordedSummary;

  async function open(
    theme: (typeof THEMES)[number],
    from: { data: string } | { comparison: string } = { data: recordedData() },
  ): Promise<LaunchedApp> {
    const app = await launchApp({ ...from, settings: { onboarded: true, theme } });
    await expect(app.page.locator('html')).toHaveAttribute('data-theme', theme);
    return app;
  }

  async function resize(height: number): Promise<void> {
    await recorded.app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
      },
      { width: SIZE.width, height },
    );
    await recorded.page.waitForFunction((h) => window.innerHeight === h, height);
  }

  async function shoot(file: string): Promise<void> {
    // The pointer would otherwise leave a hover highlight wherever the last click was.
    await recorded.page.mouse.move(0, 0);
    await capture(recorded.page, file);
  }

  async function openRound(round: number) {
    await recorded.page
      .getByRole('region', { name: 'Rounds' })
      .getByRole('button')
      .filter({ hasText: new RegExp(`^${String(round).padStart(2, '0')}`) })
      .click();
    const drawer = recorded.page.getByRole('dialog', { name: new RegExp(`^Round ${round}`) });
    await expect(drawer).toBeVisible();
    return drawer;
  }

  async function closeDrawer(): Promise<void> {
    await recorded.page.keyboard.press('Escape');
    await expect(recorded.page.getByRole('dialog')).toHaveCount(0);
  }

  test.beforeAll(async () => {
    summary = await recordedSummary();
  });

  test.afterEach(async () => {
    await recorded?.close();
  });

  for (const theme of THEMES) {
    test(`captures lessons, experiments, playback and the report (${theme})`, async () => {
      recorded = await open(theme);
      const { page } = recorded;
      await resize(BOARD_HEIGHT);
      await goTo(page, `/runs/${summary.runId}/train`);
      await expect(
        page.getByRole('region', { name: 'Examples' }).getByRole('listitem'),
      ).toHaveCount(lessonCount(summary));
      await shoot(`evidence-train-${theme}.png`);

      // Each way a round can end, its drawer whole.
      await resize(DRAWER_HEIGHT);
      for (const disposition of ['kept', 'reverted', 'rejected', 'invalid', 'stopped'] as const) {
        await openRound(roundWith(summary, disposition));
        await shoot(`evidence-round-${disposition}-${theme}.png`);
        await closeDrawer();
      }

      // Round 1's verified repair, played from its checkpoint, then the attempt it repaired,
      // opened at the step the finding points to.
      const kept = await openRound(roundWith(summary, 'kept'));
      await kept
        .getByRole('region', { name: 'Examples' })
        .getByRole('button')
        .filter({ hasText: 'Replayed from step' })
        .first()
        .click();
      const lesson = page.getByRole('dialog');
      await expect(lesson.getByRole('list', { name: "Spark's correction" })).toBeVisible();
      await shoot(`evidence-lesson-${theme}.png`);
      // In a window of the usual size: the correction itself, from where Spark took over.
      await resize(SIZE.height);
      await lesson
        .locator('.overflow-y-auto')
        .first()
        .evaluate((body) => {
          const step = body.querySelector('[aria-current="step"]');
          if (!step) throw new Error('No current step');
          body.scrollTop +=
            step.getBoundingClientRect().top - body.getBoundingClientRect().top - 240;
        });
      await shoot(`evidence-lesson-steps-${theme}.png`);
      await resize(DRAWER_HEIGHT);
      await lesson
        .getByRole('button', {
          name: `Open Glimmer's attempt at step ${summary.repair.failureTurn}`,
        })
        .click();
      await expect(page.getByRole('dialog')).toContainText('Spark suspects this step');
      await shoot(`evidence-attempt-${theme}.png`);
      await closeDrawer();

      // Round 2's repair had to start over: a full-task demonstration, labelled as one.
      const rejected = await openRound(roundWith(summary, 'rejected'));
      await rejected
        .getByRole('region', { name: 'Examples' })
        .getByRole('button')
        .filter({ hasText: 'Full-task demonstration' })
        .click();
      await expect(page.getByRole('dialog')).toContainText('Spark does the whole task');
      await shoot(`evidence-lesson-full-task-${theme}.png`);
      await closeDrawer();

      await resize(REPORT_HEIGHT);
      await goTo(page, `/runs/${summary.runId}/report`);
      await expect(page.getByRole('table', { name: 'Capabilities by task type' })).toBeVisible();
      await expect(page.getByRole('table', { name: 'Comparisons' })).toBeVisible();
      // The agent's install checks and its model's facts arrive with the agent, a moment later.
      await expect(page.getByText('Install checks on this computer')).toBeVisible();
      await shoot(`evidence-report-${theme}.png`);

      // An example whose steps can't be read says so, with a way to try again.
      await stubEngineFailure(recorded.app, {
        'mentoring:lessonTrace': "The engine stopped, so the correction's steps couldn't be read.",
      });
      await resize(SIZE.height);
      await goTo(page, `/runs/${summary.runId}/train`);
      const reverted = await openRound(roundWith(summary, 'reverted'));
      await reverted.getByRole('region', { name: 'Examples' }).getByRole('button').first().click();
      await expect(page.getByRole('dialog')).toContainText("Couldn't load the steps");
      await shoot(`evidence-lesson-error-${theme}.png`);
      await closeDrawer();
    });

    test(`captures the evidence screens when their records fail to load (${theme})`, async () => {
      recorded = await open(theme);
      const { app, page } = recorded;
      await stubEngineFailure(app, {
        'mentoring:lessons': "The engine stopped, so the run's records couldn't be read.",
        'mentoring:capabilities': "The engine stopped, so the capabilities couldn't be read.",
      });
      await resize(BOARD_HEIGHT);
      await goTo(page, `/runs/${summary.runId}/train`);
      await expect(page.getByText("Couldn't load the examples")).toBeVisible();
      await expect(page.getByText("Couldn't load how the rounds ended")).toBeVisible();
      await shoot(`evidence-train-error-${theme}.png`);
      // A round opened while the records still load, and then the load fails.
      await app.evaluate(({ ipcMain }, message) => {
        ipcMain.removeHandler('mentoring:lessons');
        ipcMain.handle(
          'mentoring:lessons',
          () =>
            new Promise((resolve) => {
              setTimeout(() => resolve({ ok: false, error: { message } }), 3_000);
            }),
        );
      }, "The engine stopped, so the run's records couldn't be read.");
      await resize(DRAWER_HEIGHT);
      await page.reload();
      const opened = await openRound(roundWith(summary, 'kept'));
      await expect(opened).toContainText("Couldn't load the rest of this round");
      await shoot(`evidence-round-error-${theme}.png`);
      await closeDrawer();

      await stubEngineFailure(app, {
        'mentoring:experiments': "The engine stopped, so the experiments couldn't be read.",
      });
      await resize(SHORT_REPORT_HEIGHT);
      await goTo(page, `/runs/${summary.runId}/report`);
      // Each section says what it couldn't read; the rest of the card stands.
      await expect(page.getByText("Couldn't load the capabilities")).toBeVisible();
      await expect(page.getByText("Couldn't load the comparisons")).toBeVisible();
      await shoot(`evidence-report-error-${theme}.png`);
    });

    test(`captures a comparison's own report on one of its arms (${theme})`, async () => {
      const report = await recordedComparisonReport();
      const targeted = report.arms.find((arm) => arm.arm === 'targeted');
      if (!targeted?.runId) throw new Error('The recorded comparison has no targeted run.');
      recorded = await open(theme, { comparison: recordedComparison() });
      await resize(COMPARISON_REPORT_HEIGHT);
      await goTo(recorded.page, `/runs/${targeted.runId}/report`);
      await expect(recorded.page.getByRole('table', { name: 'Comparisons' })).toBeVisible();
      await expect(recorded.page.getByText('Install checks on this computer')).toBeVisible();
      await shoot(`evidence-report-comparison-${theme}.png`);
    });
  }
});
