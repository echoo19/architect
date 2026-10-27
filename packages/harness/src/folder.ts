import { lstat, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Harness } from '@architect/shared';
import { isHarnessSurfacePath } from '@architect/shared';
import { HarnessValidationError } from './errors';
import { hashFiles } from './hash';
import { HARNESS_DIRS, HARNESS_ROOT_FILES, META_PATH } from './paths';
import { harnessToFiles, metaToFile } from './serialize';
import { normalizeText } from './text';
import { MAX_HARNESS_BYTES, filesToHarness, validateHarnessFiles } from './validate';
import { parseMeta } from './parse';

/** Files that file managers and editors drop into folders; they are never part of a harness. */
const OS_NOISE = /^(\..*|Thumbs\.db|desktop\.ini)$/i;

const absolute = (dir: string, relativePath: string): string =>
  join(dir, ...relativePath.split('/'));

/**
 * The relative paths of the regular files in a folder that could belong to a harness.
 * Symbolic links are skipped so an imported folder cannot pull in files from elsewhere.
 */
async function listHarnessPaths(dir: string): Promise<string[]> {
  const info = await stat(dir).catch(() => undefined);
  if (!info?.isDirectory()) {
    throw new HarnessValidationError([`${dir}: this folder does not exist.`]);
  }
  const paths: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isFile() && HARNESS_ROOT_FILES.some((file) => file === entry.name)) {
      paths.push(entry.name);
    }
  }
  for (const sub of HARNESS_DIRS) {
    const subInfo = await lstat(join(dir, sub)).catch(() => undefined);
    if (!subInfo?.isDirectory()) continue;
    for (const entry of await readdir(join(dir, sub), { withFileTypes: true })) {
      if (entry.isFile() && !OS_NOISE.test(entry.name)) paths.push(`${sub}/${entry.name}`);
    }
  }
  return paths;
}

/** Every harness file in a folder as text, `harness.yaml` included, line endings normalized. */
export async function readHarnessFiles(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const path of await listHarnessPaths(dir)) {
    const file = absolute(dir, path);
    const { size } = await stat(file);
    if (size > MAX_HARNESS_BYTES) {
      throw new HarnessValidationError([
        `${path}: ${Math.ceil(size / 1024)} KB is over the ${MAX_HARNESS_BYTES / 1024} KB limit for a whole harness.`,
      ]);
    }
    files[path] = normalizeText(await readFile(file, 'utf8'));
  }
  return files;
}

/** Reads and validates a harness folder. Throws a HarnessValidationError that lists every problem. */
export async function readHarness(dir: string): Promise<Harness> {
  const files = await readHarnessFiles(dir);
  const metaText = files[META_PATH];
  if (metaText === undefined) {
    throw new HarnessValidationError([
      `${META_PATH}: missing from ${dir}. A harness folder starts with a harness.yaml that names it.`,
    ]);
  }
  const problems: string[] = [];
  const meta = parseMeta(metaText, problems);
  if (!meta) throw new HarnessValidationError(problems);
  return filesToHarness(files, meta);
}

/**
 * Writes a harness as a folder, replacing what was there: files the harness no longer has are
 * removed, files that are not part of a harness (such as graduate.yaml) are left alone. The
 * harness is validated first and nothing is written if it is invalid. `harness.yaml` goes last
 * and carries the hash of the files as written.
 */
export async function writeHarness(dir: string, harness: Harness): Promise<void> {
  const files = harnessToFiles(harness);
  const meta = { ...harness.meta, hash: hashFiles(files) };
  const result = validateHarnessFiles(files, meta);
  if (!result.ok) throw new HarnessValidationError(result.errors);

  await mkdir(dir, { recursive: true });
  for (const path of await listHarnessPaths(dir)) {
    if (isHarnessSurfacePath(path) && !Object.hasOwn(files, path)) {
      await rm(absolute(dir, path), { force: true });
    }
  }
  for (const [path, content] of Object.entries(files)) {
    const file = absolute(dir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  }
  await writeFile(join(dir, META_PATH), metaToFile(meta), 'utf8');
}
