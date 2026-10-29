import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type {
  CapabilityBreakdown,
  GraduateSummary,
  ReportCard,
  Retest,
  RunDetail,
  RunEvent,
} from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine, stubEngineFailure } from './fixtures';
import { emitRunEvents, FLOW_ENGINE } from './fixtures-flow';
import { AGENT, CHATS, engineSeed, installFakeEngine } from './fixtures-workspace';
import {
  at,
  detail,
  FINAL_TEST,
  makeRun,
  reports,
  STORY,
  storyCapabilities,
  storyReport,
} from './story';

/*
 * An agent whose final test ran on the online copy: marked as tested online, tested on this
 * computer when asked, and ready only once it passes there. The Results page and the agent's own
 * Results tab read the same records.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp();
  page = launched.page;
  await mkdir(OUT_DIR, { recursive: true });
  await resize(1700);
});

test.afterAll(async () => {
  await launched?.close();
});

async function resize(height: number): Promise<void> {
  const visible = await launched.app.evaluate(
    ({ BrowserWindow }, size) => {
      const [main] = BrowserWindow.getAllWindows();
      if (!main) throw new Error('No window');
      main.setContentSize(size.width, size.height);
      return main.isVisible();
    },
    { width: 1440, height },
  );
  expect(visible).toBe(false);
  await page.waitForFunction((h) => window.innerHeight === h, height);
}

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

/** The run's final test on the online copy, as its card records it. */
const ONLINE: ReportCard = {
  ...storyReport,
  testedOn: 'hosted',
  student: { label: 'Glimmer', model: 'meta/muse-glimmer-30b', runtime: 'openai_compatible' },
  test: {
    ...storyReport.test,
    score: { pass: 54, total: 60 },
    perType: FINAL_TEST.map((type) => (type.type === 'scheduling' ? { ...type, pass: 15 } : type)),
    latencyMs: { p50: 3_500, p95: 9_000 },
    ranOffline: false,
  },
  requirements: { passRate: { target: 0.9, actual: 54 / 60, met: true } },
};

/** The same agent's final test taken on this computer. */
function onThisComputer(pass: number): ReportCard {
  return {
    ...storyReport,
    test: {
      ...storyReport.test,
      score: { pass, total: 60 },
      latencyMs: { p50: 94_000, p95: 188_000 },
    },
    requirements: { passRate: { target: 0.9, actual: pass / 60, met: pass / 60 >= 0.9 } },
  };
}

const FINISHED_RUN = makeRun({
  status: 'finished',
  phase: 'done',
  endedAt: at(352),
  updatedAt: at(352),
  graduateId: STORY.graduateId,
});

const withRetests = (retests?: Retest[]): RunDetail => ({
  ...detail,
  run: FINISHED_RUN,
  ...(retests === undefined ? {} : { retests }),
});

const TESTING: Retest = { target: 'local', status: 'testing', startedAt: at(360) };

interface World {
  detail: RunDetail;
  own: ReportCard;
  local: ReportCard | null;
  /** The cards of the runs trained beside it, by run. */
  peers: Record<string, ReportCard>;
  calls: unknown[][];
}

/** The by-type table of the story's capabilities, from the card that took its final test. */
function capabilitiesOf(card: ReportCard): CapabilityBreakdown {
  return {
    ...storyCapabilities,
    capabilities: storyCapabilities.capabilities.map((capability) => {
      const result = card.test.perType.find((type) => type.type === capability.type);
      return result
        ? { ...capability, finalTest: { pass: result.pass, total: result.total } }
        : capability;
    }),
  };
}

/**
 * The engine as a re-test sees it: the run's detail and cards live in the app's main process, so
 * asking for the test changes what the next read says, as the engine's own record would.
 */
