import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { FieldView, Job, ReportCard, RunDetail } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import { FIELD_CAPABILITIES, FIELD_ORGS } from './fixtures-field';
import {
  ACADEMY_DESK_FIELD,
  FIELD_REPORTS,
  FIELD_VIEWS,
  REPORT_TARGETS,
  RUNS,
  stubFields,
} from './fixtures-fields';
import { recordedCalls, stubByKey, stubRecorded } from './fixtures-flow';
import { DETAILS, JOBS, LAB } from './fixtures-lab';

/*
 * Learning from a never-seen organization in the Lab (decision 089), against the stand-in
 * engine: Teach on it from the report and from Organizations, the confirm that says what changes
 * and what stays as measured, the new version of the field with a fresh cohort sealed there, the
 * earlier version's results marked as measured before, and each organization before and after.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };

const V2_JOB = 'job_academy_desk_v2';
const V2_RUN = 'run_academy_desk_v2';
const HARBOR = 'Harbor Learning';

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
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

async function openAt(path: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

const card = (name: string) => page.getByRole('region', { name });
const harborFiles = ACADEMY_DESK_FIELD.organizations[0]?.files ?? [];

/** The earlier field once Harbor Learning is taught on in its next version. */
const OLD_FIELD: FieldView = {
  ...ACADEMY_DESK_FIELD,
  sealed: ACADEMY_DESK_FIELD.sealed.map((org) =>
    org.name === HARBOR ? { ...org, taughtIn: { jobId: V2_JOB, name: 'Academy desk v2' } } : org,
  ),
};

/** The new version: Harbor Learning taught on, the Real academy still never seen. */
const V2_FIELD: FieldView = {
  ...ACADEMY_DESK_FIELD,
  jobId: V2_JOB,
  organizations: [
    ...ACADEMY_DESK_FIELD.organizations,
    { id: 'harbor', name: HARBOR, synthetic: true, files: harborFiles },
  ],
  sealed: ACADEMY_DESK_FIELD.sealed.filter((org) => org.name !== HARBOR),
  versionOf: { jobId: LAB.academyDeskJob, name: 'Academy desk', version: 2, org: HARBOR },
};

const OLD_JOB = JOBS[LAB.academyDeskJob] as Job;
const V2_JOB_FILE: Job = {
  ...OLD_JOB,
  id: V2_JOB,
  name: 'Academy desk v2',
  organizations: [
    ...FIELD_ORGS.filter((org) => org.seen).map((org) => ({
      id: org.org,
      name: org.name,
      synthetic: org.synthetic,
      role: 'train' as const,
    })),
    { id: 'harbor', name: HARBOR, synthetic: true, role: 'train' },
  ],
};

const OLD_REPORT = {
  ...(FIELD_REPORTS[LAB.academyDeskRun] as ReportCard),
  jobId: LAB.academyDeskJob,
};

/** The earlier version's card as read once Harbor Learning is taught on: marked, not changed. */
const OLD_REPORT_LATER: ReportCard = {
  ...OLD_REPORT,
  test: {
    ...OLD_REPORT.test,
    perOrg: OLD_REPORT.test.perOrg?.map((row) =>
      row.org === 'harbor' ? { ...row, taughtLater: true as const } : row,
    ),
  },
};

/** The new version's card: Harbor Learning's tasks are practice and check tasks now. */
const V2_REPORT: ReportCard = {
  ...OLD_REPORT,
  jobId: V2_JOB,
  runId: V2_RUN,
  test: {
    ...OLD_REPORT.test,
    perOrg: OLD_REPORT.test.perOrg
      ?.filter((row) => row.org !== 'harbor')
      .map((row) => (row.org === 'cp' ? { ...row, pass: Math.min(row.total, row.pass + 1) } : row)),
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
    devByOrg: [
      { org: 'northside', pass: 15, total: 16 },
      { org: 'lakeview', pass: 14, total: 16 },
      { org: 'summit', pass: 15, total: 16 },
      { org: 'harbor', pass: 10, total: 12 },
    ],
  },
};

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
  await stubByKey(launched.app, 'reports:list', { ...REPORT_TARGETS, [V2_RUN]: ['hosted'] });
  await stubByKey(launched.app, 'reports:get', {
    ...FIELD_REPORTS,
    [LAB.academyDeskRun]: OLD_REPORT_LATER,
    [V2_RUN]: V2_REPORT,
  });
}

