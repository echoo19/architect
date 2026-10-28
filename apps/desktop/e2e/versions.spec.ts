import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { WorkspaceChat, WorkspaceMessage } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { ENGINE_RESTARTING, stubEngineFailure } from './fixtures';
import {
  AGENT_WITH_VERSIONS,
  exportReview,
  FOLDERS,
  installation,
  installPackagesFake,
  PACKAGES,
  queuePicks,
  VERSIONS,
} from './fixtures-versions';
import {
  AGENT,
  CHATS,
  callsTo,
  engineSeed,
  installFakeEngine,
  MESSAGES,
} from './fixtures-workspace';
import { AT } from './story';

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];

/** A reply whose allowed change couldn't be saved: it waits for the user to try again. */
const UNSAVED_CHAT: WorkspaceChat = {
  id: 'cht_unsaved',
  graduateId: AGENT.id,
  title: 'Invoice the Cedar Ave job',
  createdAt: AT,
  updatedAt: AT,
  running: true,
  waiting: true,
};

const UNSAVED_MESSAGES: WorkspaceMessage[] = [
  {
    id: 'msg_unsaved_1',
    chatId: UNSAVED_CHAT.id,
    role: 'user',
    createdAt: AT,
    text: 'Invoice the panel repair at 8 Cedar Ave.',
    steps: [],
    blocks: [],
    status: 'done',
  },
  {
    id: 'msg_unsaved_2',
    chatId: UNSAVED_CHAT.id,
    role: 'agent',
    createdAt: AT,
    text: 'The invoice comes to $612.40. I need to save it to invoices.csv.',
    steps: [
      {
        id: 's1',
        kind: 'tool',
        name: 'read',
        detail: 'data/invoices.csv',
        meta: '5 rows',
        status: 'done',
        view: {
          kind: 'table',
          columns: ['invoice', 'job', 'customer', 'total'],
          rows: [
            ['INV-4467', 'J-4467', 'Brennan', '$310.00'],
            ['INV-4468', 'J-4468', 'Achebe', '$145.50'],
            ['INV-4469', 'J-4469', 'Okafor', '$524.03'],
            ['INV-4470', 'J-4470', 'Varga', '$98.00'],
            ['INV-4472', 'J-4472', 'Lindqvist', '$1,116.52'],
          ],
          total: 5,
        },
      },
      {
        id: 's2',
        kind: 'tool',
        name: 'invoice_total',
        detail: 'job J-4474',
        meta: '$612.40',
        status: 'done',
      },
      { id: 's3', kind: 'tool', name: 'append', detail: 'data/invoices.csv', status: 'running' },
    ],
    blocks: [
      {
        kind: 'approval',
        changeId: 'chg_unsaved',
        op: 'append',
        file: 'data/invoices.csv',
        summary: 'Add 1 row to data/invoices.csv',
        diff: {
          columns: ['invoice', 'job', 'customer', 'total'],
          added: [['INV-4474', 'J-4474', 'Mendes', '$612.40']],
          removed: [],
          changed: [],
        },
        status: 'pending',
        error:
          "The change couldn't be saved, so nothing was written: invoices.csv is open in another program.",
      },
    ],
    status: 'streaming',
    graduateVersion: 2,
  },
];

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
});

test.afterAll(async () => {
  await launched?.close();
});

