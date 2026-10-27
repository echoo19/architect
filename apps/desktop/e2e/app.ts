import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { AppSettings } from '@architect/shared';

/** No trailing separator: on Windows a trailing backslash would escape the closing quote. */
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  close: () => Promise<void>;
}

/** Starts the built app with a hidden window and a throwaway profile. */
export async function launchApp(): Promise<LaunchedApp> {
  const userData = await mkdtemp(join(tmpdir(), 'architect-e2e-'));
  const app = await electron.launch({
    args: [APP_DIR],
    env: { ...process.env, ARCHITECT_HIDDEN: '1', ARCHITECT_USER_DATA: userData },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  // No animation mid-capture. The color scheme stays real: the app's theme setting drives it.
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: null });
  return {
    app,
    page,
    close: async () => {
      await app.close();
      await rm(userData, { recursive: true, force: true });
    },
  };
}

export function updateSettings(page: Page, patch: Partial<AppSettings>): Promise<AppSettings> {
  return page.evaluate((next) => window.architect.settings.update(next), patch);
}

/** Navigates by hash and waits until nothing on screen is still loading. */
export async function goTo(page: Page, path: string): Promise<void> {
  await page.evaluate((hash) => {
    window.location.hash = hash;
  }, path);
  await settle(page);
}

export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => document.querySelectorAll('[aria-busy="true"]').length === 0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}
