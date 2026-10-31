import { existsSync, readdirSync } from 'node:fs';
import { exportFieldFromData } from '@architect/engine/field';
import {
  AddOrganizationRequestSchema,
  bestCandidate,
  CodedError,
  FIELD_LIST_FORMAT,
  FIELD_STATUS_FORMAT,
  FieldListSchema,
  FieldStatusSchema,
  orgCounts,
  reportScores,
  type CliOutcome,
  type FieldCandidate,
  type FieldRow,
  type FieldStatus,
  type JobSummary,
  type Score,
} from '@architect/shared';
import { flag, stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { asRefusal, CliError } from '../exit';
import { findField, printDoc, type Api } from '../lab';
import { line, table } from '../render';

const USAGE =
  'Usage: architect field list | status <field> | add-org <field> --folder <dir> --name <n> --never-seen | export <field> --out <folder>';

type Status = Omit<FieldStatus, 'format'>;

/**
 * `architect field list | status | add-org | export`: the fields on this computer, one field's
 * organizations and versions, a never-seen organization added to one, and the field written out
 * for training elsewhere. All of it goes through the engine calls the Fields place uses.
 */
export async function field(ctx: CliContext, parsed: Parsed): Promise<CliOutcome> {
  const [action, named] = parsed.args;
  switch (action) {
    case 'list':
      return fieldList(ctx, parsed);
    case 'status':
      return fieldStatus(ctx, parsed, named);
    case 'add-org':
      return addOrganization(ctx, parsed, named);
    case 'export':
      return exportField(ctx, parsed, named ?? '');
    default:
      throw new CliError(
        'invalid_input',
        'usage',
        `architect field has no action called "${action}".`,
        USAGE,
      );
  }
}

function cell(score: Score | null): string {
  if (score === null) return '-';
  return `${score.pass}/${score.total} (${Math.round((score.pass * 100) / score.total)}%)`;
}

/** One field as the Fields place reads it: what it is made of, and every version that took the final test. */
async function readField(api: Api, job: Pick<JobSummary, 'id' | 'name'>): Promise<Status> {
  const [view, runs] = await Promise.all([api.jobs.field(job.id), api.runs.list(job.id)]);
  const tested = [];
  for (const run of runs.filter((item) => item.status === 'finished')) {
    if ((await api.reports.list(run.id)).length === 0) continue;
    const card = await api.reports.get(run.id);
    tested.push({ run, card, scores: reportScores(card) });
  }
  tested.sort((a, b) => (a.card.createdAt < b.card.createdAt ? 1 : -1));
  const best = bestCandidate(tested);
  const counts = orgCounts(view);
  const candidates: FieldCandidate[] = tested.map((item) => ({
    runId: item.run.id,
    createdAt: item.card.createdAt,
    best: item === best,
    ...item.scores,
    certificate:
      item.card.certificate === undefined
        ? null
        : item.card.certificate.issued
          ? 'issued'
          : 'not_issued',
  }));
  return {
    jobId: job.id,
    name: job.name,
    organizations: { taughtOn: counts.taughtOn, neverSeen: counts.sealed, real: counts.real },
    versions: candidates.length,
    best: best === null ? null : best.scores,
    certificates: candidates.filter((item) => item.certificate === 'issued').length,
    field: view,
    candidates,
  };
}

function rowOf(status: Status): FieldRow {
  const { field: _field, candidates: _candidates, ...row } = status;
  return row;
}

async function fieldList(ctx: CliContext, parsed: Parsed): Promise<CliOutcome> {
  if (parsed.args.length > 1) throw new CliError('invalid_input', 'usage', USAGE);
  const { api } = await ctx.engine();
  const fields: FieldRow[] = [];
  for (const job of await api.jobs.list()) fields.push(rowOf(await readField(api, job)));
  if (flag(parsed.values, 'json')) {
    printDoc(ctx.io.stdout, FieldListSchema, { format: FIELD_LIST_FORMAT, fields });
    return 'succeeded';
  }
  if (fields.length === 0) {
    line(ctx.io.stderr, `No fields in ${ctx.dataDir}.`);
    return 'succeeded';
  }
  line(
    ctx.io.stdout,
    table([
      ['FIELD', 'TAUGHT ON', 'NEVER SEEN', 'REAL', 'VERSIONS', 'SEEN', 'UNSEEN', 'REAL', 'CERTS'],
      ...fields.map((item) => [
        item.name,
        String(item.organizations.taughtOn),
        String(item.organizations.neverSeen),
        item.organizations.real === null ? '-' : String(item.organizations.real),
        String(item.versions),
        cell(item.best?.seen ?? null),
        cell(item.best?.unseen ?? null),
        cell(item.best?.real ?? null),
        String(item.certificates),
      ]),
    ]),
  );
  return 'succeeded';
}

function sayStatus(ctx: CliContext, status: Status): void {
  const out = ctx.io.stdout;
  const counts = status.organizations;
  line(out, `${status.name} (${status.jobId})`);
  line(
    out,
    `${counts.taughtOn} taught on, ${counts.neverSeen} never seen${counts.real === null ? '' : `, ${counts.real} real`}. ${status.versions} versions took the final test, ${status.certificates} certified.`,
  );
  line(out);
  line(out, 'Taught on:');
  for (const org of status.field.organizations) {
    line(out, `  ${org.name ?? '(its data)'}  ${org.files.length} files`);
  }
  if (status.field.sealed.length > 0) {
    line(out, 'Never seen:');
    for (const org of status.field.sealed) {
      line(out, `  ${org.name}  ${org.synthetic ? 'generated' : 'real'}, ${org.files} files`);
    }
  }
  if (status.candidates.length > 0) {
    line(out);
    line(
      out,
      table([
        ['VERSION', 'SEEN', 'UNSEEN', 'REAL', 'CERTIFICATE'],
        ...status.candidates.map((item) => [
          `${item.runId}${item.best ? ' (best)' : ''}`,
          cell(item.seen),
          cell(item.unseen),
          cell(item.real),
          item.certificate?.replace('_', ' ') ?? '-',
        ]),
      ]),
    );
  }
}

async function fieldStatus(
  ctx: CliContext,
  parsed: Parsed,
  named: string | undefined,
): Promise<CliOutcome> {
  const { api } = await ctx.engine();
  const status = await readField(api, await findField(api, named));
  if (flag(parsed.values, 'json')) {
    printDoc(ctx.io.stdout, FieldStatusSchema, { format: FIELD_STATUS_FORMAT, ...status });
  } else {
    sayStatus(ctx, status);
  }
  return 'succeeded';
}

/**
 * `architect field add-org <field> --folder <dir> --name <n> --never-seen`: seals a never-seen
 * organization beside the field's final test (decision 085), through the call the Fields place
 * makes, so whatever the app refuses is refused here.
 */
async function addOrganization(
  ctx: CliContext,
  parsed: Parsed,
  named: string | undefined,
): Promise<CliOutcome> {
  const { values } = parsed;
  const folder = stringOption(values, 'folder');
  const name = stringOption(values, 'name');
  if (folder === undefined || name === undefined) {
    throw new CliError(
      'invalid_input',
      'usage',
      'Say where its records are with --folder <dir> and what to call it with --name <name>.',
    );
  }
  if (!flag(values, 'never-seen')) {
    throw new CliError(
      'invalid_input',
      'usage',
      'An organization added later is sealed with the final test and never taught on. Say so with --never-seen.',
    );
  }
  const { api } = await ctx.engine();
  const job = await findField(api, named);
  const request = AddOrganizationRequestSchema.parse({
    folder: ctx.path(folder),
    name,
    synthetic: flag(values, 'generated'),
  });
  try {
    await api.jobs.addOrganization(job.id, request);
  } catch (error) {
    throw asRefusal(error, 'cannot_add');
  }
  const status = await readField(api, job);
  if (flag(values, 'json')) {
    printDoc(ctx.io.stdout, FieldStatusSchema, { format: FIELD_STATUS_FORMAT, ...status });
  } else {
    line(ctx.io.stdout, `Sealed ${request.name} beside ${job.name}'s final test.`);
    line(
      ctx.io.stdout,
      `${job.name} now has ${status.organizations.neverSeen} never-seen organizations.`,
    );
  }
  return 'succeeded';
}

/**
 * `architect field export <job> --out <folder>`: a field's verified demonstrations (train tasks
 * only), its outcome scorer over the train tasks and organizations, and a manifest of its sealed
 * evaluation by hash only (docs/SCALE.md). Nothing of a sealed organization or the locked test
 * goes in; a file that would carry any stops the export with nothing written.
 */
async function exportField(ctx: CliContext, parsed: Parsed, job: string): Promise<CliOutcome> {
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
