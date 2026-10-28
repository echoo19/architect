import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import type { AppSettings } from '@architect/shared';

/** No trailing separator: on Windows a trailing backslash would escape the closing quote. */
const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * The packaged app to run instead of the built one, such as `release/win-unpacked/Architect.exe`.
 * Set with ARCHITECT_E2E_EXECUTABLE, which `playwright.packaged.config.ts` fills in.
 */
export function packagedExecutable(): string | undefined {
  const named = process.env.ARCHITECT_E2E_EXECUTABLE;
  if (!named) return undefined;
  const executable = resolve(named);
  if (!existsSync(executable)) {
    throw new Error(`There is no packaged app at ${executable}. Run \`pnpm package\` first.`);
  }
  return executable;
}

export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  close: () => Promise<void>;
}

export interface LaunchOptions {
  /** More environment for the app, such as a stand-in llama-server. */
  env?: Record<string, string>;
  /** Settings the profile starts with; defaults for the rest. */
  settings?: Partial<AppSettings>;
  /**
   * A data folder the profile starts as a copy of, such as a recorded run, so the app's real
   * engine reads its records. The folder itself is never changed.
   */
  data?: string;
}

/**
 * Starts the built app, or the packaged one when ARCHITECT_E2E_EXECUTABLE names it, with a
 * hidden window and a throwaway profile.
 */
export async function launchApp(options: LaunchOptions = {}): Promise<LaunchedApp> {
  const userData = await mkdtemp(join(tmpdir(), 'architect-e2e-'));
  if (options.data) await cp(options.data, userData, { recursive: true });
  if (options.settings) {
    await writeFile(join(userData, 'settings.json'), JSON.stringify(options.settings));
  }
  const executablePath = packagedExecutable();
  const app = await electron.launch({
    ...(executablePath ? { executablePath } : { args: [APP_DIR] }),
    env: {
      ...process.env,
      ...options.env,
      ARCHITECT_HIDDEN: '1',
      ARCHITECT_USER_DATA: userData,
    },
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
