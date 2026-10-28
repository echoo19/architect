import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { PackageError, packagePathProblem, type PackageManifest } from '@architect/shared';
import {
  integrityOf,
  listPackageFiles,
  PACKAGE_LIMITS,
  PACKAGE_MANIFEST_FILE,
  verifyIntegrity,
  type PackageFileInfo,
  type PackageLimits,
} from './files';
import { manifestDigest, parseManifest, serializeManifest } from './manifest';

/** A file to put in a package: text or bytes, or a file on disk to copy. */
export type PackageEntry =
  { path: string; content: string | Uint8Array } | { path: string; source: string };

/** A manifest still to be completed: its integrity section is computed from the files. */
export type ManifestDraft = Omit<PackageManifest, 'integrity'>;

export interface WrittenPackage {
  manifest: PackageManifest;
  /** sha256 of `graduate.json`. */
  digest: string;
  files: PackageFileInfo[];
}

const absolute = (dir: string, path: string): string => join(dir, ...path.split('/'));

/**
 * Writes a package folder: every entry, then `graduate.json` with the checksum of each file,
 * last. The folder is built beside `dir` and renamed into place, so a package folder is either
 * complete or absent. `dir` must not exist yet.
 */
export async function writePackage(
  dir: string,
  draft: ManifestDraft,
  entries: readonly PackageEntry[],
): Promise<WrittenPackage> {
  for (const entry of entries) {
    const problem =
      entry.path === PACKAGE_MANIFEST_FILE
        ? `is written from the manifest`
        : packagePathProblem(entry.path);
    if (problem !== null) throw new PackageError('unsafe_path', [`"${entry.path}" ${problem}.`]);
  }
  if (await stat(dir).catch(() => null)) {
    throw new Error(`${dir} already exists; a package version is never written over.`);
  }
  const staging = `${dir}.partial`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    for (const entry of entries) {
      const target = absolute(staging, entry.path);
      await mkdir(dirname(target), { recursive: true });
      if ('source' in entry) await copyFile(entry.source, target);
      else await writeFile(target, entry.content, { flag: 'wx' });
    }
    const files = await listPackageFiles(staging);
    const manifest: PackageManifest = {
      ...draft,
      integrity: { algorithm: 'sha256', files: await integrityOf(staging, files) },
    };
    const text = serializeManifest(manifest);
    await writeFile(join(staging, PACKAGE_MANIFEST_FILE), text, { flag: 'wx' });
    await rename(staging, dir);
    return { manifest, digest: manifestDigest(text), files };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export interface ReadPackage {
  manifest: PackageManifest;
  digest: string;
  /** Every file but `graduate.json`, in path order. */
  files: PackageFileInfo[];
  bytes: number;
}

/**
 * Reads and checks a package folder without running anything in it: the folder holds only plain
 * files under portable names and within the limits, `graduate.json` parses as format 2, and the
 * other files are exactly the ones it lists, byte for byte. Throws a PackageError.
 */
export async function readPackage(
  dir: string,
  limits: PackageLimits = PACKAGE_LIMITS,
): Promise<ReadPackage> {
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) {
    throw new PackageError('not_a_package', [`${dir} isn't a folder.`]);
  }
  const listed = await listPackageFiles(dir, limits);
  const manifestFile = listed.find((file) => file.path === PACKAGE_MANIFEST_FILE);
  if (!manifestFile) {
    throw new PackageError('not_a_package', [
      `${dir} has no ${PACKAGE_MANIFEST_FILE}, so it isn't a graduate package.`,
    ]);
  }
  if (manifestFile.size > limits.maxManifestBytes) {
    throw new PackageError('too_large', [
      `${PACKAGE_MANIFEST_FILE} is too large to be a manifest.`,
    ]);
  }
  const raw = await readFile(join(dir, PACKAGE_MANIFEST_FILE));
  const manifest = parseManifest(raw.toString('utf8'));
  const files = listed.filter((file) => file.path !== PACKAGE_MANIFEST_FILE);
  await verifyIntegrity(dir, manifest, files);
  return {
    manifest,
    digest: manifestDigest(raw),
    files,
    bytes: files.reduce((sum, file) => sum + file.size, manifestFile.size),
  };
}

/** The digest of a package folder's `graduate.json` as it is on disk now. */
export async function currentDigest(dir: string): Promise<string> {
  return manifestDigest(await readFile(join(dir, PACKAGE_MANIFEST_FILE)));
}
