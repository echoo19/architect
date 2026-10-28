import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngineFailure } from './fixtures';
import { FOLDERS, installation, installPackagesFake, PACKAGES } from './fixtures-versions';
import {
  AGENT,
  callsTo,
  engineSeed,
  GB,
  installFakeEngine,
  STUDENT_MODEL,
} from './fixtures-workspace';

/*
 * The ready-made agent that comes with Architect, opened from the screens that offer the sample
 * job. A stand-in engine answers for the engine, like the other import specs: it says whether
 * this build ships the agent, and where its package and its data are. The real engine's side,
 * the copy and the paths, is covered by its own tests.
 */

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];

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
  // Off every control, so no hover state lands in the picture.
  await page.mouse.move(0, 0);
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

/**
 * A computer with no agent yet and Glimmer downloaded, whose build ships the ready-made agent
 * unless `sampleAgent` is false; the theme, then the app reloaded at `path`.
 */
async function open(
  theme: Theme,
  path: string,
  options: { sampleAgent?: boolean; onboarded?: boolean } = {},
): Promise<void> {
  await installFakeEngine(
    launched.app,
    engineSeed({
      graduates: [],
      chats: [],
      messages: [],
      ollama: {
        running: true,
        version: '0.12.6',
        models: [{ name: STUDENT_MODEL, sizeBytes: 18 * GB, digest: 'sha256-glimmer' }],
      },
    }),
  );
  await installPackagesFake(launched.app, {
    versions: [],
    installation: installation(AGENT.id),
    agents: [],
    sampleAgent: options.sampleAgent ?? true,
  });
  await updateSettings(page, { theme, onboarded: options.onboarded ?? true });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await goTo(page, path);
}

/** First-run setup from its first step to its last, the model already downloaded. */
async function walkToTheEndOfSetup(): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Welcome to Architect' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a mentor' })).toBeVisible();
  await page.getByLabel('Meta API key').fill('not-a-real-key');
  await page.getByRole('button', { name: 'Test connection' }).click();
  await expect(page.getByText('Connected · 640 ms')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByRole('heading', { name: "You're set up" })).toBeVisible();
}

const readyMade = () => page.getByRole('button', { name: 'Try a ready-made agent' });
const sampleJob = () => page.getByRole('button', { name: 'Try the sample job' });

for (const theme of THEMES) {
  test(`opens the ready-made agent from the new-agent screen, with its data chosen, to a ready install (${theme})`, async () => {
    const app = launched.app;
    await open(theme, '/new');

    // Beside the sample job, which is still offered.
    await expect(sampleJob()).toBeVisible();
    await expect(readyMade()).toBeVisible();
    await capture(`sample-agent-new-${theme}.png`);

    await readyMade().click();
    await expect(page).toHaveURL(/#\/import$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Returns desk' })).toBeVisible();
    await expect(page.getByText('returns-desk.architect.zip')).toBeVisible();
    await expect(page.getByText("Evaluated on the author's computer")).toBeVisible();
    await expect(page.getByText('On this computer', { exact: true })).toBeVisible();
    await capture(`sample-agent-import-${theme}.png`);
    // Its data was made this computer's own once, and no dialog asked for a package or a folder.
    expect(await callsTo(app, 'graduates:prepareSampleAgent')).toEqual([[]]);
    expect(await callsTo(app, 'graduates:previewImport')).toEqual([[PACKAGES.sample]]);
    expect(await callsTo(app, 'files:pick')).toEqual([]);

    // The folders are still shown, with data/ already chosen and still the person's to change.
    await page.getByRole('button', { name: 'Continue' }).click();
    const data = page
      .getByRole('list', { name: 'Folders' })
      .getByRole('listitem', { name: 'data/' });
    await expect(data).toContainText('…\\returns-desk\\data');
    await expect(data.getByRole('button', { name: 'Change' })).toBeVisible();
    await capture(`sample-agent-folders-${theme}.png`);

    // Nothing it asks for is granted until it is chosen here.
    await page.getByRole('button', { name: 'Continue' }).click();
    const access = page.getByRole('radiogroup', { name: 'Access to data/' });
    await expect(access.getByRole('radio', { name: 'Not allowed' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await access.getByRole('radio', { name: 'Read and change' }).click();
    await page.getByRole('button', { name: 'Install', exact: true }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Returns desk is ready' }),
    ).toBeVisible();
    await expect(page.getByText('Install checks on this computer')).toBeVisible();
    expect(await callsTo(app, 'graduates:importPackage')).toEqual([
      [
        PACKAGES.sample,
        {
          bindings: { data: FOLDERS.sample },
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
  test(`offers it on the last screen of setup and on the screen after it (${theme})`, async () => {
    const app = launched.app;
    await open(theme, '/welcome', { onboarded: false });
    await walkToTheEndOfSetup();
    await expect(
      page.getByText(
        "The sample job and a ready-made agent are on the next screen, if you'd like to see one first.",
      ),
    ).toBeVisible();
    await capture(`sample-agent-welcome-${theme}.png`);

    await page.getByRole('button', { name: 'Get started' }).click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByRole('heading', { name: 'No agents yet' })).toBeVisible();
    await expect(sampleJob()).toBeVisible();
    await expect(readyMade()).toBeVisible();
    await capture(`sample-agent-empty-${theme}.png`);

    // From here it opens the same import, with data/ chosen.
    await readyMade().click();
    await expect(page).toHaveURL(/#\/import$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Returns desk' })).toBeVisible();
    expect(await callsTo(app, 'graduates:prepareSampleAgent')).toEqual([[]]);
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(
      page.getByRole('list', { name: 'Folders' }).getByRole('listitem', { name: 'data/' }),
    ).toContainText('…\\returns-desk\\data');
  });
}

test('offers nothing, and says nothing of it, in a build that does not ship the agent', async () => {
  await open('dark', '/welcome', { onboarded: false, sampleAgent: false });
  await walkToTheEndOfSetup();
  await expect(
    page.getByText("The sample job is on the next screen, if you'd like to see one first."),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('heading', { name: 'No agents yet' })).toBeVisible();
  await expect(sampleJob()).toBeVisible();
  await expect(page.getByText(/ready-made/)).toHaveCount(0);

  await goTo(page, '/new');
  await expect(page.getByRole('heading', { name: 'What should your agent do?' })).toBeVisible();
  await expect(sampleJob()).toBeVisible();
  await expect(page.getByText(/ready-made/)).toHaveCount(0);

  // An engine that can't say whether it has one is as good as one that has none.
  await stubEngineFailure(launched.app, {
    'graduates:hasSampleAgent': 'The engine is restarting; try again in a moment.',
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(sampleJob()).toBeVisible();
  await expect(page.getByText(/ready-made/)).toHaveCount(0);
});

test('says why the ready-made agent could not be opened, and stays where it is', async () => {
  await open('dark', '/new');
  await expect(readyMade()).toBeVisible();
  await stubEngineFailure(launched.app, {
    'graduates:prepareSampleAgent': `The ready-made agent's data couldn't be copied to ${FOLDERS.sample}. There is not enough free disk space.`,
  });
  await readyMade().click();
  // Exact, so the toast's screen-reader announcement doesn't also match.
  await expect(page.getByText("Couldn't open the ready-made agent", { exact: true })).toBeVisible();
  await expect(page.getByText(/There is not enough free disk space\./).first()).toBeVisible();
  await expect(page).toHaveURL(/#\/new$/);
  await expect(readyMade()).toBeEnabled();
});
