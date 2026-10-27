import { expect, test } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { stubEngine, stubEngineFailure } from './fixtures';

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
      'ollama',
      'reports',
      'runs',
      'secrets',
      'settings',
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
    theme: 'system',
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
      .update({ theme: 'sepia' } as never)
      .then(() => 'accepted')
      .catch((error: Error) => error.message),
  );
  expect(invalid).toContain('Invalid arguments for settings.update');
});

test('reaches the real engine, which has no agents on a fresh profile', async () => {
  const graduates = await launched.page.evaluate(() => window.architect.graduates.list());
  expect(graduates).toEqual([]);
});

test('switches the theme from settings', async () => {
  const page = launched.page;
  await updateSettings(page, { theme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await updateSettings(page, { theme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('finishes setup and shows an error state with a retry when agents fail to load', async () => {
  const page = launched.page;
  await stubEngineFailure(launched.app, {
    'graduates:list': "The engine isn't connected yet, so graduates.list can't run.",
  });
  // The real Ollama on the machine running the tests would change the first step.
  await stubEngine(launched.app, { 'ollama:status': { running: false, models: [] } });
  await page.reload();
  await settle(page);
  // Both setup steps can be skipped; the model and the mentor can be set up later.
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a mentor' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page).toHaveURL(/#\/$/);
  await settle(page);
  expect(await page.evaluate(() => window.architect.settings.get())).toMatchObject({
    onboarded: true,
  });
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: "Couldn't load your agents" })).toBeVisible();
  await expect(main.getByText("The engine isn't connected yet")).toBeVisible();
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
