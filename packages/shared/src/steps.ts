import type { JsonValue } from './json';
import type { WriteRecord } from './trace';

/*
 * How a tool call reads to a person: what it acted on and, once it returned, a few words about
 * what it gave back. The workspace's steps and the training screen's step playback both use these,
 * so a call reads the same wherever it shows.
 */

type JsonObject = { [key: string]: JsonValue };

const DETAIL_CHARS = 80;
const META_CHARS = 60;
/** Files code reads, as `files.read("data/orders.csv")` names them. */
const FILES_READ = /files\.read\(\s*(['"`])([^'"`]+)\1\s*\)/g;

/** What `ls` with no path acts on. */
export const ALL_FOLDERS = 'your folders';

/**
 * What a call acts on: `data/invoices.csv`, `data/bookings.csv for /T-07/`, the files code
 * reads, or a helper's arguments.
 */
export function describeCall(name: string, args: Record<string, JsonValue>): string {
  return clip(actedOn(name, args), DETAIL_CHARS);
}

function actedOn(name: string, args: Record<string, JsonValue>): string {
  switch (name) {
    case 'read':
    case 'write':
    case 'edit':
    case 'append':
      return format(args.path);
    case 'ls':
      return args.path === undefined || args.path === '' ? ALL_FOLDERS : format(args.path);
    case 'glob':
      return format(args.pattern);
    case 'grep': {
      const pattern = `/${format(args.pattern)}/`;
      return args.path === undefined || args.path === ''
        ? pattern
        : `${format(args.path)} for ${pattern}`;
    }
    case 'run':
      return codeTarget(typeof args.code === 'string' ? args.code : '');
    default:
      return fields(args);
  }
}

/** The files code reads, as `files.read("data/orders.csv")` names them, each once. */
export function filesRead(code: string): string[] {
  return [...new Set([...code.matchAll(FILES_READ)].map((match) => match[2] ?? ''))];
}

/** The files code reads, or its first line when it reads none. */
function codeTarget(code: string): string {
  const read = filesRead(code);
  if (read.length > 0) return read.join(', ');
  return code.trim().split('\n')[0] ?? '';
}

/** A short result, e.g. `596 lines`, `1 row added`, `3 matches` or `declined`. */
export function describeResult(
  name: string,
  result: JsonValue | null,
  change?: WriteRecord,
): string {
  if (change) return change.applied ? describeChange(change) : 'declined';
  if (typeof result !== 'string') return result === null ? '' : clip(summarize(result), META_CHARS);
  const lines = result.split('\n');
  switch (name) {
    case 'read': {
      const page = /^\[Lines (\d+)-(\d+) of (\d+)\./.exec(lines.at(-1) ?? '');
      if (page) return `lines ${page[1]}-${page[2]} of ${page[3]}`;
      if (/ is empty\.$/.test(result)) return 'empty';
      return count(lines.length, 'line');
    }
    case 'ls':
    case 'glob':
      if (result.startsWith('No files match')) return 'none';
      return count(
        lines.filter((line) => !line.startsWith('[')).length,
        name === 'ls' ? 'entry' : 'file',
        name === 'ls' ? 'entries' : 'files',
      );
    case 'grep': {
      if (result.startsWith('No lines match')) return 'no matches';
      const more = /^\[([\d,]+) matching lines?;/.exec(lines.at(-1) ?? '');
      return more ? `${more[1]} matches` : count(lines.length, 'match', 'matches');
    }
    case 'run':
      return clip(lines[0] ?? '', META_CHARS);
    default:
      return clip(result, META_CHARS);
  }
}

/**
 * A table read counted the way its table shows it, in rows: `5 rows`, or `rows 201-400 of 1,505`
 * for a page of a longer table of `total` data rows. Line 1 of the file is its header, so line n
 * holds row n - 1.
 */
export function describeRowsRead(total: number, result: JsonValue | null): string {
  const numbered = (typeof result === 'string' ? result.split('\n') : [])
    .map((line) => /^\s*(\d+)\t/.exec(line)?.[1])
    .filter((number): number is string => number !== undefined)
    .map(Number);
  const first = Math.max(2, numbered[0] ?? 2) - 1;
  const last = (numbered.at(-1) ?? total + 1) - 1;
  if (first <= 1 && last >= total) return count(total, 'row');
  return `rows ${first.toLocaleString('en-US')}-${last.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;
}

/** Lines a patch adds and removes, counted in its hunks only, so its file headers never count. */
export function patchStats(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  let inHunk = false;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && line.startsWith('+')) added += 1;
    else if (inHunk && line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}

/** What a change did, e.g. `1 row added` or `3 lines added, 1 removed`. */
function describeChange(change: WriteRecord): string {
  if (change.rows) {
    const { added, changed, removed } = change.rows;
    const parts = [
      added.length > 0 && `${count(added.length, 'row')} added`,
      changed.length > 0 && `${count(changed.length, 'row')} changed`,
      removed.length > 0 && `${count(removed.length, 'row')} removed`,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : 'saved';
  }
  const { added, removed } = patchStats(change.patch);
  if (change.op === 'write' && change.patch.startsWith('--- /dev/null')) {
    return `created, ${count(added, 'line')}`;
  }
  // An append only adds lines; a "removed" line is the old last line gaining its line break.
  if (change.op === 'append') return `${count(added - removed, 'line')} added`;
  return removed === 0
    ? `${count(added, 'line')} added`
    : `${count(added, 'line')} added, ${removed} removed`;
}

function fields(args: Record<string, JsonValue>): string {
  return Object.entries(args)
    .map(([key, value]) => `${key}: ${format(value)}`)
    .join(', ');
}

function summarize(value: JsonValue): string {
  if (Array.isArray(value)) return count(value.length, 'item');
  if (!isObject(value)) return format(value);
  const entries = Object.values(value);
  const flat =
    entries.length <= 3 && entries.every((entry) => !isObject(entry) && !Array.isArray(entry));
  return flat ? fields(value) : count(entries.length, 'field');
}

function format(value: JsonValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `[${value.map(format).join(', ')}]`;
  return isObject(value) ? JSON.stringify(value) : String(value);
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? noun : plural}`;
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
