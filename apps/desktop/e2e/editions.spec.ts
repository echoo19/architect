import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { goTo, launchApp, settle, updateSettings, type LaunchedApp } from './app';
import { EMPTY_ENGINE, SAMPLE_ENGINE, stubEngine } from './fixtures';

/*
 * The two editions of one app (decision 076): a fresh install chooses on the welcome screen,
 * Settings switches without a restart, and the home, the sidebar, the palette and the Describe
 * offers follow. The personal edition is the app for one job; the Lab adds its places.
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

const edition = () => page.evaluate(() => window.architect.settings.get().then((s) => s.edition));
const places = () => page.getByRole('navigation', { name: 'Places' });
const agents = () => page.getByRole('navigation', { name: 'Agents' });
const brand = () => page.getByRole('complementary').getByText(/^Architect( Lab)?$/);

test('a fresh install chooses its edition first on the welcome screen', async () => {
  await stubEngine(launched.app, EMPTY_ENGINE);
  await reloadAt('/');
  await expect(page).toHaveURL(/#\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Welcome to Architect' })).toBeVisible();
  const choice = page.getByRole('radiogroup', { name: 'Edition' });
  const personal = choice.getByRole('radio', { name: /^Architect\b(?! Lab)/ });
  const lab = choice.getByRole('radio', { name: /Architect Lab/ });
  await expect(personal).toHaveAttribute('aria-checked', 'true');
  await expect(personal).toContainText('Teach an agent one job');
  await expect(lab).toContainText('Fields, experiments, models and compute');
  await capture('welcome-editions-dark.png');

  await lab.click();
  await expect.poll(edition).toBe('lab');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: "Your agent's model" })).toBeVisible();
  await page.getByRole('button', { name: 'Download later' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Get started' }).click();

  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole('heading', { name: 'Lab', level: 1 })).toBeVisible();
  await expect(places().getByRole('button')).toHaveCount(5);
  await expect(brand()).toHaveText('Architect Lab');
  expect(await page.title()).toBe('Architect Lab');
});

test('switches in Settings without a restart, and the personal edition has no Lab places', async () => {
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+,`);
  const settings = page.getByRole('dialog', { name: 'Settings' });
  const choice = settings.getByRole('radiogroup', { name: 'Edition' });
  await expect(choice.getByRole('radio', { name: 'Architect Lab' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await choice.getByRole('radio', { name: 'Architect', exact: true }).click();
  await expect.poll(edition).toBe('personal');
  await expect(settings.getByText('Your agents and runs stay in both.')).toBeVisible();
  await capture('settings-edition-dark.png');
  await page.keyboard.press('Escape');

  // The pre-pivot home: no agents yet, the agents' sidebar alone, the app's own name.
  await expect(page.getByRole('heading', { name: 'No agents yet' })).toBeVisible();
  await expect(places()).toHaveCount(0);
  await expect(brand()).toHaveText('Architect');
  expect(await page.title()).toBe('Architect');

  // A Lab place goes home.
  for (const path of ['/models', '/compute', '/experiments', '/fields']) {
    await goTo(page, path);
    await expect(page).toHaveURL(/#\/$/);
  }

  // The palette has no places.
  await page.keyboard.press(`${mod}+k`);
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette.getByRole('option', { name: 'New agent' })).toBeVisible();
  await expect(palette.getByRole('option', { name: 'Compute' })).toHaveCount(0);
  await expect(palette.getByRole('option', { name: 'Experiments' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('the personal home opens the chat used last, and Describe offers no tutor', async () => {
  await stubEngine(launched.app, SAMPLE_ENGINE);
  await reloadAt('/');
  await expect(page).toHaveURL(/#\/agents\/[^/]+\/chats\/[^/]+$/);
  await expect(agents()).toContainText('Close out Tuesday');
  await expect(places()).toHaveCount(0);
  await capture('home-personal-dark.png');

  await goTo(page, '/new');
  await expect(page.getByRole('button', { name: 'Try the sample job' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import a job file' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try the tutor' })).toHaveCount(0);
});

test('the Lab home leads with its places, and Describe offers the tutor too', async () => {
  await updateSettings(page, { edition: 'lab' });
  await goTo(page, '/');
  await expect(page.getByRole('heading', { name: 'Lab', level: 1 })).toBeVisible();
  await expect(places().getByRole('button', { name: 'Lab' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await goTo(page, '/new');
  await expect(page.getByRole('button', { name: 'Try the tutor' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try the sample job' })).toBeVisible();
  await goTo(page, '/models');
  await expect(page).toHaveURL(/#\/models$/);
});
