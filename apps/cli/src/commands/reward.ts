import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { openRewardScorer } from '@architect/engine/field';
import type { CliOutcome } from '@architect/shared';
import { stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { CliError } from '../exit';

/**
 * `architect reward score`: the outcome scorer of a field export's `env/` folder, as a local
 * process for outside rollout systems. One JSON request per line on stdin, one JSON score per
 * line on stdout, in order; it ends when stdin does. It makes no network calls.
 */
export async function reward(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
): Promise<CliOutcome> {
  const [action] = parsed.args;
  if (action !== 'score') {
    throw new CliError(
      'invalid_input',
      'usage',
      `architect reward has no action called "${action}".`,
      'Usage: architect reward score [--env <folder>]',
    );
  }
  const envDir = ctx.path(stringOption(parsed.values, 'env') ?? '.');
  if (!existsSync(join(envDir, 'job.json')) || !existsSync(join(envDir, 'tasks.jsonl'))) {
    throw new CliError(
      'invalid_input',
      'not_an_env',
      `${envDir} isn't a field export's env folder: it needs job.json and tasks.jsonl.`,
      'Write one with `architect field export <job> --out <folder>` and pass its env folder.',
    );
  }
  ctx.io.installGuard();
  const scorer = openRewardScorer({
    envDir,
    ...(ctx.io.sandboxEntryPath === undefined ? {} : { sandboxEntryPath: ctx.io.sandboxEntryPath }),
  });
  const lines = createInterface({ input: ctx.io.stdin, crlfDelay: Infinity });
  const stop = () => lines.close();
  signal.addEventListener('abort', stop);
  try {
    for await (const line of lines) {
      if (line.trim() === '') continue;
      ctx.io.stdout.write(`${JSON.stringify(await scorer.score(line))}\n`);
    }
  } finally {
    signal.removeEventListener('abort', stop);
    await scorer.close();
  }
  signal.throwIfAborted();
  return 'succeeded';
}
