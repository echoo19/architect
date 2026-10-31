import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DraftTurn, Job } from '@architect/shared';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubFields } from './fixtures-fields';
import { recordedCalls, stubRecorded, stubSequence } from './fixtures-flow';
import { job } from './story';

/*
 * A field made from several organizations' folders (decision 083), in Architect Lab, against the
 * stand-in engine: New field opens Describe ready for the organizations, each folder is added and
 * named, taught on or never seen, and the description goes to the engine with them. The personal
 * edition offers none of it.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const FOLDERS = ['D:/Group/acme_outfitters', 'D:/Group/birch-supply', 'D:/Group/cedar goods'];
const DESCRIPTION = 'Answer staff questions about orders and customers at each of our shops.';

const FIELD_JOB: Job = {
  ...job,
  id: 'shop-desk',
  name: 'Shop desk',
  organizations: [
    { id: 'acme-outfitters', name: 'Acme Outfitters', synthetic: false, role: 'train' },
    { id: 'birch-supply', name: 'Birch supply', synthetic: false, role: 'train' },
  ],
};

const DRAFTED: DraftTurn = { sessionId: 'drf_field', message: '', options: [], draft: FIELD_JOB };

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
  await stubSequence(
    launched.app,
    'files:pick',
    FOLDERS.map((folder) => [folder]),
  );
  await stubRecorded(launched.app, 'jobs:draftField', DRAFTED);
});

test.afterAll(async () => {
  await launched?.close();
});

const organizations = () => page.getByRole('region', { name: 'Organizations' });
const role = (name: string) =>
  organizations().getByRole('radiogroup', { name: `What ${name} is to the agent` });

test('New field opens Describe ready for each organization’s folder', async () => {
  await goTo(page, '/fields');
  await page.getByRole('button', { name: 'New field' }).click();
  await expect(page.getByRole('heading', { name: 'What should your agent do?' })).toBeVisible();
  await expect(organizations()).toBeVisible();
  // The files come from the folders, so there is no paperclip, and no other way in to choose.
  await expect(page.getByRole('button', { name: 'Attach files' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Import a job file' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Describe the job' })).toHaveAttribute(
    'placeholder',
    'Describe the job once, for every organization',
  );
});

test('describes the job once, then adds each folder, named, taught on or never seen', async () => {
  await page.getByRole('textbox', { name: 'Describe the job' }).fill(DESCRIPTION);
  const add = organizations().getByRole('button', { name: 'Add organization' });
  for (let index = 0; index < FOLDERS.length; index += 1) await add.click();
  const names = organizations().getByRole('textbox', { name: 'Organization name' });
  await expect(names).toHaveCount(3);
  // A folder's name is the first name of its organization, and can be changed.
  await expect(names.nth(0)).toHaveValue('Acme outfitters');
  await expect(names.nth(2)).toHaveValue('Cedar goods');
  await names.nth(0).fill('Acme Outfitters');

  // The first is taught on; the person marks the second as taught on too.
  await expect(role('Acme Outfitters').getByRole('radio', { name: 'Taught on' })).toBeChecked();
  await expect(role('Birch supply').getByRole('radio', { name: 'Never seen' })).toBeChecked();
  await role('Birch supply').getByRole('radio', { name: 'Taught on' }).click();
  await expect(role('Cedar goods').getByRole('radio', { name: 'Never seen' })).toBeChecked();

  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({
    path: join(OUT_DIR, 'new-field-orgs-dark.png'),
    animations: 'disabled',
    timeout: 15_000,
  });
});

test('sends the description once, with every organization and its role', async () => {
  await page.getByRole('textbox', { name: 'Describe the job' }).press('Enter');
  await expect(page.getByRole('button', { name: 'Review the job' })).toBeVisible();
  expect(await recordedCalls(launched.app, 'jobs:draftField')).toEqual([
    [
      DESCRIPTION,
      [
        { name: 'Acme Outfitters', folder: FOLDERS[0], role: 'train' },
        { name: 'Birch supply', folder: FOLDERS[1], role: 'train' },
        { name: 'Cedar goods', folder: FOLDERS[2], role: 'transfer' },
      ],
    ],
  ]);
});

test('the personal edition offers no field of several organizations', async () => {
  await updateSettings(page, { edition: 'personal' });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, '/new');
  await expect(page.getByRole('heading', { name: 'What should your agent do?' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import a job file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Several organizations' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Organizations' })).toHaveCount(0);
});
