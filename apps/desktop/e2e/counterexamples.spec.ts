import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import { DESK_COUNTEREXAMPLE } from './fixtures-counterexamples';
import { stubFields } from './fixtures-fields';
import { FLOW, FLOW_ENGINE } from './fixtures-flow';
import { LAB } from './fixtures-lab';

/*
 * Counterexample-guided repair (decision 078) against the stand-in engine: a round's drawer shows
 * the failing helper call cut down to the rows it still fails on, the failure in plain words and
 * the repair that passed it; Fields › Assets counts and lists the field's counterexamples.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;
let page: Page;

test.beforeAll(async () => {
  launched = await launchApp();
  page = launched.page;
  const visible = await launched.app.evaluate(({ BrowserWindow }) => {
    const [main] = BrowserWindow.getAllWindows();
    if (!main) throw new Error('No window');
    main.setContentSize(1440, 1000);
    return main.isVisible();
  });
  expect(visible).toBe(false);
  await mkdir(OUT_DIR, { recursive: true });
  await updateSettings(page, { onboarded: true, edition: 'lab' });
});

test.afterAll(async () => {
  await launched?.close();
});

test("shows a round's counterexample: the reduction, the failure, the case and the repair", async () => {
  await stubEngine(launched.app, {
    ...FLOW_ENGINE,
    'mentoring:counterexamples': [DESK_COUNTEREXAMPLE],
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, `/runs/${FLOW.runId}/train`);
  await page
    .getByRole('region', { name: 'Rounds' })
    .getByRole('button', { name: /Allow for zone travel time/ })
    .click();
  const drawer = page.getByRole('dialog', { name: /^Round 4/ });
  await expect(drawer).toBeVisible();

  const section = drawer.getByRole('region', { name: 'Counterexample' });
  await expect(section).toContainText('1,212 rows');
  await expect(section.getByRole('img', { name: 'reduced to' })).toBeVisible();
  await expect(section).toContainText('1 row');
  await expect(section).toContainText('1-minimal');
  await expect(section).toContainText(
    'travel_minutes stops with the error "no travel time from Harbor to North".',
  );
  await expect(section).toContainText('travel_minutes({"from_zone":"Harbor","to_zone":"North"})');
  const table = section.getByRole('table', { name: 'travel.csv' });
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table).toContainText('North');
  await expect(section).toContainText('Repaired in round 4: passed 2 cases');
  await section.getByRole('button', { name: 'Cases' }).click();
  await expect(section).toContainText('Original attempt');
  await expect(section).toContainText('No longer stops with');

  await section.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, 'counterexample-dark.png'),
    animations: 'disabled',
    timeout: 15_000,
  });
});

test("counts and lists a field's counterexamples in its assets", async () => {
  await stubFields(launched.app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, `/fields/${LAB.tutorJob}`);
  await page.getByRole('tab', { name: 'Assets' }).click();
  const card = page.getByRole('region', { name: 'Counterexamples' });
  await expect(card).toContainText('2');
  await expect(card).toContainText(
    'question_lookup stops with the error "test position not found"',
  );
  await expect(card).toContainText('copperfield-diagnose-03 · round 2');
  await expect(card).toContainText('2,312 rows');
  await expect(card).toContainText('4 rows');
  await expect(card.getByRole('img', { name: 'Repaired', exact: true })).toHaveCount(1);
  await expect(card).toContainText('history_calc gives correct 3 where the checker expects 4');
  await expect(card.getByRole('img', { name: 'Not repaired yet' })).toHaveCount(1);
});
