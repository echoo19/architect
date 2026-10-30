import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { DataPaths } from '@architect/engine';
import {
  addGraduate,
  FAKE_HUB_TOKEN,
  openEngineStore,
  SAMPLE_CONTENT,
  startFakeHub,
  type FakeHub,
} from '@architect/engine/testing';
import { LMSTUDIO_BASE_URL, type PublishProgress } from '@architect/shared';
import { goTo, launchApp, settle, type LaunchedApp } from './app';
import { stubEngine } from './fixtures';
import { startFakeOllama, type FakeOllama } from './models';

test.describe.configure({ mode: 'serial' });

/*
 * Publishing to Hugging Face and installing from it, on the real engine against the fake Hub
 * (packages/engine/test/support/fake-hub.ts), never the real one; then changing the installed
 * agent's model, with its checks run again. No model is ever loaded: the package names a base no
 * runtime has, and the model it moves to is a stand-in Ollama's.
 */

const AGENT = 'grd_desk';
const REPO = 'jake/service-desk';
const SECOND = 'jake/desk-two';
/** A base no Ollama has, so no check here can ever load a model, whatever runs on 11434. */
const ABSENT_BASE = 'architect-e2e-absent:1b';
/** The build the fixture's package was tested on, which the stand-in Ollama serves. */
const TESTED_BUILD = 'sha256:glimmer';

let hub: FakeHub;
let ollama: FakeOllama;
let launched: LaunchedApp;
let page: Page;
let folders: string;
/** The commit that holds the package published first. */
let packageCommit = '';

test.beforeAll(async () => {
  hub = await startFakeHub();
  ollama = await startFakeOllama([{ text: 'ready' }], {
    models: [{ name: 'service-base:30b', sizeBytes: 18 * 1024 ** 3, digest: TESTED_BUILD }],
  });
  folders = await mkdtemp(join(tmpdir(), 'architect-e2e-hub-'));
  launched = await launchApp({
    env: { HF_ENDPOINT: hub.url, HF_TOKEN: FAKE_HUB_TOKEN },
    settings: { onboarded: true },
    prepare: async (userData) => {
      const store = openEngineStore(new DataPaths(userData).database);
      try {
        await addGraduate(userData, store, {
          id: AGENT,
          baseUrl: 'http://127.0.0.1:9',
          baseModel: ABSENT_BASE,
        });
      } finally {
        store.close();
      }
    },
  });
  page = launched.page;
  await settle(page);
});

test.afterAll(async () => {
  await launched?.close();
  await ollama?.close();
  await hub?.close();
  await rm(folders, { recursive: true, force: true });
});

/** The agent's settings, on a tab. */
async function openSettingsTab(tab: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Service desk settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Service desk', exact: true });
  await dialog.getByRole('tab', { name: tab }).click();
  return dialog;
}

/** Publishing the agent's version 1 from the Export tab, with the repository typed in. */
async function publishTo(dialog: Locator, repository: string): Promise<void> {
  await dialog.getByRole('textbox', { name: 'Repository' }).fill(repository);
  await expect(dialog.getByRole('list', { name: 'Files' })).toContainText('graduate.json');
  await dialog.getByRole('button', { name: 'Publish version 1' }).click();
}

