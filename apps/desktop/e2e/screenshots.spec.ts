import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { EMPTY_ENGINE, SAMPLE, SAMPLE_ENGINE, stubEngine } from './fixtures';

const OUT_DIR = fileURLToPath(new URL('../../../docs/screenshots/', import.meta.url));
const SIZE = { width: 1440, height: 900 };
const THEMES = ['dark', 'light'] as const;

/** Every route, with ids the engine doesn't know, so each shows its real empty or error state. */
const ROUTES = [
  { name: 'workspace', path: '/' },
  { name: 'chat', path: '/agents/grd_example/chats/cht_example' },
  { name: 'describe', path: '/new' },
  { name: 'define', path: '/jobs/job_example/define' },
  { name: 'train', path: '/runs/run_example/train' },
  { name: 'report', path: '/runs/run_example/report' },
] as const;

/** The same screens filled with sample engine replies. */
const SAMPLE_ROUTES = [
  { name: 'chat-sample', path: `/agents/${SAMPLE.graduateId}/chats/${SAMPLE.chatId}` },
  { name: 'define-sample', path: `/jobs/${SAMPLE.jobId}/define` },
  { name: 'train-sample', path: `/runs/${SAMPLE.runId}/train` },
  { name: 'report-sample', path: `/runs/${SAMPLE.runId}/report` },
] as const;

test.describe.configure({ mode: 'serial' });

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
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

async function capture(page: Page, file: string): Promise<void> {
  await settle(page);
  await page.screenshot({ path: join(OUT_DIR, file), animations: 'disabled', timeout: 15_000 });
}

/** Settings changed behind the renderer's back need a reload before its cache sees them. */
async function applySettings(page: Page, patch: Parameters<typeof updateSettings>[1]) {
  await updateSettings(page, patch);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

for (const theme of THEMES) {
  test(`captures every screen in the ${theme} theme`, async () => {
    const page = launched.page;
    await applySettings(page, { theme, onboarded: false });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => [window.innerWidth, window.innerHeight])).toEqual([
      SIZE.width,
      SIZE.height,
    ]);

    await goTo(page, '/welcome');
    await capture(page, `welcome-${theme}.png`);

    await applySettings(page, { onboarded: true });
    for (const route of ROUTES) {
      await goTo(page, route.path);
      await capture(page, `${route.name}-${theme}.png`);
    }

    await goTo(page, '/');
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await capture(page, `settings-general-${theme}.png`);
    await page.getByRole('tab', { name: 'Models' }).click();
    await capture(page, `settings-models-${theme}.png`);
    await page.keyboard.press('Escape');

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await capture(page, `palette-${theme}.png`);
    await page.keyboard.press('Escape');
  });
}

test('captures the empty workspace and a failed action', async () => {
  const page = launched.page;
  await stubEngine(launched.app, EMPTY_ENGINE);
  for (const theme of THEMES) {
    await applySettings(page, { theme });
    await goTo(page, '/');
    await expect(page.getByRole('heading', { name: 'No agents yet' })).toBeVisible();
    await capture(page, `workspace-empty-${theme}.png`);

    // Creating the sample job needs the engine, so it fails and says why in a toast.
    await page.getByRole('button', { name: 'Try the sample job' }).click();
    await expect(page.getByText("Couldn't create the sample job")).toBeVisible();
    await capture(page, `toast-${theme}.png`);
    await page.getByRole('button', { name: 'Dismiss' }).click();
  }
});

test('captures the populated screens with sample engine replies', async () => {
  const page = launched.page;
  await stubEngine(launched.app, SAMPLE_ENGINE);
  for (const theme of THEMES) {
    await applySettings(page, { theme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const route of SAMPLE_ROUTES) {
      await goTo(page, route.path);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await capture(page, `${route.name}-${theme}.png`);
    }
  }
});
