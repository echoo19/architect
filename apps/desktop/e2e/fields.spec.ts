import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import { FIELDS, ACADEMY_DESK_ASSETS, ACADEMY_DESK_FIELD, stubFields } from './fixtures-fields';
import { recordedCalls, stubByKey, stubRecorded } from './fixtures-flow';
import { LAB } from './fixtures-lab';

/*
 * The Fields place against the stand-in engine (decision 075): the list of fields with their
 * organizations and best candidate, and a field's overview, organizations, candidates and
 * assets, with the export to a folder the person picks.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const EXPORT_DIR = 'C:\\Users\\dana\\Exports\\academy-desk';

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
  await stubFields(launched.app);
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

const tab = (name: string) => page.getByRole('tab', { name });
const card = (name: string) => page.getByRole('region', { name });

test('lists each field with its organizations, best candidate and last activity', async () => {
  await openAt('/fields');
  await expect(page.getByRole('heading', { name: 'Fields', level: 1 })).toBeVisible();
  const table = page.getByRole('table', { name: 'Fields' });
  // Five fields under a header of two rows: the organizations, then the best final test.
  await expect(table.getByRole('row')).toHaveCount(7);

  // Academy desk: taught on three academies, one never seen and one real; its best candidate's
  // final test on each kind.
  const academyDesk = table.getByRole('row', { name: /^Academy desk/ });
  const cells = academyDesk.getByRole('cell');
  await expect(cells.nth(1)).toHaveText('3');
  await expect(cells.nth(2)).toHaveText('1');
  await expect(cells.nth(3)).toHaveText('1');
  await expect(cells.nth(4)).toHaveText('93%');
  await expect(cells.nth(5)).toHaveText('83%');
  await expect(cells.nth(6)).toHaveText('90%');

  // A one-organization job is a field of its own records: nothing sealed, and what it never
  // measured reads as absent, not as zero.
  const clinic = table.getByRole('row', { name: /^Clinic intake/ }).getByRole('cell');
  await expect(clinic.nth(1)).toHaveText('1');
  await expect(clinic.nth(2)).toHaveText('0');
  await expect(clinic.nth(3)).toHaveText('–None');
  await expect(clinic.nth(4)).toHaveText('92%');
  await expect(clinic.nth(5)).toHaveText('–None');

  await expect(page.getByRole('button', { name: 'New field' })).toBeVisible();
  await capture('fields-dark.png');

  await academyDesk.click();
  await expect(page).toHaveURL(new RegExp(`#/fields/${LAB.academyDeskJob}$`));
  await page.goBack();
  await page.getByRole('button', { name: 'New field' }).click();
  await expect(page).toHaveURL(/#\/new$/);
});

test("shows the best candidate's skill by organization grid, the skills and the study", async () => {
  await openAt(`/fields/${LAB.academyDeskJob}`);
  await expect(page.getByRole('heading', { name: 'Academy desk', level: 1 })).toBeVisible();
  await expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');

  const grid = page.getByRole('table', { name: 'Final test by organization' });
  await expect(grid.getByRole('columnheader', { name: 'Real academy' })).toBeVisible();
  await expect(grid.getByLabel('Topic history at Real academy, 10 of 10 passed')).toBeVisible();
  // The real academy has no question text, so some skills were never tested there.
  await expect(grid.getByLabel('Work the question at Real academy, None')).toBeAttached();

  await expect(card('Skills').getByText('Whole tutoring turn')).toBeVisible();
  await expect(card('Skills').getByText('38 tasks').first()).toBeVisible();
  const study = card('Study');
  await expect(study).toContainText('Confirmed');
  await expect(study).toContainText('Where organizations differ');
  await capture('field-overview-dark.png');

  await page.getByRole('button', { name: 'Open report' }).click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${LAB.academyDeskRun}/report$`));
  await goTo(page, `/fields/${LAB.academyDeskJob}`);
  await study.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(new RegExp(`#/jobs/${LAB.academyDeskJob}/define$`));
});

test('lists the organizations taught on with their files, and the sealed ones by name only', async () => {
  await openAt(`/fields/${LAB.academyDeskJob}`);
  await tab('Organizations').click();
  const orgs = card('Organizations');
  const northside = orgs.getByRole('button', { name: /Northside Prep/ });
  await expect(northside).toHaveAttribute('aria-pressed', 'true');
  await expect(northside).toContainText('Generated · 12 files · 3,545 rows');
  await expect(northside).toContainText('Taught on');

  // The sealed academies are named for the person whose they are, and nothing else of them shows.
  for (const name of ['Harbor Learning', 'Real academy']) {
    const row = orgs.getByText(name, { exact: true });
    await expect(row).toBeVisible();
    await expect(orgs.getByRole('button', { name: new RegExp(name) })).toHaveCount(0);
  }
  await expect(orgs).toContainText('Real · 7 files');
  await expect(orgs.getByText('Never seen', { exact: true })).toHaveCount(2);

  const files = card('Northside Prep');
  await expect(files.getByText('attempts.csv')).toBeVisible();
  await expect(files).toContainText('2,940 rows');
  await capture('field-orgs-dark.png');

  await orgs.getByRole('button', { name: /Lakeview Academy/ }).click();
  await expect(card('Lakeview Academy')).toContainText('3,675 rows');
});

test('adds a never-seen organization later and qualifies a candidate on it', async () => {
  await openAt(`/fields/${LAB.academyDeskJob}`);
  await tab('Organizations').click();
  const folder = 'D:\\Records\\Maple Grove Academy';
  const added = {
    ...ACADEMY_DESK_FIELD,
    sealed: [
      ...ACADEMY_DESK_FIELD.sealed,
      { name: 'Maple Grove Academy', synthetic: false, files: 9, addedLater: true as const },
    ],
  };
  await stubEngine(launched.app, { 'files:pick': [folder] });
  await stubRecorded(launched.app, 'jobs:addOrganization', added);
  await page.getByRole('button', { name: 'Add a never-seen organization' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a never-seen organization' });
  await dialog.getByRole('button', { name: 'Choose a folder' }).click();
  await expect(dialog.getByRole('button', { name: /Maple Grove Academy/ })).toBeVisible();
  await expect(dialog.getByLabel('Name')).toHaveValue('Maple Grove Academy');
  await dialog.getByRole('button', { name: 'Add and seal' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await recordedCalls(launched.app, 'jobs:addOrganization')).toEqual([
    [LAB.academyDeskJob, { folder, name: 'Maple Grove Academy', synthetic: false }],
  ]);

  // The new organization is sealed beside the others, marked as added later, and opens beside
  // the list with each candidate to qualify on it.
  const orgs = card('Organizations');
  const maple = orgs.getByRole('button', { name: /Maple Grove Academy/ });
  await expect(maple).toContainText('Added later');
  await expect(maple).toHaveAttribute('aria-pressed', 'true');
  await expect(orgs.getByText('Never seen', { exact: true })).toHaveCount(2);
  const qualify = card('Maple Grove Academy');
  await expect(qualify.getByRole('button', { name: /^Qualify / })).toHaveCount(2);

  await stubRecorded(launched.app, 'runs:qualifyAdded', null);
  await stubByKey(launched.app, 'jobs:field', {
    [LAB.academyDeskJob]: {
      ...added,
      qualifications: [
        {
          runId: LAB.academyDeskRun,
          org: 'Maple Grove Academy',
          status: 'finished',
          startedAt: '2026-10-31T12:00:00.000Z',
          endedAt: '2026-10-31T12:20:00.000Z',
          score: { pass: 25, total: 30 },
        },
      ],
    },
  });
  await qualify
    .getByRole('button', { name: /^Qualify Academy desk/ })
    .first()
    .click();
  expect(await recordedCalls(launched.app, 'runs:qualifyAdded')).toEqual([
    [LAB.academyDeskRun, 'Maple Grove Academy'],
  ]);
  await expect(qualify.getByLabel(/at Maple Grove Academy: 25 of 30$/)).toBeVisible();
  await expect(qualify.getByRole('button', { name: /^Qualify / })).toHaveCount(1);
  await capture('field-add-org-dark.png');
  await stubFields(launched.app);
});

test('lists every candidate with its scores, the best marked, each opening its report', async () => {
  await openAt(`/fields/${LAB.academyDeskJob}`);
  await tab('Versions').click();
  const table = page.getByRole('table', { name: 'Candidates' });
  await expect(table.getByRole('row')).toHaveCount(3);
  const best = table.getByRole('row', { name: /Best/ });
  await expect(best.getByRole('cell').nth(3)).toHaveText('9');
  await expect(best).toContainText('Academy desk');
  await table.getByRole('row').nth(2).click();
  await expect(page).toHaveURL(new RegExp(`#/runs/${FIELDS.earlierRun}/report$`));
  await goTo(page, `/fields/${LAB.academyDeskJob}`);
  await tab('Versions').click();
  await page.getByRole('button', { name: 'Open Models' }).click();
  await expect(page).toHaveURL(/#\/models$/);
});

test("counts the field's assets and exports them to a folder the person picks", async () => {
  await openAt(`/fields/${LAB.academyDeskJob}`);
  await tab('Assets').click();
  const assets = card('Field export');
  await expect(assets.getByText('Verified demonstrations')).toBeVisible();
  await expect(assets).toContainText('41');
  await expect(assets).toContainText('Train tasks at 3 organizations');
  await expect(assets).toContainText(
    'Final-test tasks and 2 never-seen organizations, by hash only',
  );
  await expect(card('Left out')).toContainText('the calibration and check tasks');
  await expect(
    page.getByText('GPU execution, large models and training gains are unverified', {
      exact: false,
    }),
  ).toBeVisible();
  await capture('field-assets-dark.png');

  await stubEngine(launched.app, { 'files:pick': [EXPORT_DIR] });
  await stubRecorded(launched.app, 'jobs:exportField', ACADEMY_DESK_ASSETS);
  await page.getByRole('button', { name: 'Export' }).click();
  await expect(page.getByText('Field exported', { exact: true })).toBeVisible();
  expect(await recordedCalls(launched.app, 'jobs:exportField')).toEqual([
    [LAB.academyDeskJob, EXPORT_DIR],
  ]);
});

test("shows a one-organization field's best candidate and its own records", async () => {
  await openAt('/fields/job_clinic');
  await expect(page.getByRole('heading', { name: 'Clinic intake', level: 1 })).toBeVisible();
  await expect(card('Best candidate')).toContainText('92%');
  await expect(card('Study')).toHaveCount(0);
  await tab('Organizations').click();
  await expect(card('Organizations').getByRole('button', { name: /Its records/ })).toBeVisible();
  await expect(card('Its records')).toContainText('240 rows');

  // An experiment on the field starts from its page, with the field already chosen.
  await page.getByRole('button', { name: 'New experiment' }).click();
  await expect(page).toHaveURL(/#\/experiments\/new\/job_clinic$/);
});
