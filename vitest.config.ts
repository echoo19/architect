import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'examples/*/test/**/*.test.ts',
      'apps/desktop/test/unit/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 20_000,
  },
});
