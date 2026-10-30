import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { installModelsFake, MODELS } from './fixtures-models';

/*
 * Models against a stand-in engine: the registry of every agent and version with its scores on
 * organizations seen, unseen and real and on its check tasks, filtered and searched; a model's
 * panel with its report, lineage and promotion; and two versions compared skill by organization
 * with the harness diff between them.
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
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

async function openModels(): Promise<void> {
  await installModelsFake(launched.app);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, '/models');
}

const table = () => page.getByRole('table', { name: 'Models' });
const row = (name: RegExp) => table().getByRole('row', { name });
const panel = () => page.getByRole('complementary', { name: 'Model' });

test('lists every agent and version with its scores, and filters and searches them', async () => {
  await openModels();
  await expect(row(/Phil Mini/)).toBeVisible();
  // Three agents, seven versions, under a header of two rows.
  await expect(table().getByRole('row')).toHaveCount(9);
  await expect(table().getByRole('columnheader', { name: 'Final test' })).toBeVisible();

  // Phil's active version: seen, unseen and real apart, and its check tasks on their own.
  const phil = row(/^Phil\s+version 2/);
  await expect(phil).toContainText('Phil');
  await expect(phil).toContainText('Glimmer · 4-bit');
  await expect(phil).toContainText('61b8a9d');
  await expect(phil).toContainText('93%');
  await expect(phil).toContainText('83%');
  await expect(phil).toContainText('90%');
  await expect(phil).toContainText('89%');
  await expect(phil).toContainText('Active');

  // The service desk's imported version took no final test: its scores are absent, not zero.
  const imported = row(/Service desk\s+version 4/);
  await expect(imported).toContainText('Candidate');
  await expect(imported).not.toContainText('0%');
  await expect(imported.getByText('None').first()).toBeAttached();
  await expect(row(/Service desk\s+version 2/)).toContainText('Adapter');
  await capture('models-dark.png');

  await page.getByRole('radio', { name: 'Candidates' }).click();
  await expect(table().getByRole('row')).toHaveCount(4);
  await page.getByRole('radio', { name: 'Imported' }).click();
  await expect(table().getByRole('row')).toHaveCount(3);
  await page.getByRole('radio', { name: 'All' }).click();

  await page.getByRole('searchbox', { name: 'Search models' }).fill('8-bit');
  await expect(table().getByRole('row')).toHaveCount(3);
  await expect(row(/Phil Mini/)).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search models' }).fill('');

  // Sorted by name; the unseen column sorts with unmeasured versions last either way.
  await table().getByRole('button', { name: 'Unseen' }).click();
  await expect(table().getByRole('row').nth(2)).toContainText('Phil');
  await table().getByRole('button', { name: 'Unseen' }).click();
  await expect(table().getByRole('row').nth(2)).toContainText('Phil Mini');
  await expect(table().getByRole('row').last()).toContainText('Service desk');
});

test("opens a model's panel with its report and lineage, and promotes a candidate", async () => {
  await openModels();
  await row(/^Phil\s+version 2/).click();
  await expect(panel().getByRole('heading', { name: /Phil/ })).toBeVisible();
  const finalTest = panel().getByRole('region', { name: 'Final test' });
  await expect(finalTest).toContainText('Seen');
  await expect(finalTest).toContainText('67/72');
  await expect(panel()).toContainText('Check tasks');
  await expect(panel()).toContainText('71/80');
  await expect(panel().getByRole('button', { name: 'Export' })).toBeVisible();
  await capture('model-panel-dark.png');

  await panel().getByRole('tab', { name: 'Lineage' }).click();
  await expect(panel().getByRole('region', { name: 'What changed' })).toContainText(
    'Changed its instructions and 1 skill.',
  );
  await expect(panel()).toContainText('Pick hints from the catalog, never write them');
  await expect(panel().getByRole('region', { name: 'History' })).toContainText('Made active');
  await panel()
    .getByRole('button', { name: /Version 1\s*Experimental/ })
    .click();
  await expect(row(/^Phil\s+version 1/)).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('Escape');
  await expect(panel()).toBeHidden();

  // The service desk's candidate is promoted through the same confirmation as in its settings.
  await row(/Service desk\s+version 3/).click();
  await panel().getByRole('tab', { name: 'Report' }).click();
  await panel().getByRole('button', { name: 'Use this version' }).click();
  const dialog = page.getByRole('dialog', { name: 'Use version 3?' });
  await expect(dialog).toContainText('fell short on its final test');
  await dialog.getByRole('button', { name: 'Use version 3' }).click();
  await expect(dialog).toBeHidden();
  await expect(row(/Service desk\s+version 3/)).toContainText('Active');
  await expect(row(/Service desk\s+version 2/)).toContainText('Kept');
  const calls = await launched.app.evaluate(
    () =>
      (
        globalThis as typeof globalThis & {
          modelCalls?: { channel: string; args: unknown[] }[];
        }
      ).modelCalls ?? [],
  );
  expect(calls.filter((call) => call.channel !== 'graduates:report').map((c) => c.channel)).toEqual(
    expect.arrayContaining(['graduates:acceptVersion', 'graduates:promote']),
  );
  expect(calls.find((call) => call.channel === 'graduates:promote')?.args).toEqual([
    MODELS.deskId,
    3,
  ]);
});

test('compares two versions skill by organization, with the harness diff between them', async () => {
  await openModels();
  await row(/^Phil\s+version 2/).click();
  await panel().getByRole('button', { name: 'Compare' }).click();
  await page.getByRole('menuitem', { name: 'Phil v1' }).click();

  await expect(page.getByRole('heading', { name: 'Compare', level: 1 })).toBeVisible();
  const grid = page.getByRole('table', { name: 'Final test by skill and organization' });
  await expect(grid.getByRole('columnheader', { name: 'Never seen, real' })).toBeVisible();
  // First hint at Northside Prep: 2 of 4, then 3 of 4.
  await expect(
    grid.getByLabel('First hint at Northside Prep, 2 of 4 then 3 of 4, +25 points'),
  ).toBeVisible();
  // The real academy never tests a hint: no cell compares there.
  await expect(
    grid.getByLabel('First hint at Real academy, not measured on the same tasks'),
  ).toBeVisible();
  // The check tasks stand apart from the final test, with each version's own result.
  const versions = page.getByRole('table', { name: 'Versions' });
  await expect(versions.getByRole('row', { name: /Check tasks/ })).toContainText('64/80');
  await expect(versions.getByRole('row', { name: /Check tasks/ })).toContainText('71/80');
  const harness = page.getByRole('region', { name: 'Harness' });
  await expect(harness).toContainText('Changed its instructions and 1 skill.');
  await expect(
    harness.getByRole('article', { name: 'skills/assign/SKILL.md, added' }),
  ).toBeVisible();
  await capture('models-compare-dark.png');

  // Two agents of one field compare too; versions tested elsewhere say they can't.
  await page.getByRole('combobox', { name: 'After' }).click();
  await page.getByRole('option', { name: 'Phil Mini v1' }).click();
  await expect(grid.getByLabel(/First hint at Northside Prep, 2 of 4 then 4 of 4/)).toBeVisible();
  await page.getByRole('button', { name: 'All models' }).click();

  await row(/Service desk\s+version 4/).click();
  await panel().getByRole('button', { name: 'Compare' }).click();
  await page.getByRole('menuitem', { name: 'Service desk v2' }).click();
  await expect(page.getByRole('region', { name: 'Final test' })).toContainText(
    'One of them took no final test.',
  );
});
