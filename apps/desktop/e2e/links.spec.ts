import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { Certification, ExperimentInput, Qualification } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { ACADEMY_DESK_CERTIFICATE } from './fixtures-certify';
import { finishExperiments, installExperimentsFake } from './fixtures-experiments';
import { FIELD_CHAT, FIELD_REPORT } from './fixtures-field';
import { ACADEMY_DESK_ASSETS, ACADEMY_DESK_FIELD, stubFields } from './fixtures-fields';
import { recordedCalls, stubByKey, stubRecorded } from './fixtures-flow';
import { ACADEMY_DESK_ID, LAB, LAB_EXPERIMENTS } from './fixtures-lab';
import { installModelsFake, MODEL_VERSIONS } from './fixtures-models';
import { recordedComparisonReport } from './recorded';
import { at } from './story';

/*
 * The Lab's places lead to each other (docs/COHESION.md): results to their field and their
 * version in Models, a model's panel to its chat, its results and every qualification of it, the
 * Lab to its experiments, an experiment's arms to their runs, a field's export to Compute, a
 * field's versions to Models, and each page back to the place it belongs to. The personal
 * edition shows none of these links.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const CONFIGS = fileURLToPath(
  new URL('../../../packages/engine/test/fixtures/model-configs/', import.meta.url),
);
const SIZE = { width: 1440, height: 900 };
const VERSION_KEY = `${ACADEMY_DESK_ID}:2`;

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;
let folders: string;

test.beforeAll(async () => {
  folders = await mkdtemp(join(tmpdir(), 'architect-e2e-links-'));
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
  await stubLinks();
});

test.afterAll(async () => {
  await launched?.close();
  await rm(folders, { recursive: true, force: true });
});

/** Academy desk's active version 2 made by the Lab's finished run, and qualified three ways. */
async function stubLinks(): Promise<void> {
  await installModelsFake(launched.app);
  await stubFields(launched.app);
  await stubByKey(launched.app, 'graduates:versions', {
    ...MODEL_VERSIONS,
    [ACADEMY_DESK_ID]: (MODEL_VERSIONS[ACADEMY_DESK_ID] ?? []).map((version) =>
      version.version === 2 ? { ...version, runId: LAB.academyDeskRun } : version,
    ),
  });
  const certification: Certification = {
    id: 'crt_1',
    graduateId: ACADEMY_DESK_ID,
    version: 2,
    runId: LAB.academyDeskRun,
    request: {
      graduateId: ACADEMY_DESK_ID,
      version: 2,
      jobId: LAB.academyDeskJob,
      k: 5,
      epsilon: 0.1,
      delta: 0.05,
      size: 77,
      check: [],
      maxUsd: 0,
      maxMinutes: 600,
    },
    plan: {
      jobName: 'Academy desk',
      target: 'local',
      student: 'muse-glimmer:30b',
      calibration: 77,
      checks: [],
      attempts: 385,
      usd: 0,
      seconds: 385 * 150,
    },
    inputs: {
      sealedSha256: 'a'.repeat(64),
      calibrationSha256: 'b'.repeat(64),
      checksSha256: {},
      harnessHash: 'c'.repeat(64),
      adapterSha256: null,
      seeds: [1, 2, 3, 4, 5],
    },
    status: 'finished',
    done: 385,
    spentUsd: 0,
    certificate: ACADEMY_DESK_CERTIFICATE,
    createdAt: at(3_000),
    endedAt: at(3_400),
  };
  await stubByKey(launched.app, 'graduates:certifications', { [ACADEMY_DESK_ID]: [certification] });
  await stubByKey(launched.app, 'jobs:field', {
    [LAB.academyDeskJob]: {
      ...ACADEMY_DESK_FIELD,
      qualifications: [
        {
          runId: LAB.academyDeskRun,
          org: 'Maple Grove Academy',
          status: 'finished',
          startedAt: at(3_500),
          endedAt: at(3_560),
          score: { pass: 25, total: 30 },
        },
      ],
    },
  });
  const trained: Qualification = {
    id: 'qlf_1',
    runId: LAB.academyDeskRun,
    jobId: LAB.academyDeskJob,
    harnessVersion: 9,
    model: 'academy-desk-sft-8b',
    baseUrl: 'http://127.0.0.1:8080/v1',
    status: 'finished',
    card: FIELD_REPORT,
    startedAt: at(3_600),
    endedAt: at(3_700),
  };
  await stubByKey(launched.app, 'runs:qualifications', { [LAB.academyDeskJob]: [trained] });
}

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

async function openAt(path: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

/** The next file dialog chooses this path. */
function picks(path: string): Promise<void> {
  return launched.app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] });
  }, path);
}

