import { OUTPUT_FOLDER, SKILLS_FOLDER } from '@architect/shared';
import type { AgentFile, AgentFiles } from '../files/agent-files';
import { count, linesOf } from '../files/text';
import { ToolError } from './errors';
import { cutText } from './results';

/** A line longer than this is cut when it is read. */
export const MAX_LINE_CHARS = 2000;
/** Characters of a matching line `grep` shows. */
export const GREP_LINE_CHARS = 300;
/** Paths `glob` lists at most. */
export const MAX_GLOB_PATHS = 200;
/** Room kept at the end of a read for the line that says how to read on. */
const NOTE_ROOM = 120;

export interface ReadPage {
  content: string;
  /** The first and last line shown, counting from 1. */
  from: number;
  to: number;
  /** Lines in the whole file. */
  total: number;
}

/**
 * Lines of a file, numbered (line number, a tab, the text), from `offset` for up to `limit`
 * lines or as many as fit the budget. When lines are left, a last line says how many and where
 * to read on.
 */
export function readPage(
  path: string,
  text: string,
  offset: number,
  limit: number,
  budget: number,
): ReadPage {
  const lines = linesOf(text);
  const total = lines.length;
  if (total === 0) return { content: `${path} is empty.`, from: 0, to: 0, total: 0 };
  if (offset > total) {
    throw new ToolError(`${path} has ${count(total, 'line')}, so there is no line ${offset}.`);
  }
  const last = Math.min(total, offset + limit - 1);
  const width = String(last).length;
  const room = budget - NOTE_ROOM;
  const shown: string[] = [];
  let size = 0;
  for (let number = offset; number <= last; number += 1) {
    const raw = lines[number - 1] ?? '';
    const body =
      raw.length > MAX_LINE_CHARS
        ? `${raw.slice(0, MAX_LINE_CHARS)}… (${count(raw.length - MAX_LINE_CHARS, 'more character')})`
        : raw;
    let line = `${String(number).padStart(width)}\t${body}`;
    if (shown.length > 0 && size + line.length + 1 > room) break;
    if (line.length > room) line = `${line.slice(0, room)}…`;
    shown.push(line);
    size += line.length + 1;
  }
  const to = offset + shown.length - 1;
  const note =
    to < total
      ? `\n[Lines ${offset}-${to} of ${total}. ${count(total - to, 'more line')}: read on with offset ${to + 1}.]`
      : '';
  return { content: `${shown.join('\n')}${note}`, from: offset, to, total };
}

function access(file: AgentFile): string {
  return file.writable ? 'writable' : 'read-only';
}

/** Files as rows of a plain table: path, kind, size in lines and whether it can change. */
function fileRows(files: readonly AgentFile[]): string {
  const width = Math.max(...files.map((file) => file.path.length));
  const lineWidth = Math.max(...files.map((file) => count(file.lines, 'line').length));
  return files
    .map((file) =>
      [
        file.path.padEnd(width),
        file.kind.padEnd(5),
        count(file.lines, 'line').padStart(lineWidth),
        access(file),
      ].join('  '),
    )
    .join('\n');
}

/** What `ls` shows: the top folders, or every file in one folder, or one file. */
export function listing(files: AgentFiles, path: string, budget: number): string {
  if (path === '') {
    const all = files.list();
    const inArea = (area: AgentFile['area']) => all.filter((file) => file.area === area);
    const data = inArea('data');
    const writable = data.filter((file) => file.writable).length;
    const lines = [
      `data/     ${count(data.length, 'file')}${writable > 0 ? `, ${writable} writable` : ', read-only'}`,
    ];
    if (files.hasOutput) {
      const output = inArea('output');
      lines.push(
        `${OUTPUT_FOLDER}/   ${output.length === 0 ? 'empty' : count(output.length, 'file')}, writable`,
      );
    }
    const skills = inArea('skills');
    if (skills.length > 0)
      lines.push(`${SKILLS_FOLDER}/   ${count(skills.length, 'skill')}, read-only`);
    return lines.join('\n');
  }
  const single = files.file(path);
  if (single) return fileRows([single]);
  if (!files.isFolder(path)) files.read(path);
  const inside = files.list().filter((file) => file.path.startsWith(`${path}/`));
  if (inside.length === 0) return `${path}/ is empty.`;
  return cutText(fileRows(inside), budget, 'list a folder inside it');
}

/** What `glob` shows: the matching paths, one a line. */
export function globList(pattern: string, paths: readonly string[]): string {
  if (paths.length === 0) return `No files match ${pattern}.`;
  const shown = paths.slice(0, MAX_GLOB_PATHS).join('\n');
  return paths.length > MAX_GLOB_PATHS
    ? `${shown}\n[${paths.length} files match; showing the first ${MAX_GLOB_PATHS}. Narrow the pattern.]`
    : shown;
}

/** What `grep` shows: one `path:line: text` per matching line, with a count when there are more. */
export function grepList(
  matches: readonly { path: string; line: number; text: string }[],
  total: number,
  where: string,
  budget: number,
): string {
  if (total === 0) return `No lines match in ${where}.`;
  const room = budget - NOTE_ROOM;
  const lines: string[] = [];
  let size = 0;
  for (const match of matches) {
    const line = `${match.path}:${match.line}: ${match.text}`;
    if (lines.length > 0 && size + line.length + 1 > room) break;
    lines.push(line.length > room ? `${line.slice(0, room)}…` : line);
    size += line.length + 1;
  }
  return lines.length < total
    ? `${lines.join('\n')}\n[${count(total, 'matching line')}; showing ${lines.length}. Narrow the pattern or the path, or raise limit.]`
    : lines.join('\n');
}

/**
 * What `run` shows: what the code printed, then `=> ` and its last value as JSON when it had
 * one, cut to the budget.
 */
export function runOutput(
  printed: string,
  cut: boolean,
  value: string | null,
  budget: number,
): string {
  const parts: string[] = [];
  const out = printed.endsWith('\n') ? printed.slice(0, -1) : printed;
  if (out !== '') parts.push(out);
  if (cut) parts.push('[It printed more than run keeps; the rest was dropped.]');
  if (value !== null) parts.push(`=> ${value}`);
  const text = parts.length === 0 ? '(no output)' : parts.join('\n');
  return cutText(text, budget, 'print less, or filter or add up in the code');
}
