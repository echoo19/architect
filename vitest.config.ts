import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'examples/*/test/**/*.test.ts',
      'apps/desktop/test/unit/**/*.test.ts',
      'apps/cli/test/**/*.test.ts',
      'site/test/**/*.test.ts',
    ],
    environment: 'node',
    testTimeout: 20_000,
    // Several suites import a whole field job (300 tasks, sealed and fingerprinted) in a setup
    // hook: about 2.5 s alone, far longer when the machine is busy.
    hookTimeout: 60_000,
  },
});
