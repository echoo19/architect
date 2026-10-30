import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { NOTHING_LOCAL, stubEngine, stubEngineFailure } from './fixtures';

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.close();
});

test('opens a hidden, sandboxed window', async () => {
  const state = await launched.app.evaluate(({ app, BrowserWindow }) => {
    const [main] = BrowserWindow.getAllWindows();
    if (!main) throw new Error('No window');
    const pid = main.webContents.getOSProcessId();
    return {
      visible: main.isVisible(),
      minimum: main.getMinimumSize(),
      // Reported on Windows and macOS only.
      sandboxed: app.getAppMetrics().find((metric) => metric.pid === pid)?.sandboxed ?? true,
    };
  });
  expect(state).toEqual({ visible: false, minimum: [960, 640], sandboxed: true });

  const page = launched.page;
  const globals = await page.evaluate(() => ({
    require: typeof (window as { require?: unknown }).require,
    process: typeof (window as { process?: unknown }).process,
    bridge: Object.keys(window.architect).sort(),
  }));
  expect(globals).toEqual({
    require: 'undefined',
    process: 'undefined',
    bridge: [
      'app',
      'connections',
      'files',
      'graduates',
      'jobs',
      'mentoring',
      'ollama',
      'reports',
      'runs',
      'secrets',
      'settings',
      'teach',
      'workspace',
    ],
  });
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("script-src 'self'");
});

test('sends a first run to the welcome screen', async () => {
  const page = launched.page;
  await settle(page);
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Architect', level: 1 })).toBeVisible();
});

test('reads and persists settings over the bridge', async () => {
  const page = launched.page;
  const defaults = await page.evaluate(() => window.architect.settings.get());
  expect(defaults).toMatchObject({
    steps: 'collapsed',
    comparisonMode: false,
    onboarded: false,
    defaultMentor: { kind: 'model', provider: 'meta', secretRef: 'meta' },
    defaultStudent: { runtime: 'ollama' },
  });

  const updated = await updateSettings(page, { steps: 'expanded' });
  expect(updated.steps).toBe('expanded');
  expect(await page.evaluate(() => window.architect.settings.get())).toMatchObject({
    steps: 'expanded',
  });

  const invalid = await page.evaluate(() =>
    window.architect.settings
      .update({ steps: 'sepia' } as never)
      .then(() => 'accepted')
      .catch((error: Error) => error.message),
  );
  expect(invalid).toContain('Invalid arguments for settings.update');
});

test('reaches the real engine, which has no agents on a fresh profile', async () => {
  const graduates = await launched.page.evaluate(() => window.architect.graduates.list());
  expect(graduates).toEqual([]);
});

test('ignores a theme left in an older settings file', async () => {
  const older = await launchApp({
    prepare: (userData) =>
      writeFile(
        join(userData, 'settings.json'),
        JSON.stringify({ theme: 'light', onboarded: true }),
      ),
  });
  try {
    const page = older.page;
    await settle(page);
    await expect(page).not.toHaveURL(/#\/welcome$/);
    const settings = await page.evaluate(() => window.architect.settings.get());
    expect(settings).toMatchObject({ onboarded: true });
    expect(settings).not.toHaveProperty('theme');
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  } finally {
    await older.close();
  }
});

test('finishes setup and shows an error state with a retry when agents fail to load', async () => {
  const page = launched.page;
  await stubEngineFailure(launched.app, {
    'graduates:list': {
      message: "The engine isn't connected yet, so graduates.list can't run.",
      code: 'process_starting',
    },
  });
  // The real Ollama on the machine running the tests would change the first step.
  await stubEngine(launched.app, { 'connections:detectLocal': NOTHING_LOCAL });
  await page.reload();
  await settle(page);
  // Both setup steps can wait; the model and the teacher can be set up later.
  await expect(page.getByText("Ollama isn't running")).toBeVisible();
  await page.getByRole('button', { name: 'Download later' }).click();
  await expect(page.getByRole('heading', { name: 'Connect a teacher' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await settle(page);
  expect(await page.evaluate(() => window.architect.settings.get())).toMatchObject({
    onboarded: true,
  });
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: "Couldn't load your agents" })).toBeVisible();
  await expect(
    main.getByText('Architect is still starting up. Try again in a moment.'),
  ).toBeVisible();
  await main.getByRole('button', { name: 'Try again' }).click();
  await expect(main.getByRole('heading', { name: "Couldn't load your agents" })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Agents' }).getByRole('alert')).toBeVisible();
});

test('opens the palette and settings from the keyboard', async () => {
  const page = launched.page;
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

  await page.keyboard.press(`${mod}+k`);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await page.keyboard.type('settings');
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();

  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await page.getByRole('tab', { name: 'About' }).click();
  await expect(settings.getByText(/^Architect \d/)).toBeVisible();
  // Privacy says what the teacher sees, and the one exchange of a chat that can reach it.
  await page.getByRole('tab', { name: 'Privacy' }).click();
  await expect(
    settings.getByText(
      'Sees practice attempts and samples of your files while it trains, never the final test',
    ),
  ).toBeVisible();
  await expect(
    settings.getByText(
      'Spark never sees them. The one exception is Teach this: after you confirm, it sends the one exchange you flag, with its steps and your notes.',
    ),
  ).toBeVisible();
  await expect(settings.getByText('Only what you share')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  await page.keyboard.press(`${mod}+,`);
  await expect(settings).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press(`${mod}+n`);
  await expect(page).toHaveURL(/#\/new$/);
});

test('shows a not-found screen for unknown routes', async () => {
  const page = launched.page;
  await goTo(page, '/nowhere');
  await expect(page.getByRole('heading', { name: 'Nothing lives here' })).toBeVisible();
});