async function installEngine(world: Pick<World, 'detail' | 'own' | 'local'>): Promise<void> {
  const { [STORY.runId]: _own, ...peers } = reports;
  await stubEngine(launched.app, {
    ...FLOW_ENGINE,
    'mentoring:capabilities': capabilitiesOf(world.own),
  });
  // Sent as JSON: Playwright's argument types can't follow the report and run detail's schemas.
  await launched.app.evaluate(
    ({ ipcMain }, json: string) => {
      type Held = {
        detail: { retests?: unknown[] };
        own: unknown;
        local: unknown;
        peers: Record<string, unknown>;
        calls: unknown[][];
      };
      const store = globalThis as typeof globalThis & { retestWorld?: Held };
      store.retestWorld = JSON.parse(json) as Held;
      const handle = (channel: string, answer: (...args: unknown[]) => unknown) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (_event, ...args: unknown[]) => {
          try {
            return { ok: true, value: answer(...args) };
          } catch (error) {
            return { ok: false, error: { message: (error as Error).message } };
          }
        });
      };
      const current = () => {
        if (!store.retestWorld) throw new Error('No world.');
        return store.retestWorld;
      };
      handle('runs:get', () => current().detail);
      handle('reports:get', (runId, target) => {
        if (typeof runId === 'string' && runId in current().peers) return current().peers[runId];
        if (target !== 'local') return current().own;
        const local = current().local;
        if (!local) throw new Error("This run's graduate hasn't been tested on the local student.");
        return local;
      });
      handle('runs:retest', (runId, target) => {
        const world = current();
        world.calls.push([runId, target]);
        world.detail = {
          ...world.detail,
          retests: [{ target: 'local', status: 'testing', startedAt: '2026-10-27T18:00:00.000Z' }],
        };
      });
    },
    JSON.stringify({ ...world, peers, calls: [] }),
  );
}

/** Changes what the engine answers from now on, and what it was asked so far. */
async function change(patch: Partial<Pick<World, 'detail' | 'local'>>): Promise<void> {
  await launched.app.evaluate((_electron, json: string) => {
    const store = globalThis as typeof globalThis & { retestWorld?: Record<string, unknown> };
    Object.assign(store.retestWorld ?? {}, JSON.parse(json));
  }, JSON.stringify(patch));
}

function asked(): Promise<unknown[][]> {
  return launched.app.evaluate(
    () =>
      (globalThis as typeof globalThis & { retestWorld?: { calls: unknown[][] } }).retestWorld
        ?.calls ?? [],
  );
}

async function openResults(theme: Theme): Promise<void> {
  await updateSettings(page, { theme, onboarded: true, comparisonMode: false });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await goTo(page, `/runs/${STORY.runId}/report`);
}

const progress = (done: number): RunEvent => ({
  runId: STORY.runId,
  at: at(380),
  type: 'eval.progress',
  split: 'test',
  harnessVersion: STORY.version,
  done,
  total: 60,
  pass: done - 1,
});

const testFinished: RunEvent = {
  runId: STORY.runId,
  at: at(520),
  type: 'eval.finished',
  split: 'test',
  harnessVersion: STORY.version,
  score: { pass: 55, total: 60 },
  perType: [],
};

