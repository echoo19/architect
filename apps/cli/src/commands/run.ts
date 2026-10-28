import type { CliOutcome } from '@architect/shared';
import { stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { CliError } from '../exit';
import { runBatch } from '../run/batch';
import { runInteractive } from '../run/interactive';

/** `architect run`: one task from a JSON request with --input, a conversation without one. */
export async function run(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
): Promise<CliOutcome> {
  const { values } = parsed;
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
