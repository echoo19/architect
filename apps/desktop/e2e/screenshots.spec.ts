import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { glimmerBuild } from '@architect/shared';
import {
  EMPTY_ENGINE,
  ENGINE_RESTARTING,
  OLLAMA_READY,
  SAMPLE,
  SAMPLE_ENGINE,
  stubEngine,
  stubEngineFailure,
} from './fixtures';
import { FLOW_LOCAL } from './fixtures-flow';
import { installation } from './fixtures-versions';
import {
  asRealComparison,
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

/** Every route, with ids the engine doesn't know, so each shows its real empty or error state. */
const ROUTES = [
  { name: 'workspace', path: '/' },
  { name: 'chat', path: '/agents/grd_example/chats/cht_example' },
  { name: 'describe', path: '/new' },
  { name: 'define', path: '/jobs/job_example/define' },
  { name: 'train', path: '/runs/run_example/train' },
  { name: 'report', path: '/runs/run_example/report' },
  { name: 'improvement', path: '/runs/run_example/improvement' },
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

/** The renderer keeps what it has read, so a change made behind its back needs a reload. */
async function reload(page: Page) {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function applySettings(page: Page, patch: Parameters<typeof updateSettings>[1]) {
  await updateSettings(page, patch);
  await reload(page);
}

test('captures every screen', async () => {
  const page = launched.page;
  await stubEngine(launched.app, { ...EMPTY_ENGINE, 'connections:detectLocal': OLLAMA_READY });
  await applySettings(page, { onboarded: false });
  expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([
    SIZE.width,
    SIZE.height,
  ]);

  await goTo(page, '/welcome');
  await expect(page.getByRole('heading', { name: 'Welcome to Architect' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /Architect Lab/ })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('radio', { name: /Recommended/ })).toBeVisible();
  await capture(page, 'welcome-dark.png');

  await applySettings(page, { onboarded: true });
  for (const route of ROUTES) {
    await goTo(page, route.path);
    await capture(page, `${route.name}-dark.png`);
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
  await capture(page, 'settings-general-dark.png');
  await page.getByRole('tab', { name: 'Models' }).click();
  // The teacher, the agent's model and who it is connected to come first; the runtimes on this
  // computer and the Hugging Face token wait under Advanced.
  await expect(page.getByRole('button', { name: 'Teacher', exact: true })).toBeVisible();
  await expect(page.getByText('Running · 0.12.6 · 1 model')).toBeHidden();
  await capture(page, 'settings-models-dark.png');
  await page.getByRole('button', { name: 'Advanced' }).click();
  await expect(page.getByText('Running · 0.12.6 · 1 model')).toBeVisible();
  // What opened is at the end of the tab, so it is scrolled into the picture.
  await page
    .getByRole('tabpanel', { name: 'Models' })
    .evaluate((panel) => panel.scrollTo({ top: panel.scrollHeight }));
  await capture(page, 'settings-models-advanced-dark.png');
  await page.keyboard.press('Escape');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await capture(page, 'palette-dark.png');
  await page.keyboard.press('Escape');
  await updateSettings(page, { defaultStudent });
});

test('captures the empty workspace and a failed action', async () => {
  const page = launched.page;
  await stubEngine(launched.app, EMPTY_ENGINE);
  // The engine couldn't start, as the main process says it: its message, and the code a screen words.
  await stubEngineFailure(launched.app, {
    'jobs:createSample': {
      message:
        "The engine couldn't start: The database is locked. Architect keeps trying in the background.",
      code: 'process_failed',
    },
  });
  await reload(page);
  await goTo(page, '/');
  await expect(page.getByRole('heading', { name: 'No agents yet' })).toBeVisible();
  await capture(page, 'workspace-empty-dark.png');

  // With creating the sample job made to fail, the app says why in a toast.
  await page.getByRole('button', { name: 'Try the sample job' }).click();
  // Exact, so the toast's screen-reader announcement doesn't also match.
  await expect(page.getByText("Couldn't create the sample job", { exact: true })).toBeVisible();
  await capture(page, 'toast-dark.png');
  await page.getByRole('button', { name: 'Dismiss' }).click();
});

test('captures the populated screens with sample engine replies', async () => {
  const page = launched.page;
  // The story's job is ready to start: its teacher's key is saved and its model is downloaded.
  await stubEngine(launched.app, {
    ...SAMPLE_ENGINE,
    'secrets:status': { meta: true, openrouter: true },
    'connections:detectLocal': FLOW_LOCAL,
  });
  await reload(page);
  for (const route of SAMPLE_ROUTES) {
    await goTo(page, route.path);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await capture(page, `${route.name}-dark.png`);
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
  /** A comparison arm's report, with its comparisons table and the rest closed. */
  const COMPARISON_REPORT_HEIGHT = 1800;

  let recorded: LaunchedApp;
  let summary: RecordedSummary;

  async function open(
    from: { data: string } | { comparison: string } = { data: recordedData() },
  ): Promise<LaunchedApp> {
    const app = await launchApp({
      ...from,
      settings: { onboarded: true },
      ...('comparison' in from ? { prepare: asRealComparison } : {}),
    });
    return app;
  }

  async function resize(height: number, width: number = SIZE.width): Promise<void> {
    await recorded.app.evaluate(
      ({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height);
      },
      { width, height },
    );
    await recorded.page.waitForFunction((w) => window.innerWidth === w, width);
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

  test('captures lessons, experiments, playback and the report', async () => {
    recorded = await open();
    const { page } = recorded;
    await resize(BOARD_HEIGHT);
    await goTo(page, `/runs/${summary.runId}/train`);
    await expect(
      page.getByRole('region', { name: 'Worked examples' }).getByRole('listitem'),
    ).toHaveCount(lessonCount(summary));
    await shoot('evidence-train-dark.png');

    // Each way a round can end, its drawer whole.
    await resize(DRAWER_HEIGHT);
    for (const disposition of ['kept', 'reverted', 'rejected', 'invalid', 'stopped'] as const) {
      await openRound(roundWith(summary, disposition));
      await shoot(`evidence-round-${disposition}-dark.png`);
      await closeDrawer();
    }

    // Round 1's verified repair, played from its checkpoint, then the attempt it repaired,
    // opened at the step the finding points to.
    const kept = await openRound(roundWith(summary, 'kept'));
    await kept
      .getByRole('region', { name: 'Worked examples' })
      .getByRole('button')
      .filter({ hasText: 'Replayed from step' })
      .first()
      .click();
    const lesson = page.getByRole('dialog');
    await expect(lesson.getByRole('list', { name: "Spark's correction" })).toBeVisible();
    await shoot('evidence-lesson-dark.png');
    // In a window of the usual size: the correction itself, from where Spark took over.
    await resize(SIZE.height);
    await lesson
      .locator('.overflow-y-auto')
      .first()
      .evaluate((body) => {
        const step = body.querySelector('[aria-current="step"]');
        if (!step) throw new Error('No current step');
        body.scrollTop += step.getBoundingClientRect().top - body.getBoundingClientRect().top - 240;
      });
    await shoot('evidence-lesson-steps-dark.png');
    await resize(DRAWER_HEIGHT);
    await lesson
      .getByRole('button', {
        name: `Open Glimmer's attempt at step ${summary.repair.failureTurn}`,
      })
      .click();
    await expect(page.getByRole('dialog')).toContainText('Spark suspects this step');
    await shoot('evidence-attempt-dark.png');
    await closeDrawer();

    // Round 2's repair had to start over: a full-task demonstration, labelled as one.
    const rejected = await openRound(roundWith(summary, 'rejected'));
    await rejected
      .getByRole('region', { name: 'Worked examples' })
      .getByRole('button')
      .filter({ hasText: 'Full-task demonstration' })
      .click();
    await expect(page.getByRole('dialog')).toContainText('Spark does the whole task');
    await shoot('evidence-lesson-full-task-dark.png');
    await closeDrawer();

    await resize(REPORT_HEIGHT);
    await goTo(page, `/runs/${summary.runId}/report`);
    await expect(page.getByRole('table', { name: 'Results by task type' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Comparisons' })).toBeVisible();
    // The agent's install checks and its model's facts arrive with the agent, a moment later.
    await expect(page.getByText('Works on this computer')).toBeVisible();
    await shoot('evidence-report-dark.png');

    // An example whose steps can't be read says so, with a way to try again.
    await stubEngineFailure(recorded.app, {
      'mentoring:lessonTrace': ENGINE_RESTARTING,
    });
    await resize(SIZE.height);
    await goTo(page, `/runs/${summary.runId}/train`);
    const reverted = await openRound(roundWith(summary, 'reverted'));
    await reverted
      .getByRole('region', { name: 'Worked examples' })
      .getByRole('button')
      .first()
      .click();
    await expect(page.getByRole('dialog')).toContainText("Couldn't load the steps");
    await shoot('evidence-lesson-error-dark.png');
    await closeDrawer();
  });

  test('captures the evidence screens when their records fail to load', async () => {
    recorded = await open();
    const { app, page } = recorded;
    await stubEngineFailure(app, {
      'mentoring:lessons': ENGINE_RESTARTING,
      'mentoring:capabilities': ENGINE_RESTARTING,
    });
    await resize(BOARD_HEIGHT);
    await goTo(page, `/runs/${summary.runId}/train`);
    await expect(page.getByText("Couldn't load the worked examples")).toBeVisible();
    await expect(page.getByText("Couldn't load how the rounds ended")).toBeVisible();
    await shoot('evidence-train-error-dark.png');
    // A round opened while the records still load, and then the load fails.
    await app.evaluate(({ ipcMain }, error) => {
      ipcMain.removeHandler('mentoring:lessons');
      ipcMain.handle(
        'mentoring:lessons',
        () =>
          new Promise((resolve) => {
            setTimeout(() => resolve({ ok: false, error }), 3_000);
          }),
      );
    }, ENGINE_RESTARTING);
    await resize(DRAWER_HEIGHT);
    await page.reload();
    const opened = await openRound(roundWith(summary, 'kept'));
    await expect(opened).toContainText(
      "Couldn't load this round's findings, examples, check tasks and costs",
    );
    await shoot('evidence-round-error-dark.png');
    await closeDrawer();

    await stubEngineFailure(app, {
      'mentoring:experiments': ENGINE_RESTARTING,
    });
    await resize(SHORT_REPORT_HEIGHT);
    await goTo(page, `/runs/${summary.runId}/report`);
    // Each section says what it couldn't read; the rest of the card stands.
    await expect(page.getByText("Couldn't load the results by task type")).toBeVisible();
    await expect(page.getByText("Couldn't load the comparisons")).toBeVisible();
    await shoot('evidence-report-error-dark.png');
  });

  test("captures a comparison's own report on one of its arms", async () => {
    const report = await recordedComparisonReport();
    const targeted = report.arms.find((arm) => arm.arm === 'targeted');
    if (!targeted?.runId) throw new Error('The recorded comparison has no targeted run.');
    recorded = await open({ comparison: recordedComparison() });
    const { page, app } = recorded;
    await resize(COMPARISON_REPORT_HEIGHT);
    await goTo(page, `/runs/${targeted.runId}/report`);
    await expect(page.getByRole('table', { name: 'Comparisons' })).toBeVisible();
    await expect(page.getByText('Works on this computer')).toBeVisible();
    // The agent the dry run made was checked here by the real engine, and its fake setup does
    // not load: the one verdict says it can't run, and offers the way to put it right.
    await expect(
      page.getByRole('heading', { name: "Returns desk can't run on this computer" }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: "See what's wrong" })).toBeVisible();
    await expect(page.getByText('graduated')).toHaveCount(0);
    await shoot('evidence-report-blocked-dark.png');

    // The same agent where its checks pass: what a finished run reads like.
    const [agent] = (await page.evaluate(() => window.architect.graduates.list())).filter(
      (item) => item.manifest.runId === targeted.runId,
    );
    if (!agent) throw new Error('The recorded comparison made no agent for its targeted run.');
    await stubEngine(app, { 'graduates:installation': installation(agent.id) });
    await page.reload();
    await goTo(page, `/runs/${targeted.runId}/report`);
    await expect(page.getByRole('heading', { name: 'Returns desk graduated' })).toBeVisible();
    await expect(page.getByText('Dry run on fakes')).toHaveCount(0);
    await shoot('evidence-report-comparison-dark.png');

    // The narrowest window the app allows: the table fits, with nothing cut off at the right.
    await resize(COMPARISON_REPORT_HEIGHT, 960);
    const table = page.getByRole('table', { name: 'Comparisons' });
    const box = await table.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(960);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await shoot('evidence-report-narrow-dark.png');
  });
});