for (const theme of THEMES) {
  test(`marks an agent tested online, tests it on this computer, and is ready once it passes (${theme})`, async () => {
    await installEngine({ detail: withRetests(), own: ONLINE, local: null });
    await openResults(theme);

    // Passed online is not ready: the badge says it passed there, and nothing says it graduated.
    await expect(page.getByText('Passed online', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Service desk finished training' }),
    ).toBeVisible();
    await expect(
      page.getByText('Its final test ran on an online copy of Glimmer, not on this computer.'),
    ).toBeVisible();
    await expect(
      page.getByText('It is marked ready once it passes on this computer too.'),
    ).toBeVisible();
    await expect(page.getByText('Ready', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/graduated/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start using Service desk' })).toBeEnabled();

    // The offer says how long it takes and that it uses the graphics card, and sits right under
    // the badge, before any figure.
    const offer = page.getByRole('region', { name: 'Test on this computer' });
    await expect(offer).toContainText(
      'It takes about 2.5 hours for 60 tasks and uses the graphics card.',
    );
    const offerTop = (await offer.boundingBox())?.y ?? Number.POSITIVE_INFINITY;
    const figuresTop = (await page.getByText('of new tasks right').boundingBox())?.y ?? 0;
    expect(offerTop).toBeLessThan(figuresTop);
    await capture(`report-online-${theme}.png`);

    await offer.getByRole('button', { name: 'Test on this computer' }).click();
    expect(await asked()).toEqual([[STORY.runId, 'local']]);
    await expect(offer).toContainText('Testing on this computer');
    await expect(offer).toContainText('Waiting for the first answer.');
    await emitRunEvents(launched.app, [progress(12)]);
    await expect(offer).toContainText('12 of 60 tasks scored. You can leave this page.');
    await expect(offer.getByRole('button')).toHaveCount(0);
    await capture(`report-online-testing-${theme}.png`);

    // Its card is filed: the result shows, and the agent is ready, on a pass on this computer.
    await change({
      detail: withRetests([{ ...TESTING, status: 'finished', endedAt: at(520) }]),
      local: onThisComputer(55),
    });
    await emitRunEvents(launched.app, [testFinished]);
    await expect(offer).toContainText('Passed on this computer');
    await expect(offer).toContainText('55 of 60 right (92%). Typical answer 1 min 34 s');
    await expect(offer).toContainText('Online it got 54 of 60.');
    await expect(page.getByRole('heading', { name: 'Service desk graduated' })).toBeVisible();
    await expect(page.getByText('Ready', { exact: true })).toBeVisible();
    await expect(page.getByText('It passed on this computer too: 55 of 60')).toBeVisible();
    await expect(
      page.getByText(
        'on an online copy of Glimmer, and again on this computer, with Spark disconnected.',
      ),
    ).toBeVisible();
    await capture(`report-online-done-${theme}.png`);
  });
}

/** A drafted job's smaller final test, taken on the online copy: 28 of 30. */
const ONLINE_SMALL: ReportCard = {
  ...ONLINE,
  test: {
    ...ONLINE.test,
    score: { pass: 28, total: 30 },
    perType: [
      { type: 'invoice', label: 'Invoices', pass: 10, total: 10, refused: false },
      { type: 'overdue', label: 'Overdue balances', pass: 10, total: 10, refused: false },
      { type: 'scheduling', label: 'Scheduling', pass: 8, total: 10, refused: false },
    ],
  },
  requirements: { passRate: { target: 0.9, actual: 28 / 30, met: true } },
};

test('says a small final test passed online the same way, 28 of 30, with the offer beside it', async () => {
  await installEngine({ detail: withRetests(), own: ONLINE_SMALL, local: null });
  await openResults('dark');

  await expect(page.getByText('Passed online', { exact: true })).toBeVisible();
  await expect(page.getByText('It got 28 of 30.')).toBeVisible();
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/graduated/i)).toHaveCount(0);
  const offer = page.getByRole('region', { name: 'Test on this computer' });
  await expect(offer).toContainText(
    'It takes about 1 hour for 30 tasks and uses the graphics card.',
  );
  await expect(offer.getByRole('button', { name: 'Test on this computer' })).toBeVisible();
});

test('says it fell short on this computer when it passed online', async () => {
  await installEngine({
    detail: withRetests([{ ...TESTING, status: 'finished', endedAt: at(520) }]),
    own: ONLINE,
    local: onThisComputer(40),
  });
  await openResults('dark');

  const offer = page.getByRole('region', { name: 'Test on this computer' });
  await expect(offer).toContainText('Below the target on this computer');
  await expect(offer).toContainText('40 of 60 right (67%)');
  await expect(page.getByText('Not ready', { exact: true })).toBeVisible();
  await expect(page.getByText("It missed the job's target on this computer:")).toBeVisible();
  await expect(page.getByText('It scored 54 of 60 on its final test, run online.')).toBeVisible();
  await expect(page.getByText('You can still use it.')).toBeVisible();
});

test('says why the test on this computer stopped, and goes on when asked again', async () => {
  await installEngine({
    detail: withRetests([
      {
        ...TESTING,
        status: 'paused',
        error: "Ollama isn't running at http://127.0.0.1:11434. Open it, then ask again.",
      },
    ]),
    own: ONLINE,
    local: null,
  });
  await openResults('dark');

  const offer = page.getByRole('region', { name: 'Test on this computer' });
  await expect(offer).toContainText('The test on this computer stopped');
  await expect(offer).toContainText("Ollama isn't running at http://127.0.0.1:11434.");
  await offer.getByRole('button', { name: 'Try again' }).click();
  expect(await asked()).toEqual([[STORY.runId, 'local']]);
  await expect(offer).toContainText('Testing on this computer');
  await expect(offer.getByRole('button')).toHaveCount(0);
});

test('offers no test on this computer for an agent that was tested here', async () => {
  await installEngine({ detail: withRetests(), own: onThisComputer(55), local: null });
  await openResults('dark');
  await expect(page.getByRole('heading', { name: 'Service desk graduated' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Test on this computer' })).toHaveCount(0);
});

/** The agent as the workspace lists it, its own final test having run on the online copy. */
const HOSTED_AGENT: GraduateSummary = {
  ...AGENT,
  manifest: {
    ...AGENT.manifest,
    requirements: { passRate: { target: 0.9, actual: 54 / 60, met: true } },
    test: { score: { pass: 54, total: 60 }, perType: ONLINE.test.perType, testedOn: 'hosted' },
  },
};

/** The agent's settings on a fake engine: with its run's records here when `run` is given. */
async function openAgentSettings(theme: Theme, run?: RunDetail) {
  await installFakeEngine(launched.app, engineSeed({ report: ONLINE, graduates: [HOSTED_AGENT] }));
  if (run) {
    await stubEngine(launched.app, { 'runs:get': run });
  } else {
    // The engine's own answer for a run it has no records of.
    await stubEngineFailure(launched.app, {
      'runs:get': { message: `There is no run "${STORY.runId}".`, code: 'run_not_found' },
    });
  }
  await updateSettings(page, { theme, onboarded: true });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, `/agents/${AGENT.id}/chats/${CHATS.closeout.id}`);
  await page.getByRole('button', { name: 'Service desk settings' }).click();
  return page.getByRole('dialog', { name: 'Service desk', exact: true });
}

for (const theme of THEMES) {
  test(`offers the test on this computer in the agent's own Results (${theme})`, async () => {
    await resize(900);
    // The agent's run is here, so its records can take the test again.
    const dialog = await openAgentSettings(theme, withRetests());
    // Its Final test row says where the test ran.
    await expect(dialog.getByText('Passed online: 54 of 60 (90%)')).toBeVisible();
    await expect(dialog.getByText('Tasks it had never seen, on the online copy')).toBeVisible();
    await dialog.getByRole('tab', { name: 'Results' }).click();
    await expect(dialog.getByText('Typical answer, on the online copy')).toBeVisible();
    const offer = dialog.getByRole('region', { name: 'Test on this computer' });
    await expect(offer).toContainText('uses the graphics card');
    await expect(offer.getByRole('button', { name: 'Test on this computer' })).toBeVisible();
    await capture(`workspace-agent-report-online-${theme}.png`);
  });
}

test("offers no test for an agent whose records aren't on this computer", async () => {
  await resize(900);
  // No run stands behind this agent here, as the engine says: nothing to test again on.
  const dialog = await openAgentSettings('dark');
  await dialog.getByRole('tab', { name: 'Results' }).click();
  await expect(dialog.getByText('Handles')).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Test on this computer' })).toHaveCount(0);
});
