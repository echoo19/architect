import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GraduateManifest, Harness, LineageEntry, ReportCard } from '@architect/shared';
import { GraduateManifestSchema, ReportCardSchema } from '@architect/shared';
import { errorMessage, parseYaml, stringifyYaml } from './codec';
import { HarnessValidationError } from './errors';
import { readHarness, writeHarness } from './folder';
import { hashHarness } from './hash';
import { camelToSnake, isRecord, mapKeys, snakeToCamel } from './keys';
import { lineageToLine, parseLineage, LINEAGE_FILE } from './lineage';
import { check } from './parse';
import { renderReportMarkdown } from './report';
import { normalizeText } from './text';

export const MANIFEST_FILE = 'graduate.yaml';
export const REPORT_FILE = 'report.md';

/** What goes into a graduate folder. */
export interface GraduateBundle {
  harness: Harness;
  manifest: GraduateManifest;
  report: ReportCard;
  lineage: LineageEntry[];
}

/** A graduate folder read back. The report card is the Markdown file as written. */
export interface GraduateFolder {
  harness: Harness;
  manifest: GraduateManifest;
  reportMarkdown: string;
  lineage: LineageEntry[];
}

const shortHash = (hash: string): string => hash.slice(0, 19);

function hashMismatch(expected: string, actual: string): HarnessValidationError {
  return new HarnessValidationError([
    `${MANIFEST_FILE}: the harness files do not match the hash recorded for this graduate ` +
      `(recorded ${shortHash(expected)}, found ${shortHash(actual)}). ` +
      'A harness file was changed after the graduate was saved.',
  ]);
}

/**
 * Writes a graduate folder: the harness files, `report.md` rendered from the report card,
 * `lineage.jsonl` and `graduate.yaml`, which goes last. The manifest must describe exactly the
 * harness given: its version and hash are checked.
 */
export async function writeGraduate(dir: string, bundle: GraduateBundle): Promise<void> {
  const problems: string[] = [];
  const manifest = check(MANIFEST_FILE, GraduateManifestSchema, bundle.manifest, problems);
  const report = check(REPORT_FILE, ReportCardSchema, bundle.report, problems);
  if (problems.length > 0 || !manifest || !report) throw new HarnessValidationError(problems);

  const actual = hashHarness(bundle.harness);
  if (manifest.harness.hash !== actual) throw hashMismatch(manifest.harness.hash, actual);
  if (manifest.harness.version !== bundle.harness.meta.version) {
    throw new HarnessValidationError([
      `${MANIFEST_FILE}: names harness version ${manifest.harness.version}, but the harness is version ${bundle.harness.meta.version}.`,
    ]);
  }
  const lines = bundle.lineage.map(lineageToLine);

  await writeHarness(dir, bundle.harness);
  await writeFile(join(dir, LINEAGE_FILE), lines.map((line) => `${line}\n`).join(''), 'utf8');
  await writeFile(join(dir, REPORT_FILE), renderReportMarkdown(report), 'utf8');
  await writeFile(join(dir, MANIFEST_FILE), stringifyYaml(mapKeys(manifest, camelToSnake)), 'utf8');
}

async function readRequired(
  dir: string,
  name: string,
  problems: string[],
): Promise<string | undefined> {
  try {
    return normalizeText(await readFile(join(dir, name), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    problems.push(`${name}: missing from ${dir}. A graduate folder has this file.`);
    return undefined;
  }
}

/**
 * Reads a graduate folder and checks all of it: the manifest, the lineage, the harness, and that
 * the harness still has the hash recorded in `graduate.yaml`. Throws a HarnessValidationError
 * otherwise, so a graduate whose files were changed after it was saved never loads.
 */
export async function readGraduate(dir: string): Promise<GraduateFolder> {
  const problems: string[] = [];
  const manifestText = await readRequired(dir, MANIFEST_FILE, problems);
  const reportMarkdown = await readRequired(dir, REPORT_FILE, problems);
  const lineageText = await readRequired(dir, LINEAGE_FILE, problems);

  let manifest: GraduateManifest | undefined;
  if (manifestText !== undefined) {
    try {
      const raw = parseYaml(manifestText);
      if (isRecord(raw)) {
        manifest = check(
          MANIFEST_FILE,
          GraduateManifestSchema,
          mapKeys(raw, snakeToCamel),
          problems,
        );
      } else {
        problems.push(`${MANIFEST_FILE}: expected a list of settings such as "name: value"`);
      }
    } catch (error) {
      problems.push(`${MANIFEST_FILE}: not valid YAML (${errorMessage(error)})`);
    }
  }

  let lineage: LineageEntry[] = [];
  if (lineageText !== undefined) {
    try {
      lineage = parseLineage(lineageText);
    } catch (error) {
      if (!(error instanceof HarnessValidationError)) throw error;
      problems.push(...error.errors);
    }
  }

  let harness: Harness | undefined;
  try {
    harness = await readHarness(dir);
  } catch (error) {
    if (!(error instanceof HarnessValidationError)) throw error;
    problems.push(...error.errors);
  }

  if (problems.length > 0 || !manifest || !harness || reportMarkdown === undefined) {
    throw new HarnessValidationError(problems);
  }
  const actual = hashHarness(harness);
  if (manifest.harness.hash !== actual) throw hashMismatch(manifest.harness.hash, actual);
  return { harness, manifest, reportMarkdown, lineage };
}
