import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LineageEntry } from '@architect/shared';
import { LineageEntrySchema } from '@architect/shared';
import { errorMessage, parseJson } from './codec';
import { HarnessValidationError } from './errors';
import { camelToSnake, mapKeys, snakeToCamel } from './keys';
import { check } from './parse';
import { normalizeText } from './text';

export const LINEAGE_FILE = 'lineage.jsonl';

/** One line of lineage.jsonl, without the newline. Keys are snake_case on disk like the other files. */
export function lineageToLine(entry: LineageEntry): string {
  const problems: string[] = [];
  const checked = check(LINEAGE_FILE, LineageEntrySchema, entry, problems);
  if (!checked) throw new HarnessValidationError(problems);
  return JSON.stringify(mapKeys(checked, camelToSnake));
}

/** Parses the text of a lineage file, reporting every bad line with its number. */
export function parseLineage(text: string, label = LINEAGE_FILE): LineageEntry[] {
  const problems: string[] = [];
  const entries: LineageEntry[] = [];
  normalizeText(text)
    .split('\n')
    .forEach((line, index) => {
      if (line.trim() === '') return;
      const where = `${label} line ${index + 1}`;
      let raw: unknown;
      try {
        raw = parseJson(line);
      } catch (error) {
        problems.push(`${where}: not valid JSON (${errorMessage(error)})`);
        return;
      }
      const entry = check(where, LineageEntrySchema, mapKeys(raw, snakeToCamel), problems);
      if (entry) entries.push(entry);
    });
  if (problems.length > 0) throw new HarnessValidationError(problems);
  return entries;
}

/** Adds one hypothesis to the end of a lineage file, creating the file and its folder if needed. */
export async function appendLineage(path: string, entry: LineageEntry): Promise<void> {
  const line = lineageToLine(entry);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${line}\n`, 'utf8');
}

/** Every entry in a lineage file, checked line by line. A file that does not exist yet is empty. */
export async function readLineage(path: string): Promise<LineageEntry[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return parseLineage(text);
}
