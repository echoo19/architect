import { existsSync, readdirSync } from 'node:fs';
import { exportFieldFromData } from '@architect/engine/field';
import { CodedError, type CliOutcome } from '@architect/shared';
import { flag, stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { asRefusal, CliError } from '../exit';
import { line } from '../render';

/**
 * `architect field export <job> --out <folder>`: a field's verified demonstrations (train tasks
 * only), its outcome scorer over the train tasks and organizations, and a manifest of its sealed
 * evaluation by hash only (docs/SCALE.md). Nothing of a sealed organization or the locked test
 * goes in; a file that would carry any stops the export with nothing written.
 */
export async function field(ctx: CliContext, parsed: Parsed): Promise<CliOutcome> {
  const [action, job = ''] = parsed.args;
  if (action !== 'export') {
    throw new CliError(
      'invalid_input',
      'usage',
      `architect field has no action called "${action}".`,
      'Usage: architect field export <job> --out <folder>',
    );
  }
  const typed = stringOption(parsed.values, 'out');
  if (typed === undefined) {
    throw new CliError('invalid_input', 'usage', 'Say where to write it with --out <folder>.');
  }
  const outDir = ctx.path(typed);
  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    throw new CliError('invalid_input', 'exists', `${outDir} already has files in it.`);
  }
  const manifest = await exportFieldFromData({ dataDir: ctx.dataDir, job, outDir }).catch(
    (error: unknown) => {
      if (error instanceof CodedError && error.code === 'job_not_found') {
        throw new CliError(
          'invalid_input',
          'job_not_found',
          error.message,
          'Name a job by its id or its name, or set ARCHITECT_USER_DATA to the folder the app uses.',
        );
      }
      throw asRefusal(error, 'invalid_request');
    },
  );
  if (flag(parsed.values, 'json')) {
    line(ctx.io.stdout, JSON.stringify({ folder: outDir, ...manifest }, null, 2));
    return 'succeeded';
  }
  const { counts } = manifest;
  line(ctx.io.stdout, `Wrote ${outDir} for ${manifest.job.name}:`);
  line(ctx.io.stdout, `  sft/   ${counts.demonstrations} verified demonstrations from train tasks`);
  line(
    ctx.io.stdout,
    `  env/   ${counts.train_tasks} train tasks at ${counts.train_organizations} organizations, the checker and score_client.py`,
  );
  line(
    ctx.io.stdout,
    `  eval/  the locked test and ${counts.sealed_organizations} sealed organizations, by hash only`,
  );
  line(ctx.io.stdout, 'Left out:');
  for (const entry of manifest.left_out) line(ctx.io.stdout, `  ${entry.what}: ${entry.why}`);
  return 'succeeded';
}
