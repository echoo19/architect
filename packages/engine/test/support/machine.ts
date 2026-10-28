import type { Machine } from '@architect/shared';

/**
 * The computer tests say they run on: the one installation checks see, and the one a graduate
 * made here took its locked test on. Always stated, never read from the computer running the
 * tests, which may be one Architect doesn't run graduates on (CI runs on Linux) or another
 * platform than a test's author computer.
 */
export const THIS_MACHINE: Machine = {
  os: 'win32',
  arch: 'x64',
  memoryBytes: 32 * 1024 ** 3,
};
