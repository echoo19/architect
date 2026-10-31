import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type {
  FieldView,
  GraduateVersion,
  Job,
  LocalRuntimes,
  ReportCard,
  RunDetail,
} from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { LOCAL_WITH_GLIMMER, stubEngine } from './fixtures';
import { FIELD_CAPABILITIES } from './fixtures-field';
import {
  ACADEMY_DESK_ASSETS,
  ACADEMY_DESK_FIELD,
  ACADEMY_DESK_PLAN,
  FIELD_REPORTS,
  FIELD_VIEWS,
  REPORT_TARGETS,
  RUNS,
  stubFields,
} from './fixtures-fields';
import { recordedCalls, stubByKey, stubRecorded } from './fixtures-flow';
import { ACADEMY_DESK_ID, DETAILS, JOBS, LAB } from './fixtures-lab';
import { installModelsFake, MODEL_REPORTS, MODEL_VERSIONS } from './fixtures-models';

/*
 * Carrying a field to another model (decision 095), against the stand-in engine: Move to another
 * model from the field's page, the confirm that says what carries over and what stays sealed,
 * the new version and its timeline, each organization and skill before and after on its report,
 * and the switch in Models that shows what the new model gains and loses and can be undone.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };

const QWEN = 'qwen3:8b';
const V2_JOB = 'job_academy_desk_v2';
const V2_RUN = 'run_academy_desk_v2';
const CARRIED = { graduateId: ACADEMY_DESK_ID, version: 2 };

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
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  // Rows that read again slide into place; the picture waits for them to land.
  await page.waitForTimeout(800);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

async function openAt(path: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

/** Glimmer here, and a second model the field can move to. */
const LOCAL: LocalRuntimes = {
  ...LOCAL_WITH_GLIMMER,
  ollama: {
    ...LOCAL_WITH_GLIMMER.ollama,
    models: [...LOCAL_WITH_GLIMMER.ollama.models, { id: QWEN, sizeBytes: 5_200_000_000 }],
  },
};

const OLD_FIELD: FieldView = {
  ...ACADEMY_DESK_FIELD,
  nextVersion: { jobId: V2_JOB, name: 'Academy desk v2', model: QWEN },
};

/** The new version: the same organizations, sealed as they were, on another model. */
const V2_FIELD: FieldView = {
  ...ACADEMY_DESK_FIELD,
  jobId: V2_JOB,
  versionOf: {
    jobId: LAB.academyDeskJob,
    name: 'Academy desk',
    version: 2,
    model: { from: 'Glimmer', to: QWEN, carried: CARRIED },
  },
};

const OLD_JOB = JOBS[LAB.academyDeskJob] as Job;
const V2_JOB_FILE: Job = {
  ...OLD_JOB,
  id: V2_JOB,
  name: 'Academy desk v2',
  createdAt: '2026-10-27T08:00:00.000Z',
  student: {
    label: QWEN,
    local: { ...OLD_JOB.student.local, model: QWEN },
    trainOn: 'local',
  },
  startingHarness: { kind: 'import', path: 'carried-harness' },
};

const CARRIED_REPORT = MODEL_REPORTS[`${ACADEMY_DESK_ID}:2`] as ReportCard;

/** The new model's final test: better where it never trained, a little worse at home. */
const V2_REPORT: ReportCard = {
  ...CARRIED_REPORT,
  jobId: V2_JOB,
  runId: V2_RUN,
  student: { ...CARRIED_REPORT.student, label: QWEN, model: QWEN },
  test: {
    ...CARRIED_REPORT.test,
    perOrg: CARRIED_REPORT.test.perOrg?.map((row, index) => ({
      ...row,
      pass: Math.max(
        0,
        Math.min(row.total, row.pass + (row.seen ? -(index % 3 === 0 ? 1 : 0) : 1)),
      ),
    })),
  },
};

const OLD_DETAIL = DETAILS[LAB.academyDeskRun] as RunDetail;
const V2_DETAIL: RunDetail = {
  ...OLD_DETAIL,
  job: V2_JOB_FILE,
  run: {
    ...OLD_DETAIL.run,
    id: V2_RUN,
    jobId: V2_JOB,
    status: 'finished',
    phase: 'done',
    graduateId: ACADEMY_DESK_ID,
  },
};

/** The new version's training, as version 3 of the agent it carried: not in use yet. */
const ON_QWEN: GraduateVersion = (() => {
  const carried = MODEL_VERSIONS[ACADEMY_DESK_ID]?.[1] as GraduateVersion;
  return {
    ...carried,
    version: 3,
    parent: 2,
    active: false,
    state: 'candidate',
    digest: carried.digest.replace(/.$/, '3'),
    path: `graduates/${ACADEMY_DESK_ID}/versions/3`,
    runId: V2_RUN,
    createdAt: '2026-10-31T12:00:00.000Z',
    manifest: {
      ...carried.manifest,
      contract: { ...carried.manifest.contract, jobId: V2_JOB },
      model: {
        ...carried.manifest.model,
        label: QWEN,
        base: { name: QWEN },
      },
    },
  };
})();