async function capture(file: string): Promise<void> {
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

/** The fake engines for an agent with versions, the theme, then the app reloaded at `path`. */
async function open(theme: Theme, path: string): Promise<void> {
  await installFakeEngine(
    launched.app,
    engineSeed({
      graduates: [AGENT_WITH_VERSIONS],
      versions: VERSIONS,
      installation: installation(AGENT.id),
      chats: [...Object.values(CHATS), UNSAVED_CHAT],
      messages: [...MESSAGES, ...UNSAVED_MESSAGES],
    }),
  );
  await installPackagesFake(launched.app, {
    versions: VERSIONS,
    installation: installation(AGENT.id),
  });
  await updateSettings(page, { theme, onboarded: true });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await goTo(page, path);
}

const chatPath = (chatId: string) => `/agents/${AGENT.id}/chats/${chatId}`;

async function openSettingsTab(tab: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Service desk settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Service desk', exact: true });
  await dialog.getByRole('tab', { name: tab }).click();
  return dialog;
}

/** Opens Import agent from the sidebar's agent menu, with the pickers answering `picks`. */
async function startImport(picks: string[]): Promise<void> {
  await queuePicks(launched.app, picks);
  await page.getByRole('button', { name: 'Agent menu' }).click();
  await page.getByRole('menuitem', { name: 'Import agent' }).click();
  await expect(page).toHaveURL(/#\/import$/);
}

for (const theme of THEMES) {
  test(`promotes a candidate and rolls back, each after saying what changes (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id));
    const dialog = await openSettingsTab('Teaching');
    const versions = dialog.getByRole('list', { name: 'Versions' });
    await expect(versions.getByRole('listitem')).toHaveCount(4);
    const row = (number: number) => versions.getByRole('listitem', { name: `Version ${number}` });
    // One score for the agent wherever it shows: the versions list agrees with its settings.
    await expect(row(2)).toContainText('In use');
    await expect(row(2)).toContainText('95%');
    await expect(row(2)).toContainText('57 of 60 passed');
    await expect(row(3)).toContainText('New, not in use yet');
    await expect(row(3)).toContainText('Below its 90% target · from version 2');
    await expect(row(4)).toContainText('No final test yet · from version 2, imported');
    await expect(row(1)).toContainText('Earlier version');
    await expect(row(1)).toContainText('55 of 60 passed');
    await expect(dialog.getByRole('region', { name: 'Versions' })).toContainText('Final test');
    await expect(row(1).getByRole('button', { name: 'Go back to this version' })).toBeVisible();
    await expect(row(2).getByRole('button')).toHaveCount(0);
    await capture(`agent-teaching-${theme}.png`);

    // A version no final test measured can be used, after saying so.
    await row(4).getByRole('button', { name: 'Use this version' }).click();
    const unmeasured = page.getByRole('dialog', { name: 'Use version 4?' });
    await expect(unmeasured).toContainText("Version 4 hasn't taken a final test.");
    await capture(`agent-promote-unevaluated-${theme}.png`);
    await unmeasured.getByRole('button', { name: 'Cancel' }).click();
    await expect(unmeasured).toBeHidden();

    // One that fell short says by how much.
    await row(3).getByRole('button', { name: 'Use this version' }).click();
    const promote = page.getByRole('dialog', { name: 'Use version 3?' });
    await expect(promote).toContainText(
      'Version 3 fell short on its final test: 85% passed, 90% needed.',
    );
    await expect(promote).toContainText("New replies use version 3's setup and trained weights.");
    await expect(promote).toContainText('Version 2 stays, so you can go back to it.');
    await capture(`agent-promote-${theme}.png`);
    await promote.getByRole('button', { name: 'Use version 3' }).click();
    await expect(promote).toBeHidden();
    await expect(row(3)).toContainText('In use');
    await expect(row(2)).toContainText('Earlier version');
    expect(await callsTo(app, 'graduates:acceptVersion')).toEqual([[AGENT.id, 3]]);
    expect(await callsTo(app, 'graduates:promote')).toEqual([[AGENT.id, 3]]);

    await row(2).getByRole('button', { name: 'Go back to this version' }).click();
    const rollback = page.getByRole('dialog', { name: 'Go back to version 2?' });
    await expect(rollback).toContainText(
      "New replies use version 2's setup and trained weights again.",
    );
    await expect(rollback).toContainText('Version 3 stays, so you can use it again.');
    await capture(`agent-rollback-${theme}.png`);
    await rollback.getByRole('button', { name: 'Go back' }).click();
    await expect(rollback).toBeHidden();
    await expect(row(2)).toContainText('In use');
    await expect(row(3).getByRole('button', { name: 'Use this version' })).toBeVisible();
    expect(await callsTo(app, 'graduates:rollback')).toEqual([[AGENT.id, 2]]);
  });
}

for (const theme of THEMES) {
  test(`shows why the versions couldn't load, with a way to try again (${theme})`, async () => {
    await open(theme, chatPath(CHATS.closeout.id));
    await stubEngineFailure(launched.app, { 'graduates:versions': ENGINE_RESTARTING });
    const dialog = await openSettingsTab('Teaching');
    await expect(dialog.getByText("Couldn't load the versions")).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
    await capture(`agent-teaching-error-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`reviews an export: what goes in, what stays, the scan and the parts (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id));
    const dialog = await openSettingsTab('Export');
    const included = dialog.getByRole('region', { name: 'In the package' });
    await expect(included).toContainText('Service desk, version 2');
    const share = dialog.getByRole('switch', { name: 'Share the files in data/' });
    await expect(share).toHaveAttribute('aria-checked', 'false');
    const stays = dialog.getByRole('region', { name: 'Stays on this computer' });
    await expect(stays).toContainText('4 chats');
    await expect(stays).toContainText('API keys');
    await expect(
      dialog.getByText('Nothing in the package looks like a key or a private path'),
    ).toBeVisible();
    await expect(
      dialog.getByText('Trained weights may retain information from their training data'),
    ).toBeVisible();
    const exportPackage = dialog.getByRole('button', {
      name: 'Export service-desk-v2.architect.zip',
    });
    await expect(exportPackage).toBeEnabled();
    await capture(`agent-export-${theme}.png`);
    // Below what stays here: the setup, the trained weights and the report, each on its own.
    const parts = dialog.getByRole('region', { name: 'Export one part' });
    const tab = dialog.getByRole('tabpanel');
    await tab.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(parts.getByRole('button')).toHaveCount(3);
    await capture(`agent-export-parts-${theme}.png`);
    await tab.evaluate((element) => element.scrollTo({ top: 0 }));

    // Sharing the data folder is opt-in, and the scan's finding in it holds the export back.
    await share.click();
    await expect(dialog.getByText('1 line looks like a key or a private path')).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Findings' })).toContainText('data/policy.md:14');
    await expect(exportPackage).toBeDisabled();
    await expect(dialog.getByText('1 flagged line needs your OK')).toBeVisible();
    await dialog.getByRole('region', { name: 'Scan' }).scrollIntoViewIfNeeded();
    await capture(`agent-export-findings-${theme}.png`);
    await dialog.getByRole('checkbox', { name: 'Export anyway' }).click();
    await expect(dialog.getByText('1 flagged line needs your OK')).toBeHidden();
    await queuePicks(app, ['C:\\Users\\dana\\Exports']);
    await exportPackage.click();
    await expect(page.getByText('Exported Service desk', { exact: true })).toBeVisible();
    expect(await callsTo(app, 'graduates:exportPackage')).toEqual([
      [
        AGENT.id,
        {
          directory: 'C:\\Users\\dana\\Exports',
          include: ['resource:data'],
          acknowledgedFindings: exportReview(['resource:data']).findingsDigest,
        },
      ],
    ]);

    await queuePicks(app, ['C:\\Users\\dana\\Exports']);
    await dialog.getByRole('button', { name: 'Export the setup' }).click();
    await expect(page.getByText('Exported the setup', { exact: true })).toBeVisible();
    expect(await callsTo(app, 'graduates:exportPart')).toEqual([
      [
        AGENT.id,
        expect.objectContaining({ part: 'harness', directory: 'C:\\Users\\dana\\Exports' }),
      ],
    ]);
    await expect(dialog.getByRole('button', { name: 'Export the trained weights' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Export the results' })).toBeVisible();
  });
}

for (const theme of THEMES) {
  test(`says why an export couldn't be reviewed (${theme})`, async () => {
    await open(theme, chatPath(CHATS.closeout.id));
    await stubEngineFailure(launched.app, {
      'graduates:reviewExport': {
        message:
          "Version 2 of Service desk changed on disk after it was made, so it won't be exported.",
        code: 'version_modified',
      },
    });
    const dialog = await openSettingsTab('Export');
    // A version changed after it was made can't be tried again; the way out is an earlier one.
    await expect(dialog.getByText('This version was changed after it was made.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Try again' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'See earlier versions' })).toBeVisible();
    await capture(`agent-export-error-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`imports a package through its folders and permissions to a ready install (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id));
    await startImport([PACKAGES.ready, FOLDERS.records]);

    await expect(page.getByRole('heading', { level: 1, name: 'Returns desk' })).toBeVisible();
    await expect(page.getByText('returns-desk-v1.architect.zip')).toBeVisible();
    await expect(page.getByText("Evaluated on the author's computer")).toBeVisible();
    await expect(page.getByText('Passed: 56 of 60 (93%)')).toBeVisible();
    await expect(page.getByText('On this computer', { exact: true })).toBeVisible();
    await capture(`import-check-${theme}.png`);

    await page.getByRole('button', { name: 'Continue' }).click();
    const folders = page.getByRole('list', { name: 'Folders' });
    const data = folders.getByRole('listitem', { name: 'data/' });
    await expect(data).toContainText('Not chosen');
    await expect(data).toContainText('orders.csv, returns.csv, pickups.csv, policy.md');
    await data.getByRole('button', { name: 'Choose' }).click();
    await expect(data).toContainText('…\\Larchwood\\Records');
    await capture(`import-folders-${theme}.png`);

    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Choose what it may do' }),
    ).toBeVisible();
    const access = page.getByRole('radiogroup', { name: 'Access to data/' });
    // Nothing it asks for is granted until it is chosen here.
    await expect(access.getByRole('radio', { name: 'Not allowed' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await access.getByRole('radio', { name: 'Read and change' }).click();
    await expect(page.getByText('label_for')).toBeVisible();
    await capture(`import-permissions-${theme}.png`);

    await page.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Returns desk is ready' }),
    ).toBeVisible();
    await expect(page.getByText('Install checks on this computer')).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Install checks' }).getByRole('listitem'),
    ).toHaveCount(6);
    await capture(`import-ready-${theme}.png`);
    expect(await callsTo(app, 'graduates:importPackage')).toEqual([
      [
        PACKAGES.ready,
        {
          bindings: { data: FOLDERS.records },
          grants: { writes: 'ask', resources: { data: 'read_write' } },
          loadModel: true,
        },
      ],
    ]);

    await page.getByRole('button', { name: 'Start a chat' }).click();
    await expect(page).toHaveURL(/#\/agents\/grd_returns\/chats\/cht_imported_1$/);
    await expect(page.getByRole('navigation', { name: 'Agents' })).toContainText('Returns desk');
  });
}

for (const theme of THEMES) {
  test(`imports a package with trained weights, and offers to set up llama.cpp (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id));
    await startImport([PACKAGES.weights, FOLDERS.records]);

    await expect(page.getByRole('heading', { level: 1, name: 'Returns desk' })).toBeVisible();
    await expect(page.getByText('Needs llama.cpp for its trained weights')).toBeVisible();
    await expect(page.getByText("llama-server isn't installed, or isn't on PATH.")).toBeVisible();
    await expect(
      page.getByText('Downloaded through Ollama, the exact build its trained weights need'),
    ).toBeVisible();
    await capture(`import-check-weights-${theme}.png`);

    // Settings opens on Models, where llama.cpp is set up; closing it checks the package again.
    await page.getByRole('button', { name: 'Set up llama.cpp in Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings.getByRole('tab', { name: 'Models' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await expect.poll(async () => (await callsTo(app, 'graduates:previewImport')).length).toBe(2);

    await page.getByRole('button', { name: 'Continue' }).click();
    await page
      .getByRole('list', { name: 'Folders' })
      .getByRole('listitem', { name: 'data/' })
      .getByRole('button', { name: 'Choose' })
      .click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page
      .getByRole('radiogroup', { name: 'Access to data/' })
      .getByRole('radio', { name: 'Read and change' })
      .click();
    await page.getByRole('button', { name: 'Install', exact: true }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Returns desk needs attention' }),
    ).toBeVisible();
    const checks = page.getByRole('list', { name: 'Install checks' });
    await expect(checks).toContainText('llama.cpp');
    await expect(checks).toContainText("llama-server isn't installed");
    await expect(checks).toContainText(
      'muse-glimmer:30b, downloaded through Ollama, the exact build its trained weights need',
    );
    await expect(page.getByRole('button', { name: 'Set up llama.cpp in Settings' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
    await capture(`import-weights-attention-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`imports a package through its folders to a blocked install, with a way out (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id));
    await startImport([PACKAGES.blocked, FOLDERS.records]);
    await expect(page.getByRole('heading', { level: 1, name: 'Front desk' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page
      .getByRole('list', { name: 'Folders' })
      .getByRole('listitem', { name: 'data/' })
      .getByRole('button', { name: 'Choose' })
      .click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page
      .getByRole('radiogroup', { name: 'Access to data/' })
      .getByRole('radio', { name: 'Read and change' })
      .click();
    await page.getByRole('button', { name: 'Install', exact: true }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: "Front desk can't run" }),
    ).toBeVisible();
    const checks = page.getByRole('list', { name: 'Install checks' });
    await expect(checks).toContainText("Its tool lookup_order doesn't load");
    await expect(checks).toContainText('Not tried, since a check above failed');
    await expect(page.getByRole('button', { name: 'Start a chat' })).toHaveCount(0);
    await capture(`import-blocked-${theme}.png`);

    await page.getByRole('button', { name: 'Remove it from this computer' }).click();
    await expect(page).not.toHaveURL(/#\/import$/);
    expect(await callsTo(app, 'graduates:remove')).toEqual([['grd_front']]);
  });
}

for (const theme of THEMES) {
  test(`installs without a folder as needing attention, and fixes it from the result (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id));
    await startImport([PACKAGES.ready]);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    // A folder that wasn't chosen has nothing to allow yet.
    await expect(page.getByRole('radiogroup', { name: 'Access to data/' })).toHaveCount(0);
    await expect(page.getByText('No folder chosen').first()).toBeVisible();
    await page.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Returns desk needs attention' }),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: 'Install checks' })).toContainText(
      'Choose a folder for data/',
    );
    await capture(`import-attention-${theme}.png`);

    await queuePicks(app, [FOLDERS.records]);
    await page.getByRole('button', { name: 'Choose a folder for data/' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Returns desk is ready' }),
    ).toBeVisible();
    expect(await callsTo(app, 'graduates:bind')).toEqual([
      ['grd_returns', { bindings: { data: FOLDERS.records } }],
    ]);
  });
}

for (const theme of THEMES) {
  test(`says why an install failed, with a way to try again (${theme})`, async () => {
    await open(theme, chatPath(CHATS.closeout.id));
    await startImport([PACKAGES.ready]);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await stubEngineFailure(launched.app, {
      'graduates:importPackage':
        'There is not enough free disk space to install it (it needs 61 KB).',
    });
    await page.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(page.getByText("Couldn't install Returns desk")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
    await capture(`import-error-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`refuses a package that was changed, before any of it runs (${theme})`, async () => {
    await open(theme, chatPath(CHATS.closeout.id));
    await startImport([PACKAGES.broken]);
    await expect(
      page.getByRole('heading', { level: 1, name: "This package can't be imported" }),
    ).toBeVisible();
    await expect(page.getByRole('list', { name: 'Problems' })).toContainText(
      'harness/AGENTS.md has a different checksum',
    );
    await expect(page.getByText('Nothing in it was installed or run')).toBeVisible();
    await capture(`import-refused-${theme}.png`);
  });

  test(`asks for a package when Import opens without one (${theme})`, async () => {
    await open(theme, '/import');
    await expect(page.getByRole('heading', { name: 'Import an agent' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose a package' })).toBeVisible();
    await capture(`import-empty-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`shows an allowed change that couldn't be saved, and tries again (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(UNSAVED_CHAT.id));
    const card = page.getByRole('group', { name: 'Write to data/invoices.csv' });
    await expect(card.getByRole('alert')).toContainText(
      "couldn't be saved, so nothing was written: invoices.csv is open in another program.",
    );
    await expect(card).not.toContainText('Allowed');
    await expect(page.getByRole('status').filter({ hasText: 'Waiting for you' })).toBeVisible();
    await page.getByRole('button', { name: '3 steps so far' }).click();
    const steps = page.getByRole('list', { name: 'Steps' });
    await expect(steps).toContainText('5 rows');
    await expect(steps).toContainText('Answered by version 2');
    await capture(`workspace-unsaved-${theme}.png`);

    await card.getByRole('button', { name: 'Try again' }).click();
    await expect(card).toContainText('Allowed');
    expect(await callsTo(app, 'workspace:decide')).toEqual([['chg_unsaved', 'approve']]);
  });
}
