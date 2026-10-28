import type { CellValue, RowDiff } from '@architect/shared';
import { createTwoFilesPatch, diffArrays } from 'diff';
import type { Row } from '../data/types';
import { lineCount } from './text';

const CONTEXT_LINES = 3;
/**
 * How much work a diff may do. A change past either limit, such as rewriting every row of a
 * large table, is shown as the whole file replaced instead of holding up the engine.
 */
const LIMITS = { maxEditLength: 4000, timeout: 500 };
/** The longest patch kept; past it, the change is shown as the whole file replaced. */
const MAX_PATCH_CHARS = 200_000;

/** A change to a file's text: a unified diff, or a note that the whole file was replaced. */
export interface FilePatch {
  patch: string;
  /** True when the change was too large to diff, so the patch only says the file was replaced. */
  whole: boolean;
}

/**
 * A unified diff of a file's text with three lines of context, from `/dev/null` for a file the
 * change creates. Its first lines name the file.
 */
export function filePatch(path: string, before: string | null, after: string): FilePatch {
  const from = before === null ? '/dev/null' : `a/${path}`;
  const patch = createTwoFilesPatch(from, `b/${path}`, before ?? '', after, undefined, undefined, {
    context: CONTEXT_LINES,
    ...LIMITS,
  });
  if (patch !== undefined && patch.length <= MAX_PATCH_CHARS) {
    return { patch: patch.replace(/^=+\n/, ''), whole: false };
  }
  const counts = `-1,${lineCount(before ?? '')} +1,${lineCount(after)}`;
  return {
    patch: `--- ${from}\n+++ b/${path}\n@@ ${counts} @@ the whole file was replaced\n`,
    whole: true,
  };
}

/**
 * The rows one version of a table adds, removes and changes from another, or undefined when the
 * change is too large to diff. Rows are matched in order; where removed rows are directly
 * followed by added ones, they pair up as changed rows, and what is left of either run stays
 * removed or added.
 */
export function rowDiff(
  columns: readonly string[],
  before: readonly Row[],
  after: readonly Row[],
): RowDiff | undefined {
  const cells = (row: Row): CellValue[] => columns.map((column) => row[column] ?? null);
  const key = (row: Row) => JSON.stringify(cells(row));
  const parts = diffArrays(before.map(key), after.map(key), LIMITS);
  if (parts === undefined) return undefined;
  const diff: RowDiff = { columns: [...columns], added: [], removed: [], changed: [] };
  const parse = (value: string) => JSON.parse(value) as CellValue[];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part || (!part.added && !part.removed)) continue;
    const next = parts[index + 1];
    if (part.removed && next?.added) {
      const paired = Math.min(part.value.length, next.value.length);
      for (let at = 0; at < paired; at += 1) {
        diff.changed.push({
          before: parse(part.value[at] ?? '[]'),
          after: parse(next.value[at] ?? '[]'),
        });
      }
      diff.removed.push(...part.value.slice(paired).map(parse));
      diff.added.push(...next.value.slice(paired).map(parse));
      index += 1;
    } else if (part.removed) {
      diff.removed.push(...part.value.map(parse));
    } else {
      diff.added.push(...part.value.map(parse));
    }
  }
  return diff;
}