/** Every read the new version of the field and the earlier one make, from now on. */
async function stubVersions(): Promise<void> {
  await stubByKey(launched.app, 'jobs:get', { ...JOBS, [V2_JOB]: V2_JOB_FILE });
  await stubByKey(launched.app, 'jobs:field', {
    ...FIELD_VIEWS,
    [LAB.academyDeskJob]: OLD_FIELD,
    [V2_JOB]: V2_FIELD,
  });
  await stubByKey(launched.app, 'runs:list', { ...RUNS, [V2_JOB]: [V2_DETAIL.run] });
  await stubByKey(launched.app, 'runs:get', { ...DETAILS, [V2_RUN]: V2_DETAIL });
  await stubByKey(launched.app, 'reports:list', { ...REPORT_TARGETS, [V2_RUN]: ['local'] });
  await stubByKey(launched.app, 'reports:get', { ...FIELD_REPORTS, [V2_RUN]: V2_REPORT });
  await stubByKey(launched.app, 'graduates:report', { [ACADEMY_DESK_ID]: CARRIED_REPORT });
  await stubByKey(launched.app, 'graduates:versions', {
    ...MODEL_VERSIONS,
    [ACADEMY_DESK_ID]: [...(MODEL_VERSIONS[ACADEMY_DESK_ID] ?? []), ON_QWEN],
  });
  await stubByKey(launched.app, 'jobs:taskPlan', {
    [LAB.academyDeskJob]: ACADEMY_DESK_PLAN,
    [V2_JOB]: ACADEMY_DESK_PLAN,
  });
  await stubByKey(launched.app, 'jobs:fieldAssets', {
    [LAB.academyDeskJob]: ACADEMY_DESK_ASSETS,
    [V2_JOB]: ACADEMY_DESK_ASSETS,
  });
  await stubByKey(launched.app, 'runs:qualifications', { [LAB.academyDeskJob]: [], [V2_JOB]: [] });
  await stubByKey(launched.app, 'mentoring:fieldCounterexamples', {
    [LAB.academyDeskJob]: [],
    [V2_JOB]: [],
  });
}

