import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Writes through a temporary file and a rename, so a crash never leaves half a file behind. */
async function writeAtomically(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, file);
}

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await writeAtomically(file, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonFile(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeJsonLines(file: string, values: readonly unknown[]): Promise<void> {
  await writeAtomically(file, values.map((value) => `${JSON.stringify(value)}\n`).join(''));
}

/** Every line of a JSON Lines file; a file that doesn't exist yet has none. */
export async function readJsonLines(file: string): Promise<unknown[]> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}