const region = (name: string) => page.getByRole('region', { name, exact: true });
const panel = () => page.getByRole('complementary', { name: 'Model' });
const button = (name: string) => page.getByRole('button', { name, exact: true });
const report = `/runs/${LAB.academyDeskRun}/report`;
const field = new RegExp(`#/fields/${LAB.academyDeskJob}$`);
const modelsAt = new RegExp(`#/models/${ACADEMY_DESK_ID}(:|%3A)2$`);

/** Models with Academy desk's version 2 open in its panel. */
async function expectVersionOpen(): Promise<void> {
  await expect(page).toHaveURL(modelsAt);
  await expect(panel().getByRole('heading', { name: /Academy desk\s*version 2/ })).toBeVisible();
}

test('results lead to their field and their version, and close back to the field', async () => {
  await openAt(report);
  await expect(button('Open in Models')).toBeVisible();
  await capture('links-results-dark.png');
  await button('Open in Models').click();
  await expectVersionOpen();

  await goTo(page, report);
  await button('Open field').click();
  await expect(page).toHaveURL(field);

  await goTo(page, report);
  await button('Close').click();
  await expect(page).toHaveURL(field);
});

test('training closes back to its field', async () => {
  await openAt('/runs/run_desk/train');
  await expect(page.getByRole('banner')).toContainText('Service desk');
  await button('Close').click();
  await expect(page).toHaveURL(/#\/fields\/job_desk$/);
});

test("a model's panel opens its chat and results and shows every qualification", async () => {
  await openAt(`/models/${VERSION_KEY}`);
  await expectVersionOpen();
  const qualified = panel().getByRole('region', { name: 'Qualified' });
  await expect(qualified).toContainText('Certified');
  await expect(qualified).toContainText('≤ ');
  await expect(qualified).toContainText('At Maple Grove Academy');
  await expect(qualified).toContainText('83% · 25 of 30');
  await expect(qualified).toContainText('academy-desk-sft-8b');
  await expect(qualified).toContainText(
    `${Math.round((FIELD_REPORT.test.score.pass * 100) / FIELD_REPORT.test.score.total)}% · ${FIELD_REPORT.test.score.pass} of ${FIELD_REPORT.test.score.total}`,
  );
  await capture('links-model-panel-dark.png');

  await panel().getByRole('button', { name: 'Open results' }).click();
  await expect(page).toHaveURL(new RegExp(`#${report}$`));

  await goTo(page, `/models/${VERSION_KEY}`);
  await panel().getByRole('button', { name: 'Open chat' }).click();
  await expect(page).toHaveURL(new RegExp(`#/agents/${ACADEMY_DESK_ID}/chats/${FIELD_CHAT.id}$`));

  // Cluster training is planned for the version's field, from the model it runs on.
  await goTo(page, `/models/${VERSION_KEY}`);
  await panel().getByRole('button', { name: 'Plan cluster training' }).click();
  await expect(page).toHaveURL(/#\/compute\/fields\/[^/]+\/[^/]+$/);

  // Closing the panel takes it out of the path too.
  await goTo(page, `/models/${VERSION_KEY}`);
  await panel().getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL(/#\/models$/);
  await expect(panel()).toHaveCount(0);
});

test("a field's page goes back to Fields, and its versions open in Models", async () => {
  await openAt(`/fields/${LAB.academyDeskJob}`);
  await button('Back to Fields').click();
  await expect(page).toHaveURL(/#\/fields$/);

  await goTo(page, `/fields/${LAB.academyDeskJob}`);
  await page.getByRole('tab', { name: 'Versions' }).click();
  const versions = page.getByRole('table', { name: 'Versions' });
  const best = versions.getByRole('row', { name: /Best/ });
  await expect(best).toContainText('Academy desk v2');
  await capture('links-field-versions-dark.png');
  await best.click();
  await expectVersionOpen();
});

test('the Lab shows its experiments, running ones under Running and waiting ones under Needs you', async () => {
  await openAt('/');
  const [running, funding] = LAB_EXPERIMENTS;
  if (!running || !funding) throw new Error('The Lab has two experiments.');
  await expect(
    region('Running').getByRole('button', { name: new RegExp(running.input.name) }),
  ).toContainText('47 min');
  const waiting = region('Needs you').getByRole('region', { name: 'Experiments' });
  await expect(waiting.getByRole('button', { name: new RegExp(funding.input.name) })).toContainText(
    'Needs funding',
  );
  const card = region('Experiments');
  await expect(card.getByRole('button', { name: new RegExp(running.input.name) })).toContainText(
    'Running',
  );
  await capture('links-lab-dark.png');

  await waiting.getByRole('button', { name: new RegExp(funding.input.name) }).click();
  await expect(page).toHaveURL(new RegExp(`#/experiments/${funding.id}$`));
  await goTo(page, '/');
  await region('Running')
    .getByRole('button', { name: new RegExp(running.input.name) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/experiments/${running.id}$`));
  await goTo(page, '/');
  await card.getByRole('button', { name: 'New experiment' }).click();
  await expect(page).toHaveURL(/#\/experiments\/new$/);

  // Describe a field starts the field the way Fields does: ready for its organizations.
  await goTo(page, '/');
  await region('Fields').getByRole('button', { name: 'Describe a field' }).click();
  await expect(page).toHaveURL(/#\/new$/);
  await expect(region('Organizations')).toBeVisible();
});

test("an experiment's results open each arm's run and the version it froze", async () => {
  await installExperimentsFake(launched.app, await recordedComparisonReport());
  const input: ExperimentInput = {
    name: 'Targeted against one-shot draft',
    jobId: LAB.academyDeskJob,
    arms: [{ arm: 'bare' }, { arm: 'draft' }, { arm: 'targeted' }, { arm: 'reference' }],
    seeds: { mentoring: 1, lockedTest: [101] },
    rounds: 4,
    caps: { studentUsd: 15, sparkUsd: 10, computeUsd: 0, wallMinutes: 720 },
  };
  const id = await page.evaluate(async (planned) => {
    const detail = (await window.architect.experiments.plan(planned)) as {
      experiment: { id: string };
    };
    await window.architect.experiments.preregister(detail.experiment.id);
    await window.architect.experiments.start(detail.experiment.id, {});
    return detail.experiment.id;
  }, input);
  await finishExperiments(launched.app);
  await openAt(`/experiments/${id}`);

  const runs = page.getByRole('table', { name: "Each arm's run" });
  const targeted = runs.getByRole('row', { name: /Targeted mentoring/ });
  await targeted.scrollIntoViewIfNeeded();
  await expect(targeted).toContainText(/v\d+ · [0-9a-f]{7}/);
  await targeted.click();
  const drawer = page.getByRole('dialog', { name: 'Targeted mentoring' });
  await expect(drawer.getByRole('region', { name: 'Rounds' })).toBeVisible();
  await expect(drawer.getByRole('region', { name: 'Version' })).toContainText(/v\d+ · [0-9a-f]{7}/);
  await capture('links-experiment-arm-dark.png');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

test("a field's export leads to Compute, whose bundle offers it as the field's latest", async () => {
  await stubLinks();
  const exported = join(folders, 'Architect', 'exports', 'academy-desk');
  await mkdir(exported, { recursive: true });
  await openAt(`/fields/${LAB.academyDeskJob}`);
  await page.getByRole('tab', { name: 'Assets' }).click();
  await picks(exported);
  await stubRecorded(launched.app, 'jobs:exportField', ACADEMY_DESK_ASSETS);
  await button('Export').click();
  const toast = page.getByRole('listitem').filter({ hasText: 'Field exported' });
  await expect(toast).toBeVisible();
  expect(await recordedCalls(launched.app, 'jobs:exportField')).toEqual([
    [LAB.academyDeskJob, exported],
  ]);
  await toast.getByRole('button', { name: 'Open Compute' }).click();
  await expect(page).toHaveURL(new RegExp(`#/compute/fields/${LAB.academyDeskJob}$`));

  // A plan from a config.json on this computer, so the bundle has something to carry.
  const config = join(folders, 'config.json');
  await writeFile(config, await readFile(join(CONFIGS, 'moe-235b.json'), 'utf8'));
  const plan = region('Training plan');
  await plan.getByRole('radio', { name: 'config.json' }).click();
  await picks(config);
  await plan.getByRole('button', { name: 'Choose config.json' }).click();
  await expect(region('Memory on each GPU').getByText('Estimate')).toBeVisible();

  const bundle = region('Bundle');
  await expect(bundle).toContainText('Field export of Academy desk');
  await expect(bundle).toContainText(/…[\\/]exports[\\/]academy-desk/);
  await bundle.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await bundle.getByRole('button', { name: 'Use the latest export of…' }).click();
  await expect(page.getByRole('menuitem', { name: 'Academy desk' })).toBeVisible();
  await capture('links-compute-bundle-dark.png');
  await page.getByRole('menuitem', { name: 'Academy desk' }).click();
  await expect(bundle).toContainText('Field export of Academy desk');
});

test('the personal edition shows none of the Lab links', async () => {
  // On the results first: a Lab place reloaded in the personal edition would be sent home.
  await goTo(page, report);
  await updateSettings(page, { edition: 'personal' });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await settle(page);
  await expect(button('See all rounds')).toBeVisible();
  await expect(button('Open field')).toHaveCount(0);
  await expect(button('Open in Models')).toHaveCount(0);
  await button('Close').click();
  await expect(page).toHaveURL(/#\/$/);
  await updateSettings(page, { edition: 'lab' });
});