test('publishes to the Hub, private, through to the repository link and its commit', async () => {
  await goTo(page, '/');
  await page.evaluate(() => {
    const stages: PublishProgress['stage'][] = [];
    Object.assign(window, { publishStages: stages });
    window.architect.graduates.onPublishProgress((progress) => stages.push(progress.stage));
  });
  const dialog = await openSettingsTab('Export');
  await dialog.getByRole('radio', { name: 'Hugging Face' }).click();
  await expect(dialog.getByText('Uses HF_TOKEN from this computer')).toBeVisible();
  await expect(
    dialog.getByRole('radiogroup', { name: 'Visibility' }).getByRole('radio', { name: 'Private' }),
  ).toHaveAttribute('aria-checked', 'true');
  await publishTo(dialog, REPO);
  await expect(dialog.getByText('Version 1 is on Hugging Face')).toBeVisible({ timeout: 30_000 });

  const repository = hub.repos.get(REPO);
  expect(repository?.private).toBe(true);
  packageCommit = repository?.commits[0]?.sha ?? '';
  expect(packageCommit).toMatch(/^[0-9a-f]{40}$/);
  await expect(dialog.getByText(`Commit ${packageCommit.slice(0, 7)} · Private`)).toBeVisible();
  const link = `${hub.url.replace(/^https?:\/\//, '')}/${REPO}`;
  await expect(dialog.getByRole('button', { name: link })).toBeVisible();
  // The card came in a second commit, and names the package's.
  expect(hub.filesAt(REPO).get('README.md')?.toString('utf8')).toContain(
    `architect install hf://${REPO} --revision ${packageCommit}`,
  );
  await expect(dialog.getByRole('list', { name: 'Publications' })).toContainText(
    `Version 1 · commit ${packageCommit.slice(0, 7)}`,
  );
  const stages = await page.evaluate(
    () => (window as unknown as { publishStages: string[] }).publishStages,
  );
  expect([...new Set(stages)]).toEqual(['connecting', 'uploading', 'verifying', 'describing']);
  expect(await page.evaluate((id) => window.architect.graduates.publications(id), AGENT)).toEqual([
    expect.objectContaining({
      repository: REPO,
      status: 'complete',
      visibility: 'private',
      revision: packageCommit,
    }),
  ]);
  // The token went only to the Hub's own API.
  expect(hub.uploads.every((upload) => !upload.authorized)).toBe(true);
});

