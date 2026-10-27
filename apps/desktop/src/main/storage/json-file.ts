import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Reads and parses a JSON file. A missing file gives null; unreadable JSON throws. */
export async function readJsonFile(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
  return JSON.parse(text) as unknown;
}

/** Writes through a temporary file and a rename, so a crash never leaves half a file. */
export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
