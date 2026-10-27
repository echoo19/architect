import { startSandboxChild } from '../../src/sandbox/child-server';

/**
 * The real sandbox child, except that a tool named crash_now kills the process and a tool named
 * hang_now blocks it forever. This listener runs before the real one, so neither ever replies.
 */
process.on('message', (raw: unknown) => {
  const job = (raw as { job?: { kind?: string; name?: string } }).job;
  if (job?.kind !== 'tool') return;
  if (job.name === 'crash_now') process.exit(70);
  if (job.name === 'hang_now') {
    for (;;) {
      // Never yields to the event loop, so only the engine's watchdog can end it.
    }
  }
});

void startSandboxChild();
