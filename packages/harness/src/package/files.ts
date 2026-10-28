import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PackageError,
  packagePathProblem,
  type IntegrityEntry,
  type PackageManifest,
} from '@architect/shared';
import { compareText } from '../text';

/** The manifest of a format 2 package. */
export const PACKAGE_MANIFEST_FILE = 'graduate.json';

/**
 * How much a package may hold. A LoRA adapter for a 30B model is a few hundred megabytes; the
 * caps leave room for that and stay inside a ZIP without 64-bit extensions.
 */
export interface PackageLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  /** `graduate.json` is read whole before anything else, so it gets a small cap of its own. */
  maxManifestBytes: number;
}

export const PACKAGE_LIMITS: PackageLimits = {
  maxFiles: 2_000,
  maxFileBytes: 2 * 1024 ** 3,
  maxTotalBytes: 4 * 1024 ** 3 - 1,
  maxManifestBytes: 1024 ** 2,
};

export interface PackageFileInfo {
  path: string;
  size: number;
}

const bytes = (count: number): string =>
  count >= 1024 ** 2 ? `${(count / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(count / 1024)} KB`;

/**
 * Files that file managers write into any folder they show: Finder's `.DS_Store` and `._` files
 * and the `__MACOSX` folder of its archives, Explorer's `Thumbs.db` and `desktop.ini`. They are
 * never part of a package, so they are passed over rather than refused.
 */
const OS_NOISE = /^(\.DS_Store|\._.*|__MACOSX|Thumbs\.db|desktop\.ini)$/i;

export function isOsNoise(name: string): boolean {
  return OS_NOISE.test(name);
}

/** Folders are compared the way Windows and macOS do: one file whatever the letter case. */
export function sameFileKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

/**
 * Every file under `dir`, as package paths in path order, passing over what file managers leave
 * behind. Refuses anything that isn't a plain file or folder (links, junctions, devices), any path
 * that isn't a portable package path, two names that would be one file on Windows or macOS, and
 * more files or bytes than the limits.
 */
export async function listPackageFiles(
  dir: string,
  limits: PackageLimits = PACKAGE_LIMITS,
): Promise<PackageFileInfo[]> {
  const files: PackageFileInfo[] = [];
  const seen = new Map<string, string>();
  let total = 0;

  async function walk(relative: string): Promise<void> {
    const absolute = relative === '' ? dir : join(dir, ...relative.split('/'));
    for (const entry of await readdir(absolute, { withFileTypes: true })) {
      if (isOsNoise(entry.name)) continue;
      const path = relative === '' ? entry.name : `${relative}/${entry.name}`;
      const problem = packagePathProblem(path);
      if (problem !== null) throw new PackageError('unsafe_path', [`"${path}" ${problem}.`]);
      const key = sameFileKey(path);
      const earlier = seen.get(key);
      if (earlier !== undefined) {
        throw new PackageError('unsafe_path', [
          `"${path}" and "${earlier}" would be the same file on Windows and macOS.`,
        ]);
      }
      seen.set(key, path);
      const info = await lstat(join(absolute, entry.name));
      if (info.isSymbolicLink()) {
        throw new PackageError('link', [`"${path}" is a link. A package holds only plain files.`]);
      }
      if (info.isDirectory()) {
        await walk(path);
        continue;
      }
      if (!info.isFile()) {
        throw new PackageError('link', [`"${path}" isn't a plain file.`]);
      }
      if (files.length + 1 > limits.maxFiles) {
        throw new PackageError('too_many_files', [
          `The package has more than ${limits.maxFiles} files.`,
        ]);
      }
      if (info.size > limits.maxFileBytes) {
        throw new PackageError('too_large', [
          `"${path}" is ${bytes(info.size)}, over the ${bytes(limits.maxFileBytes)} a package file may be.`,
        ]);
      }
      total += info.size;
      if (total > limits.maxTotalBytes) {
        throw new PackageError('too_large', [
          `The package holds more than ${bytes(limits.maxTotalBytes)}.`,
        ]);
      }
      files.push({ path, size: info.size });
    }
  }

  await walk('');
  return files.sort((a, b) => compareText(a.path, b.path));
}

/** sha256 of a file's bytes, as 64 hex digits, read in chunks so large files stay out of memory. */
export async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export function sha256Bytes(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

/** The integrity entries for files under `dir`, in the order given. */
export async function integrityOf(
  dir: string,
  files: readonly PackageFileInfo[],
): Promise<IntegrityEntry[]> {
  const entries: IntegrityEntry[] = [];
  for (const file of files) {
    entries.push({
      path: file.path,
      sha256: await sha256File(join(dir, ...file.path.split('/'))),
      size: file.size,
    });
  }
  return entries;
}

/**
 * Checks that the files under `dir` are exactly the ones the manifest lists, byte for byte:
 * nothing missing, nothing extra, every size and checksum equal. Throws a PackageError.
 */
export async function verifyIntegrity(
  dir: string,
  manifest: Pick<PackageManifest, 'integrity'>,
  files: readonly PackageFileInfo[],
): Promise<void> {
  const present = new Map(
    files.filter((file) => file.path !== PACKAGE_MANIFEST_FILE).map((file) => [file.path, file]),
  );
  const listed = new Set<string>();
  const problems: string[] = [];
  for (const entry of manifest.integrity.files) {
    if (entry.path === PACKAGE_MANIFEST_FILE) {
      problems.push(`${PACKAGE_MANIFEST_FILE} lists itself; it can't carry its own checksum.`);
      continue;
    }
    if (listed.has(entry.path)) problems.push(`"${entry.path}" is listed twice.`);
    listed.add(entry.path);
  }
  if (problems.length > 0) throw new PackageError('invalid_manifest', problems);

  const missing = [...listed].filter((path) => !present.has(path));
  if (missing.length > 0) {
    throw new PackageError(
      'missing_file',
      missing.map((path) => `"${path}" is listed in ${PACKAGE_MANIFEST_FILE} but missing.`),
    );
  }
  const unlisted = [...present.keys()].filter((path) => !listed.has(path));
  if (unlisted.length > 0) {
    throw new PackageError(
      'unlisted_file',
      unlisted.map((path) => `"${path}" is in the package but not in ${PACKAGE_MANIFEST_FILE}.`),
    );
  }
  for (const entry of manifest.integrity.files) {
    const file = present.get(entry.path);
    if (!file) continue;
    if (file.size !== entry.size) {
      problems.push(`"${entry.path}" is ${file.size} bytes; the manifest says ${entry.size}.`);
      continue;
    }
    const actual = await sha256File(join(dir, ...entry.path.split('/')));
    if (actual !== entry.sha256) {
      problems.push(
        `"${entry.path}" doesn't match its checksum: it changed after it was packaged.`,
      );
    }
  }
  if (problems.length > 0) throw new PackageError('checksum', problems);
}
