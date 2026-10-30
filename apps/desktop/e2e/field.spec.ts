import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Installation } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { SAMPLE, SAMPLE_ENGINE, stubEngine } from './fixtures';
import {
  FIELD_AGENT,
  FIELD_CAPABILITIES,
  FIELD_CHAT,
  FIELD_JOB,
  FIELD_MESSAGES,
  FIELD_REPORT,
  orgFolder,
} from './fixtures-field';
import { installation } from './fixtures-versions';
import { AGENT, CHATS, engineSeed, installFakeEngine } from './fixtures-workspace';

/*
 * Phil from a job with several organizations, against the stand-in engine: the report's skill by
 * organization grid, and the workspace naming the organization whose records it works on, with
 * one control to move it to another (decision 070).
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

async function reloadAt(path: string): Promise<void> {
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, path);
}

/**
 * Binding and the folder picker in the main process: each bind is kept, and the installation
 * read after it has the new folder.
 */
async function stubBinding(app: ElectronApplication, start: Installation): Promise<void> {
  await app.evaluate(({ ipcMain }, start) => {
    const state = globalThis as unknown as {
      fieldBinds: unknown[];
      fieldPick: string;
      fieldProblems: Record<string, string[]>;
    };
    let current = start;
    state.fieldBinds = [];
    state.fieldPick = '';
    state.fieldProblems = {};
    const handle = (channel: string, reply: (...args: never[]) => unknown) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_event, ...args: unknown[]) => ({
        ok: true,
        value: reply(...(args as never[])),
      }));
    };
    handle('graduates:installation', () => current);
    handle('files:pick', () => [state.fieldPick]);
    handle('graduates:checkFolder', (_id: string, _resource: string, folder: string) => ({
      problems: state.fieldProblems[folder] ?? [],
    }));
    handle('graduates:bind', (_id: string, request: { bindings: Record<string, string> }) => {
      state.fieldBinds.push(request);
      current = { ...current, bindings: { ...current.bindings, ...request.bindings } };
      return current;
    });
  }, start);
}

function picks(app: ElectronApplication, folder: string): Promise<void> {
  return app.evaluate((_electron, folder) => {
    (globalThis as unknown as { fieldPick: string }).fieldPick = folder;
  }, folder);
}

function lacks(app: ElectronApplication, folder: string, problems: string[]): Promise<void> {
  return app.evaluate(
    (_electron, { folder, problems }) => {
      (globalThis as unknown as { fieldProblems: Record<string, string[]> }).fieldProblems[folder] =
        problems;
    },
    { folder, problems },
  );
}

function binds(app: ElectronApplication): Promise<unknown[]> {
  return app.evaluate(() => (globalThis as unknown as { fieldBinds: unknown[] }).fieldBinds);
}

