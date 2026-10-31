import type { EngineHost } from '@architect/engine';
import { slugify, type JobSummary } from '@architect/shared';
import type { z } from 'zod';
import { CliError } from './exit';
import type { Output } from './io';
import { line } from './render';

export type Api = EngineHost['api'];

/**
 * A JSON document on stdout, parsed with its shared schema first: what the schema doesn't name
 * is dropped, so a command never prints more than its contract says.
 */
export function printDoc<S extends z.ZodType>(out: Output, schema: S, doc: z.input<S>): void {
  line(out, JSON.stringify(schema.parse(doc), null, 2));
}

/** The field a person named: by its id, or by its name as `architect field list` shows it. */
export async function findField(api: Api, named: string | undefined): Promise<JobSummary> {
  if (named === undefined || named === '') {
    throw new CliError('invalid_input', 'usage', 'Name the field, by its id or its name.');
  }
  const jobs = await api.jobs.list();
  const found =
    jobs.find((job) => job.id === named) ??
    jobs.find((job) => slugify(job.name) === slugify(named));
  if (found === undefined) {
    throw new CliError(
      'invalid_input',
      'job_not_found',
      `There is no field called ${named} here.`,
      '`architect field list` shows the fields; set ARCHITECT_USER_DATA to the folder the app uses.',
    );
  }
  return found;
}
