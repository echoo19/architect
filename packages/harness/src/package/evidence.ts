import {
  LineageEntrySchema,
  PackageError,
  ReportCardSchema,
  type LineageEntry,
  type ReportCard,
} from '@architect/shared';
import { errorMessage } from '../codec';
import { HarnessValidationError } from '../errors';
import { camelToSnake, mapKeys, snakeToCamel } from '../keys';
import { lineageToLine, parseLineage } from '../lineage';
import { check } from '../parse';

/** Where a package keeps the author's evidence. */
export const EVIDENCE_FILES = {
  report: 'evidence/report.json',
  reportMarkdown: 'evidence/report.md',
  lineage: 'evidence/lineage.jsonl',
} as const;

/** The report card as `report.json` holds it: snake_case keys, like the format 1 folder. */
export function reportToJson(report: ReportCard): string {
  const problems: string[] = [];
  const checked = check('report.json', ReportCardSchema, report, problems);
  if (!checked) throw new HarnessValidationError(problems);
  return `${JSON.stringify(mapKeys(checked, camelToSnake), null, 2)}\n`;
}

export function parseReportJson(text: string, label = EVIDENCE_FILES.report): ReportCard {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new PackageError('invalid_manifest', [
      `${label} isn't valid JSON (${errorMessage(error)}).`,
    ]);
  }
  const problems: string[] = [];
  const report = check(label, ReportCardSchema, mapKeys(raw, snakeToCamel), problems);
  if (!report) throw new PackageError('invalid_manifest', problems);
  return report;
}

/**
 * A change history fit to leave this computer: each round's title, the files it changed, the
 * effect it predicted and the one dev measured, and the decision. The mentor's diagnosis and the
 * reasoning behind its prediction quote attempts on the author's data, and the task ids name
 * them, so they are left out; the full lineage stays with the run.
 */
export function sanitizeLineage(entries: readonly LineageEntry[]): LineageEntry[] {
  return entries.map((entry) =>
    LineageEntrySchema.parse({
      ...entry,
      diagnosis: '',
      causeTaskIds: [],
      predicted: { ...entry.predicted, rationale: '' },
    }),
  );
}

export function lineageToJsonl(entries: readonly LineageEntry[]): string {
  return entries.map((entry) => `${lineageToLine(entry)}\n`).join('');
}

export function parseLineageJsonl(text: string): LineageEntry[] {
  try {
    return parseLineage(text, EVIDENCE_FILES.lineage);
  } catch (error) {
    if (error instanceof HarnessValidationError) {
      throw new PackageError('invalid_manifest', [...error.errors]);
    }
    throw error;
  }
}