test('shows each skill at each organization, trained-with, never-seen and real apart', async () => {
  await stubEngine(launched.app, {
    ...SAMPLE_ENGINE,
    'graduates:list': [FIELD_AGENT],
    'jobs:get': FIELD_JOB,
    'reports:get': FIELD_REPORT,
    'mentoring:capabilities': FIELD_CAPABILITIES,
  });
  await reloadAt(`/runs/${SAMPLE.runId}/report`);

  // The headline is the academies it trained with; the ones it never saw are counted apart.
  await expect(
    page.getByText(
      'Tested on 72 new tasks from the organizations it trained with and 66 from 2 organizations it never saw',
      { exact: false },
    ),
  ).toBeVisible();
  await expect(page.getByText('67 of 72', { exact: true }).first()).toBeVisible();

  const grid = page.getByRole('table', { name: 'Final test by organization' });
  await expect(grid).toBeVisible();
  const groups = grid.getByRole('columnheader').filter({ hasText: /^(Taught on|Never seen.*)$/ });
  await expect(groups).toHaveText(['Taught on', 'Never seen', 'Never seen, real']);
  for (const name of [
    'Northside Prep',
    'Lakeview Academy',
    'Summit Tutoring',
    'Harbor Learning',
    'Real academy',
  ]) {
    await expect(grid.getByRole('columnheader', { name, exact: true })).toBeVisible();
  }
  const row = (skill: string) =>
    grid
      .getByRole('row')
      .filter({ has: page.getByRole('rowheader', { name: skill, exact: true }) });
  await expect(row('Diagnose a wrong answer').getByRole('cell')).toHaveText([
    '4/4',
    '4/4',
    '4/4',
    '5/6',
    '9/10',
  ]);
  // A skill the real academy's records can't check is left empty there, not scored zero.
  await expect(row('First hint').getByRole('cell')).toHaveText(['3/4', '4/4', '4/4', '5/6', '']);
  await expect(grid.getByLabel('First hint at Real academy, not tested')).toBeAttached();
  await expect(row('All skills').getByRole('cell')).toHaveText([
    '22/24',
    '22/24',
    '23/24',
    '30/36',
    '27/30',
  ]);

  // The practice, check and final-test columns stay as they were, by task type.
  await expect(page.getByRole('table', { name: 'Results by task type' })).toBeVisible();

  // The headline's figures at the top, the grid whole below them.
  await page.getByText('of new tasks right').evaluate((label) => {
    const figures = label.closest('.border-y') ?? label;
    let box = figures.parentElement;
    while (box && !/auto|scroll/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (!box) throw new Error('The report does not scroll.');
    box.scrollTop += figures.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
  });
  await capture('report-field-dark.png');
});

test('a report from a one-organization job has no organization grid', async () => {
  await stubEngine(launched.app, SAMPLE_ENGINE);
  await reloadAt(`/runs/${SAMPLE.runId}/report`);
  await expect(page.getByRole('table', { name: 'Results by task type' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Final test by organization' })).toHaveCount(0);
  await expect(page.getByText(/tasks it had never seen/)).toBeVisible();
});

test('names the organization it works on and moves it to another in one menu', async () => {
  const { app } = launched;
  const start = installation(FIELD_AGENT.id, {
    version: 1,
    bindings: { data: orgFolder('northside') },
  });
  await installFakeEngine(
    app,
    engineSeed({
      graduates: [FIELD_AGENT],
      chats: [FIELD_CHAT],
      messages: FIELD_MESSAGES,
      report: FIELD_REPORT,
      job: FIELD_JOB,
      installation: start,
    }),
  );
  await stubBinding(app, start);
  await reloadAt(`/agents/${FIELD_AGENT.id}/chats/${FIELD_CHAT.id}`);

  const control = page.getByRole('button', { name: /^Organization: / });
  await expect(control).toHaveAccessibleName('Organization: Northside Prep');

  // A folder that holds another academy's records is refused, and nothing is bound.
  await control.click();
  await picks(app, orgFolder('lakeview'));
  await page.getByRole('menuitem', { name: 'Harbor Learning' }).click();
  await expect(page.getByText("That folder holds Lakeview Academy's records")).toBeVisible();
  expect(await binds(app)).toEqual([]);
  await expect(control).toHaveAccessibleName('Organization: Northside Prep');

  // Its own folder binds the agent's records to it, and the header says so.
  await control.click();
  await picks(app, orgFolder('harbor'));
  await page.getByRole('menuitem', { name: 'Harbor Learning' }).click();
  await expect(control).toHaveAccessibleName('Organization: Harbor Learning');
  expect(await binds(app)).toEqual([{ bindings: { data: orgFolder('harbor') } }]);

  // Writes still ask, whichever organization it works on.
  await expect(page.getByRole('button', { name: 'Allow once' })).toBeVisible();

  await control.click();
  await expect(page.getByRole('menuitem', { name: 'Real academy' })).toBeVisible();
  await capture('workspace-org-dark.png');
  await page.keyboard.press('Escape');
});

test("works from an academy's own records, and says it wasn't tested there", async () => {
  const { app } = launched;
  const start = installation(FIELD_AGENT.id, {
    version: 1,
    bindings: { data: orgFolder('northside') },
  });
  await installFakeEngine(
    app,
    engineSeed({
      graduates: [FIELD_AGENT],
      chats: [FIELD_CHAT],
      messages: FIELD_MESSAGES,
      report: FIELD_REPORT,
      job: FIELD_JOB,
      installation: start,
    }),
  );
  await stubBinding(app, start);
  await reloadAt(`/agents/${FIELD_AGENT.id}/chats/${FIELD_CHAT.id}`);
  const control = page.getByRole('button', { name: /^Organization: / });
  await expect(control).toHaveAccessibleName('Organization: Northside Prep');

  // A folder without its attempts is refused, with what is missing, and nothing is bound.
  const broken = 'D:/Records/Maple Academy';
  await lacks(app, broken, [
    "attempts.csv isn't in the folder.",
    'students.csv has no tutor_id column.',
  ]);
  await picks(app, broken);
  await control.click();
  await page.getByRole('menuitem', { name: 'Another academy…' }).click();
  await expect(page.getByText("attempts.csv isn't in the folder.")).toBeVisible();
  await expect(page.getByText('students.csv has no tutor_id column.')).toBeVisible();
  expect(await binds(app)).toEqual([]);
  await expect(control).toHaveAccessibleName('Organization: Northside Prep');

  // A folder that fits is bound, named, and marked as untested; no report number is shown for it.
  const fitting = 'D:/Records/Maple Academy Fixed';
  await picks(app, fitting);
  await control.click();
  await page.getByRole('menuitem', { name: 'Another academy…' }).click();
  await expect(control).toHaveAccessibleName(
    'Organization: Maple Academy Fixed, not tested at this academy',
  );
  await expect(control).toContainText('Not tested at this academy');
  expect(await binds(app)).toEqual([{ bindings: { data: fitting } }]);
  await expect(page.getByRole('button', { name: 'Allow once' })).toBeVisible();
  await control.click();
  await expect(page.getByRole('menuitem', { name: 'Another academy…' })).toBeVisible();
  await capture('workspace-own-academy-dark.png');
  await page.keyboard.press('Escape');

  // Back to an academy it was tested at, and the label goes.
  await control.click();
  await picks(app, orgFolder('northside'));
  await page.getByRole('menuitem', { name: 'Northside Prep' }).click();
  await expect(control).toHaveAccessibleName('Organization: Northside Prep');
  await expect(control).not.toContainText('Not tested');
});

test('an agent from a one-organization job has no organization control', async () => {
  await installFakeEngine(launched.app, engineSeed());
  await reloadAt(`/agents/${AGENT.id}/chats/${CHATS.closeout.id}`);
  await expect(page.getByRole('textbox')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Organization: / })).toHaveCount(0);
});
