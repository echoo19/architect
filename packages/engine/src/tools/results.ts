import type { JsonValue } from '@architect/shared';
import { DataError } from '../data/errors';
import type { ReadResult } from '../data/table-store';

/** Characters a tool result may take in the conversation. Glimmer's context is small. */
export const DEFAULT_RESULT_BUDGET = 8000;
export const MIN_RESULT_BUDGET = 1000;
const ERROR_LIMIT = 1000;

export interface RenderedResult {
  /** The tool message content the model reads. */
  content: string;
  /** The result as the model saw it: the value, or the cut text when it was too long. */
  result: JsonValue;
}

/** Serializes a result, cutting it to the budget with a note saying so. */
export function renderResult(value: JsonValue, budget: number): RenderedResult {
  const json = JSON.stringify(value);
  if (json.length <= budget) return { content: json, result: value };
  const content = `${json.slice(0, budget)} [cut: the result was ${json.length} characters and the limit is ${budget}; ask for less]`;
  return { content, result: content };
}

export function renderError(message: string): { content: string; error: string } {
  const error = message.length > ERROR_LIMIT ? `${message.slice(0, ERROR_LIMIT)}…` : message;
  return { content: JSON.stringify({ error }), error };
}

/** A read_table result with as many rows as fit the budget, and a note on how to get the rest. */
export function fitTable(
  file: string,
  result: ReadResult,
  offset: number,
  budget: number,
): JsonValue {
  const rows = result.rows.map((row) => result.columns.map((column) => row[column] ?? null));
  const build = (count: number): JsonValue => {
    const end = offset + count;
    const value: Record<string, JsonValue> = {
      file,
      columns: result.columns,
      rows: rows.slice(0, count),
      total: result.total,
      truncated: end < result.total,
    };
    if (end < result.total) {
      value.note = tableNote(offset, count, result.total, count < rows.length);
    }
    return value;
  };
  return build(largestCount(rows.length, (count) => size(build(count)) <= budget));
}

/** A read_text result: the whole text, or the part that fits, ending at a line break if it can. */
export function fitText(file: string, text: string, offset: number, budget: number): JsonValue {
  if (offset > text.length) {
    throw new DataError(
      `offset ${offset} is past the end of ${file}, which has ${text.length} characters.`,
    );
  }
  const whole = { file, text: text.slice(offset) };
  if (size(whole) <= budget) return whole;

  const part = (length: number): JsonValue => ({
    file,
    text: text.slice(offset, offset + length),
    total_chars: text.length,
    next_offset: offset + length,
    note: `This is part of ${file}. Call read_text again with offset ${offset + length} for the rest.`,
  });
  const length = largestCount(text.length - offset, (count) => size(part(count)) <= budget);
  const throughLineBreak = text.lastIndexOf('\n', offset + length - 1) + 1 - offset;
  return part(throughLineBreak > length / 2 ? throughLineBreak : length);
}

function size(value: JsonValue): number {
  return JSON.stringify(value).length;
}

/** The largest count from 0 to max that fits, by binary search (fit shrinks as count grows). */
function largestCount(max: number, fits: (count: number) => boolean): number {
  if (fits(max)) return max;
  let low = 0;
  let high = max;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

function tableNote(offset: number, count: number, total: number, cutForSize: boolean): string {
  const end = offset + count;
  const shown =
    count > 0
      ? `Rows ${offset + 1} to ${end} of ${total} are shown`
      : `${total} rows match and none are shown`;
  const reason = cutForSize ? ' to stay within the size limit' : '';
  const fewer = cutForSize ? ', or ask for fewer columns' : '';
  return `${shown}${reason}. Read again with offset ${end} for more${fewer}.`;
}