test('shows a failed upload as a failure, and publishing again finishes the same record', async () => {
  const dialog = page.getByRole('dialog', { name: 'Service desk', exact: true });
  hub.failNext(`/api/models/${SECOND}/commit/`, 500, 'The Hub is down for maintenance.');
  await publishTo(dialog, SECOND);
  await expect(dialog.getByText(`Couldn't publish version 1 to ${SECOND}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog.getByText(/Hugging Face answered with an error \(500\)/)).toBeVisible();
  await expect(dialog.getByText(/Try again in a few minutes/)).toBeVisible();
  await expect(dialog.getByText('Version 1 is on Hugging Face')).toHaveCount(0);
  const publications = () =>
    page.evaluate((id) => window.architect.graduates.publications(id), AGENT);
  const [failed] = (await publications()).filter((entry) => entry.repository === SECOND);
  expect(failed).toMatchObject({ status: 'failed' });
  expect(failed?.revision).toBeUndefined();
  await expect(
    dialog
      .getByRole('list', { name: 'Publications' })
      .getByRole('listitem', { name: `${SECOND}, version 1` }),
  ).toContainText("Didn't finish");

  await dialog.getByRole('button', { name: 'Finish publishing' }).click();
  await expect(dialog.getByText('Version 1 is on Hugging Face')).toBeVisible({ timeout: 30_000 });
  const finished = (await publications()).filter((entry) => entry.repository === SECOND);
  expect(finished).toEqual([
    expect.objectContaining({ id: failed?.id, status: 'complete', revision: expect.any(String) }),
  ]);
  await page.keyboard.press('Escape');
});

test('installs from the Hub by commit, through the same steps as a package file', async () => {
  // A clean computer: the agent that was published is gone from this one.
  await page.evaluate((id) => window.architect.graduates.remove(id), AGENT);
  await goTo(page, '/');
  const records = join(folders, 'records');
  await mkdir(records, { recursive: true });
  for (const [name, content] of Object.entries(SAMPLE_CONTENT)) {
    await writeFile(join(records, name), content, 'utf8');
  }
  // The system dialog is answered in main, so nothing appears on screen.
  await launched.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, records);

  await page.getByRole('button', { name: 'Agent menu' }).click();
  await page.getByRole('menuitem', { name: 'Install from Hugging Face' }).click();
  await expect(page).toHaveURL(/#\/import$/);
  await page.getByRole('textbox', { name: 'Hugging Face address' }).fill(`hf://${REPO}`);
  // A particular commit is rarely wanted, so its field waits under Advanced.
  await expect(page.getByRole('textbox', { name: 'Commit' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('textbox', { name: 'Commit' }).fill(packageCommit);
  await page.getByRole('button', { name: 'Download' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Service desk' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(`${REPO} · commit ${packageCommit.slice(0, 7)}`)).toBeVisible();
  await expect(page.getByText('Tested by its author')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  const recordsRow = page
    .getByRole('list', { name: 'Folders' })
    .getByRole('listitem', { name: 'Records folder' });
  await recordsRow.getByRole('button', { name: 'Choose' }).click();
  await expect(recordsRow).toContainText('records');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page
    .getByRole('radiogroup', { name: 'Access to the records folder' })
    .getByRole('radio', { name: 'Read and change' })
    .click();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(page.getByText('Works on this computer', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByRole('list', { name: 'Checks on this computer' })).toContainText(
    'Every folder is chosen and has its files',
  );

  // The version keeps the repository and the commit it came from; nothing else was fetched.
  const versions = await page.evaluate((id) => window.architect.graduates.versions(id), AGENT);
  expect(versions).toHaveLength(1);
  expect(versions[0]?.source).toMatchObject({
    kind: 'huggingface',
    repository: REPO,
    revision: packageCommit,
  });
  const installation = await page.evaluate(
    (id) => window.architect.graduates.installation(id),
    AGENT,
  );
  expect(installation.bindings).toEqual({ data: records });
  expect(installation.grants.resources['data']).toBe('read_write');
  expect(
    hub.requests.some(
      (request) => request.path.includes('/resolve/') && request.path.endsWith('README.md'),
    ),
  ).toBe(false);
  // The base it names isn't on this computer, so the result says so and leaving is "Not now".
  await expect(page.getByText("architect-e2e-absent:1b isn't downloaded yet")).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Not now' }).click();
});

test("changes the agent's model to one on this computer, and its checks run again", async () => {
  await stubEngine(launched.app, {
    'connections:detectLocal': {
      ollama: {
        running: true,
        version: '0.40.9',
        baseUrl: ollama.baseUrl,
        models: [{ id: 'service-base:30b', sizeBytes: 18 * 1024 ** 3 }],
      },
      lmstudio: { running: false, baseUrl: LMSTUDIO_BASE_URL, models: [] },
      gpu: null,
    },
  });
  // The models here were read before the stand-in answered for them.
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await goTo(page, '/');
  const before = await page.evaluate((id) => window.architect.graduates.installation(id), AGENT);
  expect(before.model.model).toBe(ABSENT_BASE);
  expect(before.status).toBe('needs_attention');

  const dialog = await openSettingsTab('General');
  await dialog.getByRole('button', { name: "Your agent's model" }).click();
  await page.getByRole('option', { name: /service-base:30b/ }).click();
  await expect(page.getByText('Changed the model of Service desk', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(dialog.getByText('All checks passed')).toBeVisible();

  const after = await page.evaluate((id) => window.architect.graduates.installation(id), AGENT);
  expect(after.model).toEqual({
    runtime: 'ollama',
    baseUrl: ollama.baseUrl,
    model: 'service-base:30b',
  });
  expect(after.checkedAt).not.toBe(before.checkedAt);
  expect(after.status).toBe('ready');
  expect(after.checks.find((check) => check.kind === 'model_available')).toMatchObject({
    status: 'passed',
    sameBuild: true,
  });
  // Choosing a model loads nothing: the stand-in was asked what it has, never to answer.
  expect(ollama.chats).toEqual([]);
});
