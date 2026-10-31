import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { SAMPLE_ENGINE, stubEngine } from './fixtures';
import { stubAttempts, stubFieldTasks, stubHarnessFiles, TUTOR_TASKS } from './fixtures-browse';
import { stubFields } from './fixtures-fields';
import { LAB } from './fixtures-lab';
import { installModelsFake } from './fixtures-models';
import { roundDiff, STORY, trace } from './story';

/*
 * Browsing as a developer (decision 084), against the stand-in engine: a field's tasks by type
 * and organization with the sealed splits counted only, every practice and check attempt of a
 * run with filters, and the files of a harness version in the Models panel and the round drawer.
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

/** Captures the window, or only the part named, such as a panel. */
async function capture(file: string, part?: Locator): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  const options = { path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 } as const;
  await (part ? part.screenshot(options) : page.screenshot(options));
}

async function openAt(path: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

const calls = (name: string) =>
  launched.app.evaluate(
    (_electron, name) => (globalThis as unknown as Record<string, unknown[][]>)[name] ?? [],
    name,
  );

test("browses a field's practice and check tasks, with the sealed splits counted only", async () => {
  await stubFields(launched.app);
  await stubFieldTasks(launched.app);
  await openAt(`/fields/${LAB.tutorJob}`);
  await expect(page.getByRole('heading', { name: 'Tutor', level: 1 })).toBeVisible();
  await page.getByRole('tab', { name: 'Tasks' }).click();

  const practice = page.getByRole('table', { name: 'Practice tasks' });
  await expect(practice.getByRole('row')).toHaveCount(TUTOR_TASKS.train.length + 1);
  await expect(
    page.getByRole('radio', { name: `Practice ${TUTOR_TASKS.train.length}` }),
  ).toBeVisible();
  // The final test and the calibration tasks are counts behind a lock, never rows.
  await expect(page.getByText('Final test 72 tasks')).toBeVisible();
  await expect(page.getByText('Calibration 12 tasks')).toBeVisible();
  await capture('field-tasks-dark.png');

  await page.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: 'First hint' }).click();
  await expect(practice.getByRole('row')).toHaveCount(7);
  await page.getByRole('combobox', { name: 'Organization' }).click();
  await page.getByRole('option', { name: 'Lakeview Academy' }).click();
  await expect(practice.getByRole('row')).toHaveCount(3);

  await page.getByRole('radio', { name: /^Check/ }).click();
  const check = page.getByRole('table', { name: 'Check tasks' });
  await expect(check.getByRole('row')).toHaveCount(2);
  await check.getByRole('row').nth(1).click();
  const panel = page.getByRole('dialog');
  await expect(panel).toContainText('First hint · Lakeview Academy · Check task');
  await expect(panel.getByRole('region', { name: 'Request' })).toContainText(
    "Which first hint does Lakeview Academy's catalog give for that error?",
  );
  await expect(panel.getByRole('region', { name: 'Expected answer' })).toContainText('"error"');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // Only the practice and check splits are asked for their tasks; the others answer a count.
  const asked = await calls('taskCalls');
  expect(new Set(asked.map(([, split]) => split))).toEqual(
    new Set(['train', 'dev', 'calibration', 'test']),
  );
  await expect(page.locator('body')).not.toContainText('test-');
});

