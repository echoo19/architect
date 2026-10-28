import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { OLLAMA_BASE_URL, type Installation, type Publication } from '@architect/shared';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine, stubEngineFailure } from './fixtures';
import {
  EARLIER_PUBLICATION,
  emitPublishProgress,
  EXACT_BUILD,
  HUB,
  installHubFake,
  isPublishing,
  otherBuildInstallation,
  settlePublish,
  uploading,
  type HubSeed,
} from './fixtures-hub';
import {
  AGENT_WITH_VERSIONS,
  FOLDERS,
  installation,
  installPackagesFake,
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

/*
 * Captures of the Hugging Face screens and the agent's model, in both themes, against stand-in
 * engines, as the versions screens are captured. The same flows run on the real engine against
 * the fake Hub in hub.spec.ts.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];

/** What a failed upload says, as the main process passes the engine's message and hint on. */
const UPLOAD_FAILED = 'Hugging Face answered with an error (503). Try again in a few minutes.';

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

/**
 * A screenshot once nothing is loading; or, for a publication on its way, which stays busy until
 * the test settles it, once its fonts are in.
 */
async function capture(file: string, busy = false): Promise<void> {
  await page.mouse.move(0, 0);
  if (busy) await page.evaluate(() => document.fonts.ready.then(() => undefined));
  else await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

interface OpenOptions {
  token?: HubSeed['token'];
  publications?: Publication[];
  installation?: Installation;
}

/** The stand-in engines, the theme, then the app reloaded at `path`. */
async function open(theme: Theme, path: string, options: OpenOptions = {}): Promise<void> {
  const active = options.installation ?? installation(AGENT.id);
  await installFakeEngine(
    launched.app,
    engineSeed({
      graduates: [AGENT_WITH_VERSIONS],
      versions: VERSIONS,
      installation: active,
      chats: Object.values(CHATS),
      messages: MESSAGES,
    }),
  );
  await installPackagesFake(launched.app, { versions: VERSIONS, installation: active });
  await installHubFake(launched.app, {
    token: options.token === undefined ? 'HF_TOKEN' : options.token,
    publications: options.publications ?? [],
    installation: active,
  });
  await stubEngine(launched.app, { 'secrets:status': { meta: true, openrouter: true } });
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

/** The Export tab, on Hugging Face. */
async function openPublishing(): Promise<Locator> {
  const dialog = await openSettingsTab('Export');
  await dialog.getByRole('radio', { name: 'Hugging Face' }).click();
  return dialog;
}

for (const theme of THEMES) {
  test(`publishes to Hugging Face: the review, its progress, the link and its commit (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id), { publications: [EARLIER_PUBLICATION] });
    const dialog = await openPublishing();
    // The repository it went to before, private, with every file that will go.
    await expect(dialog.getByRole('textbox', { name: 'Repository' })).toHaveValue(HUB.repository);
    const files = dialog.getByRole('list', { name: 'Files' });
    await expect(files).toContainText('adapter/adapter.gguf');
    await expect(files).toContainText('README.md');
    await expect(files).toContainText('Model card');
    await expect(dialog.getByText('Uses HF_TOKEN from this computer')).toBeVisible();
    await expect(
      dialog.getByText('Only accounts you allow on Hugging Face can see it'),
    ).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Publications' })).toContainText(
      `Version 1 · commit ${HUB.earlierCommit.slice(0, 7)}`,
    );
    await capture(`agent-publish-${theme}.png`);
    // Below the files: the scan, and where this agent was published before.
    const tab = dialog.getByRole('tabpanel');
    await tab.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(
      dialog.getByText('Nothing in these files looks like a key or a private path'),
    ).toBeVisible();
    await capture(`agent-publish-scan-${theme}.png`);
    await tab.evaluate((element) => element.scrollTo({ top: 0 }));

    await files.getByRole('button', { name: 'Preview' }).click();
    const card = page.getByRole('dialog', { name: 'Model card' });
    await expect(card.getByRole('heading', { name: 'Install and run' })).toBeVisible();
    await expect(card).toContainText(`architect install hf://${HUB.repository}`);
    await capture(`agent-publish-card-${theme}.png`);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();

    await dialog.getByRole('button', { name: 'Publish version 2' }).click();
    await expect.poll(() => isPublishing(app)).toBe(true);
    await emitPublishProgress(app, uploading(64 * 1024 ** 2));
    await expect(dialog.getByText('Sending the package')).toBeVisible();
    await expect(dialog.getByText('64 MB of 118 MB')).toBeVisible();
    await capture(`agent-publish-progress-${theme}.png`, true);
    // Closing the settings loses nothing: they open again on Hugging Face, still sending.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await openSettingsTab('Export');
    await expect(dialog.getByRole('radio', { name: 'Hugging Face' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(dialog.getByText('64 MB of 118 MB')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Publishing' })).toBeDisabled();

    await settlePublish(app, 'complete');
    await expect(dialog.getByText('Version 2 is on Hugging Face')).toBeVisible();
    await expect(dialog.getByText(`Commit ${HUB.commit.slice(0, 7)} · Private`)).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: `huggingface.co/${HUB.repository}` }),
    ).toBeVisible();
    await expect(
      dialog.getByText(`architect install hf://${HUB.repository} --revision ${HUB.commit}`),
    ).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Published', exact: true })).toBeDisabled();
    await capture(`agent-publish-done-${theme}.png`);
    expect(await callsTo(app, 'graduates:publish')).toEqual([
      [AGENT.id, { repository: HUB.repository, visibility: 'private' }],
    ]);
  });
}

for (const theme of THEMES) {
  test(`shows a failed publication as a failure, and publishes again (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id));
    const dialog = await openPublishing();
    await dialog.getByRole('textbox', { name: 'Repository' }).fill(HUB.repository);
    await expect(dialog.getByRole('list', { name: 'Files' })).toContainText('graduate.json');
    await dialog.getByRole('button', { name: 'Publish version 2' }).click();
    await expect.poll(() => isPublishing(app)).toBe(true);
    await settlePublish(app, 'failed', UPLOAD_FAILED);

    await expect(dialog.getByText(`Couldn't publish version 2 to ${HUB.repository}`)).toBeVisible();
    await expect(dialog.getByText(UPLOAD_FAILED)).toBeVisible();
    await expect(dialog.getByText('Version 2 is on Hugging Face')).toHaveCount(0);
    const publications = dialog.getByRole('list', { name: 'Publications' });
    await expect(publications).toContainText("Didn't finish");
    await expect(dialog.getByRole('button', { name: 'Finish publishing' })).toBeVisible();
    await capture(`agent-publish-failed-${theme}.png`);

    await dialog.getByRole('button', { name: 'Finish publishing' }).click();
    await expect.poll(() => isPublishing(app)).toBe(true);
    await settlePublish(app, 'complete');
    await expect(dialog.getByText('Version 2 is on Hugging Face')).toBeVisible();
    // The same publication, finished: one row for the version and the repository.
    await expect(publications.getByRole('listitem')).toHaveCount(1);
    await expect(publications).toContainText(`commit ${HUB.commit.slice(0, 7)}`);
  });
}

for (const theme of THEMES) {
  test(`asks for a repository and a token before it publishes (${theme})`, async () => {
    await open(theme, chatPath(CHATS.closeout.id), { token: null });
    const dialog = await openPublishing();
    await expect(dialog.getByRole('textbox', { name: 'Repository' })).toHaveValue('');
    await expect(
      dialog.getByText('Name the repository and add a token', { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText('No token', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Publish to Hugging Face' })).toBeDisabled();
    await capture(`agent-publish-empty-${theme}.png`);

    // The token is added in Settings, which opens at Models; the agent's settings close first.
    await dialog.getByRole('button', { name: 'Add in Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings.getByRole('tab', { name: 'Models' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(dialog).toBeHidden();
  });
}

for (const theme of THEMES) {
  test(`keeps the Hugging Face token beside the other keys, saying where it comes from (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id), { token: 'HF_TOKEN' });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await settings.getByRole('tab', { name: 'Models' }).click();
    const connections = settings.getByRole('region', { name: 'Connections' });
    await expect(connections).toContainText('Hugging Face');
    await expect(connections).toContainText('Uses HF_TOKEN from this computer');
    await connections.getByText('Hugging Face', { exact: true }).scrollIntoViewIfNeeded();
    await capture(`settings-hub-${theme}.png`);

    await connections.getByRole('button', { name: 'Add token' }).click();
    const add = page.getByRole('dialog', { name: 'Add a Hugging Face token' });
    await add
      .getByRole('textbox', { name: 'Hugging Face token' })
      .fill('hf_example_for_the_screen');
    await capture(`settings-hub-token-${theme}.png`);
    await add.getByRole('button', { name: 'Save' }).click();
    await expect(add).toBeHidden();
    await expect(connections).toContainText('Token saved');
    await expect(
      connections.getByRole('button', { name: 'Remove the Hugging Face token' }),
    ).toBeVisible();
    // Only the key's name is recorded, never what was typed.
    expect((await callsTo(app, 'secrets:set')).map(([ref]) => ref)).toEqual(['huggingface']);
  });
}

for (const theme of THEMES) {
  test(`installs from Hugging Face by commit, through the steps a package file takes (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id));
    await queuePicks(app, [FOLDERS.records]);
    await page.getByRole('button', { name: 'Agent menu' }).click();
    await page.getByRole('menuitem', { name: 'Install from Hugging Face' }).click();
    await expect(page).toHaveURL(/#\/import$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Install from Hugging Face' }),
    ).toBeVisible();
    await page.getByRole('textbox', { name: 'Repository' }).fill(HUB.returns);
    await page.getByRole('textbox', { name: 'Commit' }).fill(HUB.returnsCommit);
    await capture(`import-hub-${theme}.png`);

    await page.getByRole('button', { name: 'Download' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Returns desk' })).toBeVisible();
    await expect(
      page.getByText(`${HUB.returns} · commit ${HUB.returnsCommit.slice(0, 7)}`),
    ).toBeVisible();
    await expect(page.getByText("Evaluated on the author's computer")).toBeVisible();
    await capture(`import-hub-check-${theme}.png`);
    expect(await callsTo(app, 'graduates:installFromHub')).toEqual([
      [HUB.returns, { revision: HUB.returnsCommit, loadModel: false }],
    ]);

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
      page.getByRole('heading', { level: 1, name: 'Returns desk is ready' }),
    ).toBeVisible();
    await capture(`import-hub-ready-${theme}.png`);
    expect(await callsTo(app, 'graduates:bind')).toEqual([
      [
        'grd_returns',
        {
          bindings: { data: FOLDERS.records },
          grants: { writes: 'ask', resources: { data: 'read_write' } },
        },
      ],
    ]);
  });
}

for (const theme of THEMES) {
  test(`says why an install from Hugging Face failed, with a way back (${theme})`, async () => {
    await open(theme, chatPath(CHATS.closeout.id));
    // As main passes it on: the engine's words, and what to check.
    await stubEngineFailure(launched.app, {
      'graduates:installFromHub': `${HUB.notes} has no graduate.json at ${HUB.notesCommit}, so it isn't an Architect package. Check the repository and the commit.`,
    });
    await page.getByRole('button', { name: 'Agent menu' }).click();
    await page.getByRole('menuitem', { name: 'Install from Hugging Face' }).click();
    await page.getByRole('textbox', { name: 'Repository' }).fill(HUB.notes);
    await page.getByRole('textbox', { name: 'Commit' }).fill(HUB.notesCommit);
    await page.getByRole('button', { name: 'Download' }).click();
    await expect(page.getByText(`Couldn't install from ${HUB.notes}`)).toBeVisible();
    await expect(page.getByText(/Check the repository and the commit\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
    await capture(`import-hub-error-${theme}.png`);
  });
}

for (const theme of THEMES) {
  test(`changes the agent's model, the fix for a base of another build (${theme})`, async () => {
    const app = launched.app;
    await open(theme, chatPath(CHATS.closeout.id), { installation: otherBuildInstallation() });
    // The chat's header says so too, rather than that it runs here.
    await expect(page.getByText("Can't run on this computer")).toBeVisible();
    const dialog = await openSettingsTab('General');
    await expect(dialog.getByText("Can't run", { exact: true })).toBeVisible();
    await expect(dialog.getByText('another build')).toBeVisible();
    await capture(`agent-model-other-build-${theme}.png`);

    await dialog.getByRole('button', { name: 'Choose its model' }).click();
    const picker = page.getByRole('listbox', { name: 'Suggestions' });
    await expect(picker.getByRole('option', { name: /muse-glimmer-trained:30b/ })).toBeVisible();
    // Trained weights load on a base from Ollama's store, so only Ollama's models are offered.
    await expect(picker.getByText('LM Studio')).toHaveCount(0);
    await capture(`agent-model-picker-${theme}.png`);

    await picker.getByRole('option', { name: /muse-glimmer-trained:30b/ }).click();
    // Exactly the toast's title: its live region announces the same words for a moment.
    await expect(
      page.getByText(`Service desk now runs on ${EXACT_BUILD}`, { exact: true }),
    ).toBeVisible();
    await expect(dialog.getByText('Ready to run')).toBeVisible();
    await expect(page.getByText('Running on this computer')).toBeVisible();
    await capture(`agent-model-changed-${theme}.png`);
    expect(await callsTo(app, 'graduates:bind')).toEqual([
      [AGENT.id, { model: { runtime: 'ollama', baseUrl: OLLAMA_BASE_URL, model: EXACT_BUILD } }],
    ]);
  });
}
