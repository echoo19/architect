import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { installExperimentsFake } from './fixtures-experiments';
import { stubFields } from './fixtures-fields';
import { LAB } from './fixtures-lab';
import { installModelsFake } from './fixtures-models';
import { SWEEP } from './fixtures-science';
import { SWEEP_EXPERIMENT, sweepComparison } from './fixtures-science-experiment';
import { recordedComparisonReport } from './recorded';

/*
 * The science lab beside the other fields, against the stand-in engine: Sweep desk finished and
 * tested on the research groups it was taught on and on one it never saw, Assay desk waiting to
 * be taught, and an experiment on Sweep desk read like a short paper. The same rounds, counts
 * and scores on every screen.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };

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

const card = (name: string) => page.getByRole('region', { name });
const tab = (name: string) => page.getByRole('tab', { name });

test('the Lab shows the science lab beside the other fields', async () => {
  await openAt('/');
  const sweep = card('Recently finished').getByRole('button', { name: /^Sweep desk/ });
  await expect(sweep).toContainText('Taught on');
  await expect(sweep).toContainText('92%');
  await expect(sweep).toContainText('Never seen');
  await expect(sweep).toContainText('77%');
  const fields = card('Fields');
  await expect(fields.getByRole('button', { name: /Sweep desk.*3 organizations/ })).toBeVisible();
  await expect(fields.getByRole('button', { name: /Assay desk.*3 organizations/ })).toBeVisible();
  await expect(
    card('Experiments').getByRole('button', { name: new RegExp(SWEEP_EXPERIMENT.input.name) }),
  ).toContainText('Finished');
  await card('Recently finished').evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await capture('lab-science-home-dark.png');

  await goTo(page, '/fields');
  const table = page.getByRole('table', { name: 'Fields' });
  const row = table.getByRole('row', { name: /^Sweep desk/ }).getByRole('cell');
  await expect(row.nth(1)).toHaveText('3');
  await expect(row.nth(2)).toHaveText('1');
  await expect(row.nth(4)).toHaveText('92%');
  await expect(row.nth(5)).toHaveText('77%');
  await expect(table.getByRole('row', { name: /^Assay desk/ })).toBeVisible();
});

test("Sweep desk's field: its skills by research group, its timeline and its groups' files", async () => {
  await openAt(`/fields/${SWEEP.job}`);
  await expect(page.getByRole('heading', { name: 'Sweep desk', level: 1 })).toBeVisible();
  const grid = page.getByRole('table', { name: 'Final test by organization' });
  await expect(grid.getByRole('columnheader', { name: 'Fennick Research' })).toBeVisible();
  await expect(grid.getByLabel('Did it help at Fennick Research, 5 of 8 passed')).toBeVisible();
  await expect(card('Skills').getByText('Sweep report')).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Timeline' });
  await expect(timeline).toContainText('Trained 4 rounds and kept 3 changes');
  await expect(timeline).toContainText('Trained 6 rounds and kept 3 changes');
  await expect(timeline).toContainText(`“${SWEEP_EXPERIMENT.input.name}”`);
  const text = await page.locator('main').innerText();
  expect(text).not.toMatch(/academ/i);
  await capture('lab-science-field-dark.png');
  await page
    .getByRole('region', { name: 'Timeline' })
    .evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await capture('lab-science-timeline-dark.png');

  await tab('Organizations').click();
  const orgs = card('Organizations');
  await expect(orgs.getByRole('button', { name: /Halden Lab/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(orgs.getByRole('button', { name: /Fennick Research/ })).toContainText('Never seen');
  await expect(card('Halden Lab').getByText('metrics.csv')).toBeVisible();
  await capture('lab-science-orgs-dark.png');

  await goTo(page, `/fields/${LAB.assayDeskJob}`);
  await expect(page.getByRole('heading', { name: 'Assay desk', level: 1 })).toBeVisible();
});

test('Models lists Sweep desk with a version from each run', async () => {
  await installModelsFake(launched.app);
  await openAt('/models');
  const models = page.getByRole('table', { name: 'Models' });
  const active = models.getByRole('row', { name: /^Sweep desk\s+version 2/ });
  await expect(active).toContainText('92%');
  await expect(active).toContainText('77%');
  await expect(active).toContainText('Active');
  await expect(models.getByRole('row', { name: /^Sweep desk\s+version 1/ })).toContainText('81%');
});

test('the experiment on Sweep desk reads like a short paper', async () => {
  await installExperimentsFake(
    launched.app,
    sweepComparison(await recordedComparisonReport()),
    undefined,
    [SWEEP_EXPERIMENT],
  );
  await openAt('/experiments');
  await page
    .getByRole('table', { name: 'Experiments' })
    .getByRole('row', { name: new RegExp(SWEEP_EXPERIMENT.input.name) })
    .click();
  await expect(page).toHaveURL(new RegExp(`#/experiments/${SWEEP_EXPERIMENT.id}$`));
  const plot = page.getByRole('figure', { name: /Final-test pass rate, Hosted/ });
  await expect(plot.getByRole('group', { name: 'Organizations it was taught on' })).toBeVisible();
  await expect(plot.getByRole('group', { name: 'Fennick Research, never seen' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Paired comparisons' })).toContainText(
    'Targeted mentoring vs Glimmer alone',
  );
  await capture('lab-science-experiment-dark.png');
});