test('opens every practice and check attempt of a run from Latest attempts, filtered and paged', async () => {
  await stubEngine(launched.app, {
    ...SAMPLE_ENGINE,
    'runs:trace': trace,
    'runs:roundDiff': roundDiff,
  });
  await stubAttempts(launched.app);
  await stubHarnessFiles(launched.app);
  await openAt(`/runs/${STORY.runId}/train`);

  const latest = page.getByRole('region', { name: 'Latest attempts' });
  await latest.getByRole('button', { name: 'Show all' }).click();
  const sheet = page.getByRole('dialog', { name: 'Attempts' });
  await expect(sheet).toContainText('60 practice and check attempts');
  const rows = sheet.getByRole('list', { name: 'Attempts' }).getByRole('listitem');
  await expect(rows).toHaveCount(50);
  await sheet.getByRole('button', { name: 'Show more' }).click();
  await expect(rows).toHaveCount(60);
  await expect(sheet.getByRole('button', { name: 'Show more' })).toBeHidden();

  await sheet.getByRole('combobox', { name: 'Verdict' }).click();
  await page.getByRole('option', { name: 'Failed', exact: true }).click();
  await expect(rows).toHaveCount(20);
  await sheet.getByRole('combobox', { name: 'Round' }).click();
  await page.getByRole('option', { name: 'Round 4' }).click();
  await expect(rows).toHaveCount(5);
  await expect(sheet).toContainText('5 practice and check attempts');
  await capture('attempts-sheet-dark.png');

  // A row opens the attempt's trace, and Back returns to the list as it was.
  await rows.first().getByRole('button').click();
  const traced = page.getByRole('dialog', { name: /Book the earliest licensed electrician/ });
  await expect(traced).toBeVisible();
  await traced.getByRole('button', { name: 'Back' }).click();
  await expect(rows).toHaveCount(5);

  const queries = (await calls('attemptCalls')).map(([, query]) => query);
  expect(queries).toContainEqual({ passed: false, round: 4 });
  expect(queries).toContainEqual({ cursor: '50' });
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();

  // A round's change sits beside the version's whole files.
  const rounds = page.getByRole('region', { name: 'Rounds' });
  await rounds.getByRole('button', { name: /Cents, not dollars/ }).click();
  const drawer = page.getByRole('dialog', { name: 'Round 3: Cents, not dollars' });
  const changed = drawer.getByRole('region', { name: 'What changed' });
  await changed.getByRole('button', { name: 'Details' }).click();
  await expect(changed.getByText('Work in integer cents from start to finish.')).toBeVisible();
  await changed.getByRole('radio', { name: 'Files' }).click();
  await expect(changed.getByRole('list', { name: 'Files' })).toContainText('price-a-job');
  await expect(changed.getByRole('article', { name: 'AGENTS.md' })).toContainText(
    'Answer from the office files in data/.',
  );
  await page.keyboard.press('Escape');
});

test("reads a version's harness files in the Models panel, beside what changed", async () => {
  await installModelsFake(launched.app);
  await stubHarnessFiles(launched.app);
  await openAt('/models');
  const table = page.getByRole('table', { name: 'Models' });
  await table.getByRole('row', { name: /Service desk\s+version 2/ }).click();
  const panel = page.getByRole('complementary', { name: 'Model' });
  await panel.getByRole('tab', { name: 'Files' }).click();
  const tree = panel.getByRole('list', { name: 'Files' });
  await expect(tree).toContainText('AGENTS.md');
  await expect(tree).toContainText('travel_minutes.js');
  await tree.getByRole('button', { name: 'SKILL.md' }).last().click();
  await expect(panel.getByRole('article', { name: 'skills/price-a-job/SKILL.md' })).toContainText(
    'Keep every amount in cents until the total.',
  );
  await capture('harness-files-dark.png', panel);

  await panel.getByRole('radio', { name: 'Changes' }).click();
  await expect(panel.getByRole('article', { name: 'AGENTS.md, changed' })).toBeVisible();
  // Nothing here edits a file: the tree and the lines are read-only.
  await expect(panel.getByRole('textbox')).toHaveCount(0);
});

test("leaves the personal edition's Train screen as it was", async () => {
  await updateSettings(page, { edition: 'personal' });
  // No agent yet, so the personal home doesn't open its chat over the run.
  await stubEngine(launched.app, {
    ...SAMPLE_ENGINE,
    'graduates:list': [],
    'workspace:listChats': [],
    'runs:roundDiff': roundDiff,
  });
  await openAt(`/runs/${STORY.runId}/train`);
  const latest = page.getByRole('region', { name: 'Latest attempts' });
  await expect(latest.getByRole('button').first()).toBeVisible();
  await expect(latest.getByRole('button', { name: 'Show all' })).toHaveCount(0);
  await page
    .getByRole('region', { name: 'Rounds' })
    .getByRole('button', { name: /Cents, not dollars/ })
    .click();
  const changed = page
    .getByRole('dialog', { name: 'Round 3: Cents, not dollars' })
    .getByRole('region', { name: 'What changed' });
  await changed.getByRole('button', { name: 'Details' }).click();
  await expect(changed.getByText('Work in integer cents from start to finish.')).toBeVisible();
  await expect(changed.getByRole('radio', { name: 'Files' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await updateSettings(page, { edition: 'lab' });
});
