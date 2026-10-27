import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
