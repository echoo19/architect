import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  // Records a run on the returns desk with the engine's fakes, for the evidence screens.
  globalSetup: './e2e/global-setup.ts',
  outputDir: 'test-results',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
