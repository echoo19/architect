import { describeBlocked, installLoopbackOnlyGuard } from './install';

/**
 * The agent host process's network guard, installed when this module is evaluated. The process
 * entry imports it before anything else, so the guard is in place before any other module of
 * the host loads, and blocked calls are reported on stderr as they happen.
 */
export const processGuard = installLoopbackOnlyGuard({
  onBlocked: (attempt) => console.error(describeBlocked(attempt)),
});
