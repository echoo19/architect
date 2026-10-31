import type { CliOutcome } from '@architect/shared';
import { COMMANDS, stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { CliError } from '../exit';
import { runBatch } from '../run/batch';
import { runInteractive } from '../run/interactive';

/**
 * `architect run`: one task from a JSON request with --input, a conversation without one, and
 * with --team a conversation with a team (decision 100).
 */
export async function run(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
): Promise<CliOutcome> {
  const { values } = parsed;
  const team = stringOption(values, 'team');
  if (team !== undefined) {
    if (parsed.args.length > 0) {
      throw new CliError(
        'invalid_input',
        'usage',
        '--team names who answers, so run takes no agent with it.',
        `Usage: architect run --team "${team}"`,
      );
    }
    if (stringOption(values, 'input') !== undefined) {
      throw new CliError(
        'invalid_input',
        'usage',
        "--team holds a conversation. A JSON request runs one agent: name the team's lead instead.",
      );
    }
  } else if (parsed.args.length === 0) {
    throw new CliError(
      'invalid_input',
      'usage',
      'architect run needs an argument: the agent to run, or --team and a team.',
      `Usage: ${COMMANDS.run.usage}`,
    );
  }
  if (stringOption(values, 'input') !== undefined) return runBatch(ctx, parsed, signal);
  for (const option of ['output', 'timeout']) {
    if (values[option] !== undefined) {
      throw new CliError(
        'invalid_input',
        'usage',
        `--${option} goes with --input: a conversation has no JSON result.`,
      );
    }
  }
  return runInteractive(ctx, parsed, signal);
}
