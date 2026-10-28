import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const RELEASE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'release');

/** Where electron-builder leaves the unpacked app for the platform this runs on. */
function unpackedExecutable(): string {
  switch (process.platform) {
    case 'win32':
      return join(RELEASE_DIR, 'win-unpacked', 'Architect.exe');
    case 'darwin': {
      const folder = process.arch === 'arm64' ? 'mac-arm64' : 'mac';
      return join(RELEASE_DIR, folder, 'Architect.app', 'Contents', 'MacOS', 'Architect');
    }
    default:
      throw new Error('Architect is packaged for Windows and macOS only.');
  }
}

// The e2e fixtures start the app this file names instead of the built one.
process.env.ARCHITECT_E2E_EXECUTABLE ||= unpackedExecutable();

/**
 * The end-to-end specs that exercise what packaging can break, run against the unpacked app that
 * `pnpm package` left in `release/`. The screenshot and stubbed-screen specs would only repeat
 * the run against the built app, and the screenshot ones would rewrite `docs/screenshots/`.
 */
export default defineConfig(base, {
  testMatch: ['shell.spec.ts', 'engine.spec.ts', 'agent-host.spec.ts', 'packaging.spec.ts'],
  // None of these reads the recorded run.
  globalSetup: [],
});
