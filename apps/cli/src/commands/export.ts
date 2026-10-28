import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { copyFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { exportPackage, reviewExport, type ExportContext } from '@architect/engine/graduates';
import { findHubToken } from '@architect/engine/hub';
import type { CliOutcome, ExportFinding } from '@architect/shared';
import { agentSlug, resolveAgent } from '../agents';
import { countOption, flag, listOption, stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { asRefusal, CliError } from '../exit';
import { bytes, line, printJson } from '../render';

/**
 * The keys the scan looks for. The command can't read keys saved in the desktop app, which the
 * system encrypts for the app alone, but it knows the Hugging Face token it would use itself.
 */
export function cliSecrets(ctx: CliContext): ExportContext['secrets'] {
  return {
    get: async (ref) =>
      ref === 'huggingface' ? (await findHubToken({ env: ctx.io.env }))?.value : undefined,
  };
}

/** Findings the user hasn't confirmed stop the command, with the id that confirms them. */
export function stopOnFindings(
  ctx: CliContext,
  findings: readonly ExportFinding[],
  digest: string,
  accepted: string | undefined,
  what: string,
): void {
  if (findings.length === 0 || accepted === digest) return;
  line(
    ctx.io.stderr,
    `The scan found ${findings.length} thing${findings.length === 1 ? '' : 's'} that look like keys or private paths:`,
  );
  for (const finding of findings) {
    line(
      ctx.io.stderr,
      `  ${finding.path} line ${finding.line} (${finding.kind}): ${finding.excerpt}`,
    );
  }
  throw new CliError(
    'not_permitted',
    'unreviewed_findings',
    `Nothing was ${what}.`,
    `Remove them, or ${what === 'exported' ? 'export' : 'publish'} again with --accept-findings ${digest} once you have checked them. The scan is a best effort, not a guarantee.`,
  );
}

async function move(from: string, to: string): Promise<void> {
  try {
    await rename(from, to);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await copyFile(from, to);
    await rm(from, { force: true });
  }
}

/**
 * Writes a version (the active one by default) as one `.architect.zip`, after the same review
 * the app shows: chats, keys, bindings and private data stay out, and a scan finding stops it
 * until it is confirmed.
 */
export async function exportCommand(ctx: CliContext, parsed: Parsed): Promise<CliOutcome> {
  const { io } = ctx;
  const { values } = parsed;
  const target = stringOption(values, 'output');
  if (target === undefined) {
    throw new CliError('invalid_input', 'usage', 'Say where to write it with --output <file>.');
  }
  const output = ctx.path(target);
  if (existsSync(output)) {
    throw new CliError('invalid_input', 'exists', `${output} already exists.`);
  }
  if (!statSync(dirname(output), { throwIfNoEntry: false })?.isDirectory()) {
    throw new CliError('invalid_input', 'not_a_folder', `${dirname(output)} isn't a folder.`);
  }
  const { library } = ctx.library();
  const agent = resolveAgent(library, parsed.args[0] ?? '');
  const version = countOption(values, 'version');
  const include = listOption(values, 'include');
  const packages = { library, secrets: cliSecrets(ctx) };
  const review = await reviewExport(packages, agent.id, version, include).catch(
    (error: unknown) => {
      throw asRefusal(error, 'invalid_request');
    },
  );
  const accepted = stringOption(values, 'accept-findings');
  stopOnFindings(ctx, review.findings, review.findingsDigest, accepted, 'exported');
  line(io.stderr, review.notice);

  const staging = join(dirname(output), `.architect-export-${randomUUID()}`);
  try {
    const result = await exportPackage(packages, agent.id, {
      directory: staging,
      ...(version === undefined ? {} : { version }),
      include,
      ...(accepted === undefined ? {} : { acknowledgedFindings: accepted }),
    });
    await move(result.archive, output);
    if (flag(values, 'json')) {
      printJson(io.stdout, 'architect.export/1', {
        agent: { id: agent.id, name: agent.name, slug: agentSlug(agent) },
        version: review.version,
        archive: output,
        digest: result.digest,
        files: result.files,
        bytes: result.bytes,
      });
    } else {
      line(
        io.stdout,
        `Wrote ${basename(output)}: ${agent.name} version ${review.version}, ${result.files.length} files, ${bytes(result.bytes)}.`,
      );
      line(io.stdout, `sha256 of its graduate.json: ${result.digest}`);
    }
    return 'succeeded';
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