test('offers to teach on each never-seen organization from the report', async () => {
  await stubFields(launched.app);
  await stubByKey(launched.app, 'reports:get', {
    ...FIELD_REPORTS,
    [LAB.academyDeskRun]: OLD_REPORT,
  });
  await openAt(`/runs/${LAB.academyDeskRun}/report`);
  const grid = page.getByRole('table', { name: 'Final test by organization' });
  await expect(grid.getByRole('button', { name: `Teach on ${HARBOR}` })).toBeVisible();
  await expect(grid.getByRole('button', { name: 'Teach on Real academy' })).toBeVisible();
  await expect(grid.getByRole('button', { name: /Teach on/ })).toHaveCount(2);

  await grid.getByRole('button', { name: `Teach on ${HARBOR}` }).click();
  const dialog = page.getByRole('dialog', { name: `Teach on ${HARBOR}?` });
  await expect(dialog).toContainText('Makes Academy desk v2, a new version of the field.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('teaches on it in a new version of the field, and seals a fresh cohort there', async () => {
  await stubFields(launched.app);
  await openAt(`/fields/${LAB.academyDeskJob}`);
  await page.getByRole('tab', { name: 'Organizations' }).click();
  const orgs = card('Organizations');
  await orgs.getByRole('button', { name: new RegExp(HARBOR) }).click();
  const harbor = card(HARBOR);
  await expect(harbor).toContainText('Never seen.');
  await harbor.getByRole('button', { name: 'Teach on it' }).click();

  // The confirm says exactly what changes and what stays as measured.
  const dialog = page.getByRole('dialog', { name: `Teach on ${HARBOR}?` });
  const changes = dialog.getByRole('list', { name: 'What changes' });
  await expect(changes).toContainText('Makes Academy desk v2, a new version of the field.');
  await expect(changes).toContainText('Academy desk stays as it is.');
  await expect(changes).toContainText(
    `${HARBOR}’s files become material Spark may read, and its tasks become practice and check tasks.`,
  );
  await expect(changes).toContainText('Real academy stays never seen, sealed again');
  await expect(changes).toContainText(
    `What was measured on ${HARBOR} stays as it was, marked measured before it was taught on.`,
  );
  await capture('learn-from-org-dark.png');

  await stubRecorded(launched.app, 'jobs:teachOn', V2_FIELD);
  await stubVersions();
  await dialog.getByRole('button', { name: 'Teach on it' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await recordedCalls(launched.app, 'jobs:teachOn')).toEqual([[LAB.academyDeskJob, HARBOR]]);

  // The new version opens on its organizations: Harbor Learning is taught on there.
  await expect(page.getByRole('heading', { name: 'Academy desk v2', level: 1 })).toBeVisible();
  const next = card('Organizations');
  await expect(next.getByRole('button', { name: new RegExp(HARBOR) })).toContainText('Taught on');
  await expect(next.getByRole('button', { name: /Real academy/ })).toContainText('Never seen');

  await stubEngine(launched.app, { 'files:pick': ['D:\\Exports\\Harbor Learning November'] });
  await stubRecorded(launched.app, 'jobs:addOrganization', {
    ...V2_FIELD,
    sealed: [
      ...V2_FIELD.sealed,
      {
        name: `${HARBOR} fresh cohort`,
        synthetic: true,
        files: 12,
        addedLater: true as const,
        cohortOf: HARBOR,
      },
    ],
  });
  await next.getByRole('button', { name: 'Seal a fresh cohort' }).click();
  const fresh = page.getByRole('dialog', { name: 'Seal a fresh cohort' });
  await expect(fresh.getByLabel('Name')).toHaveValue(`${HARBOR} fresh cohort`);
  await expect(fresh.getByRole('radio', { name: 'Generated' })).toBeChecked();
  await fresh.getByRole('button', { name: 'Choose a folder' }).click();
  await fresh.getByRole('button', { name: 'Add and seal' }).click();
  await expect(fresh).toHaveCount(0);
  expect(await recordedCalls(launched.app, 'jobs:addOrganization')).toEqual([
    [
      V2_JOB,
      {
        folder: 'D:\\Exports\\Harbor Learning November',
        name: `${HARBOR} fresh cohort`,
        synthetic: true,
        cohortOf: HARBOR,
      },
    ],
  ]);
  // It is new work of Harbor Learning, not an organization of its own it never saw.
  await expect(
    next.getByRole('button', { name: new RegExp(`${HARBOR} fresh cohort`) }),
  ).toContainText(`Fresh cohort of ${HARBOR}`);
  await capture('learn-from-org-version-dark.png');
});

test('keeps what the earlier version measured, marked as measured before', async () => {
  await stubFields(launched.app);
  await stubVersions();
  await openAt(`/fields/${LAB.academyDeskJob}/organizations`);
  const orgs = card('Organizations');
  const harbor = orgs.getByRole('button', { name: new RegExp(HARBOR) });
  await expect(harbor).toContainText('Taught on in Academy desk v2');
  await harbor.click();
  await expect(card(HARBOR)).toContainText('stays as measured, before it was taught on');
  await expect(card(HARBOR).getByRole('button', { name: 'Open Academy desk v2' })).toBeVisible();

  await goTo(page, `/runs/${LAB.academyDeskRun}/report`);
  const grid = page.getByRole('table', { name: 'Final test by organization' });
  await expect(grid.getByRole('columnheader', { name: new RegExp(HARBOR) })).toContainText(
    'Measured before it was taught on',
  );
  // Only the newest version is taught on further.
  await expect(grid.getByRole('button', { name: /Teach on/ })).toHaveCount(0);
});

test("shows each organization before and after on the new version's report", async () => {
  await stubFields(launched.app);
  await stubVersions();
  await stubEngine(launched.app, {
    'mentoring:capabilities': { ...FIELD_CAPABILITIES, runId: V2_RUN },
    'mentoring:references': [],
  });
  await openAt(`/runs/${V2_RUN}/report`);
  const table = page.getByRole('table', { name: 'Each organization before and after' });
  await expect(table.getByRole('columnheader', { name: 'Academy desk v2' })).toBeVisible();
  const harbor = table.getByRole('row', { name: new RegExp(HARBOR) });
  await expect(harbor).toContainText('never seen');
  await expect(harbor).toContainText('83% · 10 of 12, check tasks, taught on');
  await table.scrollIntoViewIfNeeded();
  await capture('learn-from-org-report-dark.png');
});
