import { lstat, mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Harness } from '@architect/shared';
import { HARNESS_FORMAT, isHarnessSurfacePath } from '@architect/shared';
import { HarnessValidationError } from './errors';
import { hashFiles, hashHarness } from './hash';
import { hasFormat1Layout, migrateFormat1 } from './legacy';
import { parseMeta, type StoredFormat } from './parse';
import {
  HARNESS_DIRS,
  HARNESS_ROOT_FILES,
  LEGACY_SKILL,
  LEGACY_SYSTEM_PATH,
  META_PATH,
  SKILLS_DIR,
} from './paths';
import { harnessToFiles, metaToFile } from './serialize';
import { normalizeText } from './text';
import { filesToHarness, MAX_HARNESS_BYTES, validateHarnessFiles } from './validate';

/** Files that file managers and editors drop into folders; they are never part of a harness. */
const OS_NOISE = /^(\..*|Thumbs\.db|desktop\.ini)$/i;

const absolute = (dir: string, relativePath: string): string =>
  join(dir, ...relativePath.split('/'));

/** The regular files directly inside a folder, by name. Links and other entries are skipped. */
async function filesIn(dir: string): Promise<string[]> {
  const info = await lstat(dir).catch(() => undefined);
  if (!info?.isDirectory()) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && !OS_NOISE.test(entry.name)).map((e) => e.name);
}

/**
 * The relative paths of the regular files in a folder that could belong to a harness: the
 * top-level files, the files in tools/ and examples/, and in skills/ both its files and the
 * files of each skill's folder. Symbolic links are skipped so an imported folder cannot pull in
 * files from elsewhere.
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
    for (const name of await filesIn(join(dir, sub))) paths.push(`${sub}/${name}`);
  }
  const skills = await lstat(join(dir, SKILLS_DIR)).catch(() => undefined);
  if (skills?.isDirectory()) {
    for (const entry of await readdir(join(dir, SKILLS_DIR), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const name of await filesIn(join(dir, SKILLS_DIR, entry.name))) {
        paths.push(`${SKILLS_DIR}/${entry.name}/${name}`);
      }
    }
  }
  return paths;
}

/** Every harness file in a folder as stored, `harness.yaml` included, line endings normalized. */
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

/** The files of a folder in the current format: a format 1 folder's files are migrated. */
export function currentFormatFiles(
  files: Readonly<Record<string, string>>,
  format: StoredFormat,
): Record<string, string> {
  if (format === HARNESS_FORMAT) return { ...files };
  const problems: string[] = [];
  const migrated = migrateFormat1(files, problems);
  if (problems.length > 0) throw new HarnessValidationError(problems);
  return migrated;
}

/** The format a folder's files are in, when no harness.yaml says: format 1 by its file names. */
export function layoutFormat(files: Readonly<Record<string, string>>): StoredFormat {
  return hasFormat1Layout(files) ? 1 : HARNESS_FORMAT;
}

/** A harness folder as read, in the current format, with the hashes that tell if it changed. */
export interface StoredHarness {
  /**
   * The harness in the current format. Its `meta.hash` is over its files in that format, so a
   * folder saved in format 1 gets a new hash when it is read.
   */
  harness: Harness;
  /** The format the folder was saved in. */
  format: StoredFormat;
  /** The hash harness.yaml recorded for the folder's files when they were saved. */
  recordedHash: string;
  /**
   * The hash of the folder's files as they are now, comparable with the hash recorded when they
   * were saved: for the current format, over the files as the harness writes them; for format 1,
   * over the files as stored.
   */
  filesHash: string;
}

/**
 * Reads and validates a harness folder, migrating a format 1 folder to the current format in
 * memory. Throws a HarnessValidationError that lists every problem.
 */
export async function readStoredHarness(dir: string): Promise<StoredHarness> {
  const files = await readHarnessFiles(dir);
  const metaText = files[META_PATH];
  if (metaText === undefined) {
    throw new HarnessValidationError([
      `${META_PATH}: missing from ${dir}. A harness folder starts with a harness.yaml that names it.`,
    ]);
  }
  const problems: string[] = [];
  const parsed = parseMeta(metaText, problems);
  if (!parsed) throw new HarnessValidationError(problems);
  const harness = filesToHarness(currentFormatFiles(files, parsed.format), parsed.meta);
  const recordedHash = parsed.meta.hash;
  if (parsed.format === HARNESS_FORMAT) {
    return { harness, format: parsed.format, recordedHash, filesHash: hashHarness(harness) };
  }
  return {
    harness: { ...harness, meta: { ...harness.meta, hash: hashHarness(harness) } },
    format: parsed.format,
    recordedHash,
    filesHash: hashFiles(files),
  };
}

/** Reads and validates a harness folder. Throws a HarnessValidationError that lists every problem. */
export async function readHarness(dir: string): Promise<Harness> {
  return (await readStoredHarness(dir)).harness;
}

/** True for a file this version writes or an older one did, which a rewrite replaces. */
function isReplaceable(path: string): boolean {
  return isHarnessSurfacePath(path) || path === LEGACY_SYSTEM_PATH || LEGACY_SKILL.test(path);
}

/**
 * Writes a harness as a folder in the current format, replacing what was there: files the
 * harness no longer has are removed, format 1 files included, and files that are not part of a
 * harness (such as graduate.yaml) are left alone. The harness is validated first and nothing is
 * written if it is invalid. `harness.yaml` goes last and carries the hash of the files as written.
 */
export async function writeHarness(dir: string, harness: Harness): Promise<void> {
  const files = harnessToFiles(harness);
  const meta = { ...harness.meta, hash: hashFiles(files) };
  const result = validateHarnessFiles(files, meta);
  if (!result.ok) throw new HarnessValidationError(result.errors);

  await mkdir(dir, { recursive: true });
  for (const path of await listHarnessPaths(dir)) {
    if (isReplaceable(path) && !Object.hasOwn(files, path)) {
      await rm(absolute(dir, path), { force: true });
      const folder = path.split('/');
      // A skill's folder goes with its last file.
      if (folder[0] === SKILLS_DIR && folder.length === 3) {
        await rmdir(join(dir, SKILLS_DIR, folder[1] ?? '')).catch(() => undefined);
      }
    }
  }
  for (const [path, content] of Object.entries(files)) {
    const file = absolute(dir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  }
  await writeFile(join(dir, META_PATH), metaToFile(meta), 'utf8');
}
