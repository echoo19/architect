import { dirname, extname, join } from 'node:path';
import type { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { describeBlocked, installLoopbackOnlyGuard } from '@architect/engine/agent-host';
import { runCli } from './cli';

/*
 * The `architect` process: the command with this process's streams, environment and signals.
 * The first Ctrl+C asks the running command to stop; a second one ends the process at once.
 */

const here = fileURLToPath(import.meta.url);
/** A bundle runs from out/cli, beside the tool sandbox's own folder; the sources use the engine's. */
const sandboxEntryPath =
  extname(here) === '.mjs' ? join(dirname(here), '..', 'sandbox', 'child.mjs') : undefined;

const listeners = new Set<() => void>();
let interrupted = false;
function interrupt(): void {
  if (interrupted) process.exit(130);
  interrupted = true;
  for (const listener of listeners) listener();
}
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

/** `pnpm architect` runs from the repository's root; INIT_CWD is where it was typed. */
const cwd =
  process.env['npm_lifecycle_event'] === 'architect' && process.env['INIT_CWD']
    ? process.env['INIT_CWD']
    : process.cwd();

function flushed(stream: Writable): Promise<void> {
  return new Promise((resolve) => stream.write('', () => resolve()));
}

async function main(): Promise<number> {
  return runCli(process.argv.slice(2), {
    stdout: { write: (text) => void process.stdout.write(text) },
    stderr: { write: (text) => void process.stderr.write(text) },
    stdin: process.stdin,
    terminal: process.stdin.isTTY === true,
    env: process.env,
    cwd,
    onInterrupt(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    installGuard() {
      installLoopbackOnlyGuard({
        onBlocked: (attempt) => process.stderr.write(`${describeBlocked(attempt)}\n`),
      });
    },
    ...(sandboxEntryPath === undefined ? {} : { sandboxEntryPath }),
  });
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    return 1;
  })
  .then(async (code) => {
    // The result is written out before the process ends, whatever still holds it open.
    await flushed(process.stdout);
    await flushed(process.stderr);
    process.exit(code);
  });
