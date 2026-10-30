import type { CliOutcome } from '@architect/shared';
import {
  commandUsage,
  isCommand,
  parseCommand,
  usage,
  type CommandName,
  type Parsed,
} from './args';
import { exportCommand } from './commands/export';
import { inspect } from './commands/inspect';
import { install } from './commands/install';
import { list } from './commands/list';
import { publish } from './commands/publish';
import { run } from './commands/run';
import { train } from './commands/train';
import { verify } from './commands/verify';
import { CliContext } from './context';
import { exitCodeOf, failureOf } from './exit';
import { interrupts, type CliIo } from './io';
import { line, sayFailure } from './render';
import { CLI_VERSION } from './run/result';

type Command = (ctx: CliContext, parsed: Parsed, signal: AbortSignal) => Promise<CliOutcome>;

const HANDLERS: Readonly<Record<CommandName, Command>> = {
  list,
  install,
  run,
  inspect,
  verify,
  export: exportCommand,
  publish,
  train,
};

/**
 * The `architect` command, given its arguments: runs one command and returns its exit code.
 * Results go to stdout and everything else to stderr; a failure is reported once, with what to
 * do, and its exit code says what kind it was (docs/CLI.md).
 */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    const topic = rest[0];
    io.stdout.write(topic !== undefined && isCommand(topic) ? commandUsage(topic) : usage());
    return exitCodeOf('succeeded');
  }
  if (name === '--version' || name === '-v') {
    line(io.stdout, CLI_VERSION);
    return exitCodeOf('succeeded');
  }
  if (!isCommand(name)) {
    line(io.stderr, `architect has no command called "${name}".`);
    io.stderr.write(usage());
    return exitCodeOf('invalid_input');
  }

  const ctx = new CliContext(io);
  const stop = interrupts(io);
  try {
    const parsed = parseCommand(name, rest);
    if (parsed.help) {
      io.stdout.write(commandUsage(name));
      return exitCodeOf('succeeded');
    }
    return exitCodeOf(await HANDLERS[name](ctx, parsed, stop.signal));
  } catch (error) {
    const failure = stop.signal.aborted
      ? { outcome: 'cancelled' as const, code: 'cancelled', message: 'Stopped before it finished.' }
      : failureOf(error);
    sayFailure(io.stderr, failure);
    return exitCodeOf(failure.outcome);
  } finally {
    stop.dispose();
    await ctx.close();
  }
}