test('moves a field to another model from its page, carrying what it has', async () => {
  await stubFields(launched.app);
  await stubEngine(launched.app, { 'connections:detectLocal': LOCAL });
  await openAt(`/fields/${LAB.academyDeskJob}`);
  await page.getByRole('button', { name: 'Move to another model' }).click();

  const dialog = page.getByRole('dialog', { name: 'Move to another model' });
  await expect(dialog.getByRole('button', { name: 'Move', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'New model' }).click();
  await page.getByRole('option', { name: new RegExp(QWEN.replace('.', '\\.')) }).click();

  const lines = dialog.getByRole('list', { name: 'What carries over' });
  await expect(lines).toContainText(
    `Makes Academy desk v2, a new version of the field on ${QWEN}.`,
  );
  await expect(lines).toContainText('Academy desk stays as it is.');
  await expect(lines).toContainText(
    "instructions, helpers, retrieval and verified lessons of the version in use, and the field's counterexamples",
  );
  await expect(lines).toContainText(
    'Keeps the same practice tasks, check tasks, checker and study.',
  );
  await expect(lines).toContainText('stay never seen, sealed exactly as they are.');
  await expect(lines).toContainText(
    'The agent in use keeps answering on Glimmer until you switch it.',
  );
  await capture('new-model-dialog-dark.png');

  await stubRecorded(launched.app, 'jobs:moveToModel', V2_FIELD);
  await stubVersions();
  await dialog.getByRole('button', { name: `Move to ${QWEN}` }).click();
  await expect(dialog).toHaveCount(0);
  const [[jobId, request]] = (await recordedCalls(launched.app, 'jobs:moveToModel')) as [
    [string, { student: { model: string; baseUrl: string }; label: string }],
  ];
  expect(jobId).toBe(LAB.academyDeskJob);
  expect(request.label).toBe(QWEN);
  expect(request.student.model).toBe(QWEN);

  // The new version opens, and its timeline says where it came from.
  await expect(page.getByRole('heading', { name: 'Academy desk v2', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move to another model' })).toBeVisible();
  const timeline = page.getByRole('region', { name: 'Timeline' });
  await expect(timeline).toContainText(`Moved to ${QWEN}`);
  await expect(timeline).toContainText(
    `Made as version 2 from Academy desk, carried from Glimmer to ${QWEN}`,
  );
  await timeline.scrollIntoViewIfNeeded();
  await capture('new-model-field-dark.png');

  // The field it came from moves on no more, and leads to the new version.
  await openAt(`/fields/${LAB.academyDeskJob}`);
  await expect(page.getByRole('heading', { name: 'Academy desk', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Move to another model' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Timeline' })).toContainText(
    `Academy desk v2, a later version, was carried to ${QWEN}`,
  );
});

test("shows each organization and skill before and after on the new version's report", async () => {
  await stubFields(launched.app);
  await stubVersions();
  await stubEngine(launched.app, {
    'mentoring:capabilities': { ...FIELD_CAPABILITIES, runId: V2_RUN },
    'mentoring:references': [],
  });
  await openAt(`/runs/${V2_RUN}/report`);
  const table = page.getByRole('table', { name: 'Each organization before and after' });
  await expect(table.getByRole('columnheader', { name: 'Academy desk · Glimmer' })).toBeVisible();
  await expect(
    table.getByRole('columnheader', { name: `Academy desk v2 · ${QWEN}` }),
  ).toBeVisible();
  const sealed = ACADEMY_DESK_FIELD.sealed[0]?.name ?? '';
  await expect(table.getByRole('rowheader', { name: sealed })).toBeVisible();
  // A row per skill under each organization.
  const skill = CARRIED_REPORT.test.perOrg?.[0]?.label ?? '';
  await expect(table.getByRole('rowheader', { name: skill }).first()).toBeVisible();
  await page
    .getByRole('heading', { name: 'Before and after' })
    .evaluate((heading) => heading.scrollIntoView({ block: 'start' }));
  await capture('new-model-report-dark.png');
});

test('switches the agent to the new model only when asked, and undoes it', async () => {
  // The fields first: the registry's versions, with the one on the new model, go on top.
  await stubFields(launched.app);
  await installModelsFake(launched.app, {
    versions: [ON_QWEN],
    reports: { [`${ACADEMY_DESK_ID}:3`]: V2_REPORT },
  });
  await stubByKey(launched.app, 'reports:get', { ...FIELD_REPORTS, [V2_RUN]: V2_REPORT });
  await stubByKey(launched.app, 'runs:get', { ...DETAILS, [V2_RUN]: V2_DETAIL });
  await stubByKey(launched.app, 'runs:qualifications', { [LAB.academyDeskJob]: [], [V2_JOB]: [] });
  await stubByKey(launched.app, 'jobs:field', { ...FIELD_VIEWS, [V2_JOB]: V2_FIELD });
  await openAt(`/models/${encodeURIComponent(`${ACADEMY_DESK_ID}:3`)}`);
  const panel = page.getByRole('complementary', { name: 'Model' });
  await expect(panel).toContainText('Candidate');
  await expect(page.getByRole('region', { name: 'Candidates' })).toContainText(
    `On ${QWEN}, from v2`,
  );

  await panel.getByRole('button', { name: 'Use this version' }).click();
  const dialog = page.getByRole('dialog', { name: `Switch to ${QWEN}?` });
  await expect(dialog).toContainText(`Academy desk answers on ${QWEN} instead of Glimmer.`);
  const gains = dialog.getByRole('table', { name: 'What it gains and loses' });
  await expect(gains.getByRole('row')).not.toHaveCount(0);
  await expect(gains).toContainText('Gains');
  await expect(gains).toContainText('Loses');
  await expect(dialog).toContainText('Version 2 stays, so you can go back to it.');
  await capture('new-model-switch-dark.png');

  await dialog.getByRole('button', { name: `Switch to ${QWEN}` }).click();
  await expect(dialog).toHaveCount(0);
  const toast = page.getByText(`Academy desk answers on ${QWEN}`, { exact: true });
  await expect(toast).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  const calls = await launched.app.evaluate(
    () => (globalThis as { modelCalls?: { channel: string; args: unknown[] }[] }).modelCalls ?? [],
  );
  await expect
    .poll(async () =>
      (
        await launched.app.evaluate(
          () =>
            (globalThis as { modelCalls?: { channel: string; args: unknown[] }[] }).modelCalls ??
            [],
        )
      )
        .filter((call) => ['graduates:promote', 'graduates:rollback'].includes(call.channel))
        .map((call) => [call.channel, ...call.args]),
    )
    .toEqual([
      ['graduates:promote', ACADEMY_DESK_ID, 3],
      ['graduates:rollback', ACADEMY_DESK_ID, 2],
    ]);
  expect(calls.some((call) => call.channel === 'graduates:acceptVersion')).toBe(true);
});

test("moves from a version's panel in Models, carrying that version", async () => {
  await stubFields(launched.app);
  await installModelsFake(launched.app, { versions: [ON_QWEN], reports: {} });
  await stubVersions();
  await stubEngine(launched.app, { 'connections:detectLocal': LOCAL });
  await openAt(`/models/${encodeURIComponent(`${ACADEMY_DESK_ID}:3`)}`);
  const panel = page.getByRole('complementary', { name: 'Model' });
  await panel.getByRole('button', { name: 'Move to another model' }).click();
  // Made at the newest version of the field, carrying the version the panel shows.
  const dialog = page.getByRole('dialog', { name: 'Move to another model' });
  await expect(dialog).toContainText('Makes Academy desk v3, a new version of the field');
  await expect(dialog).toContainText("Starts from Academy desk v3's instructions");
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});
