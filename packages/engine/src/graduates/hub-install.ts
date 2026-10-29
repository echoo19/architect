import { randomUUID } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PACKAGE_LIMITS,
  PACKAGE_MANIFEST_FILE,
  parseManifest,
  sameFileKey,
} from '@architect/harness';
import {
  CommitIdSchema,
  HubInstallRequestSchema,
  HubRepositorySchema,
  PackageError,
  type HubInstallRequest,
  type HubInstallResult,
  type VersionSource,
} from '@architect/shared';
import { HubError, type HubClient } from '../hub';
import { hubSource, repositoryUrl } from '../hub/names';
import { asDiskFull } from './disk';
import { importPackage, type ImportContext } from './importer';

export interface HubInstallContext extends ImportContext {
  hub: HubClient;
}

/** A package downloaded from the Hub into staging, checked against its manifest, not installed. */
export interface DownloadedPackage {
  /** The package folder. */
  dir: string;
  source: VersionSource;
  /** Removes the staging folder. */
  discard(): Promise<void>;
}

/** The repository an `hf://owner/name` (or plain `owner/name`) source names. */
export function hubRepository(source: string): string {
  const repository = hubSource(source) ?? source;
  const checked = HubRepositorySchema.safeParse(repository);
  if (!checked.success) {
    throw new Error(`"${source}" isn't a Hugging Face repository. Write it as hf://owner/name.`);
  }
  return checked.data;
}

/**
 * Downloads one version of a package from a Hugging Face repository into staging, at a commit:
 * the one named, or the one the branch or tag named (main by default) points at now, looked up
 * once and recorded, so the version never changes when the repository moves on. Only
 * `graduate.json` and the files it lists are fetched, each checked against its sha256 and size
 * while it arrives, and within a package's limits. Nothing in it runs here; installing it is
 * `importPackage`'s job, with every check an import makes.
 */
export async function downloadFromHub(
  ctx: HubInstallContext,
  source: string,
  revision: string | undefined,
  signal?: AbortSignal,
): Promise<DownloadedPackage> {
  const { hub } = ctx;
  const repository = hubRepository(source);
  const commit = await hub.revision(repository, revision ?? 'main', signal);
  if (revision !== undefined && CommitIdSchema.safeParse(revision).success && commit !== revision) {
    throw new HubError(
      'mismatch',
      `Hugging Face resolved commit ${revision} of ${repository} to ${commit}.`,
      'Check the commit.',
    );
  }
  const limits = ctx.limits ?? PACKAGE_LIMITS;
  const staging = join(ctx.library.ctx.paths.stagingDir(), `hub-${randomUUID()}`);
  const dir = join(staging, 'package');
  const discard = () => rm(staging, { recursive: true, force: true });
  try {
    const manifestFile = join(dir, PACKAGE_MANIFEST_FILE);
    try {
      await hub.download(repository, commit, PACKAGE_MANIFEST_FILE, manifestFile, null, signal, {
        maxBytes: limits.maxManifestBytes,
      });
    } catch (error) {
      if (error instanceof HubError && error.code === 'not_found') {
        throw new PackageError('not_a_package', [
          `${repository} has no ${PACKAGE_MANIFEST_FILE} at ${commit}, so it isn't an Architect package.`,
        ]);
      }
      if (error instanceof HubError && error.code === 'too_large') {
        throw new PackageError('too_large', [`Its ${PACKAGE_MANIFEST_FILE} is too large.`]);
      }
      throw error;
    }
    const manifest = parseManifest(await readFile(manifestFile, 'utf8'));
    const files = manifest.integrity.files;
    if (files.length > limits.maxFiles) {
      throw new PackageError('too_many_files', [
        `The package lists more than ${limits.maxFiles} files.`,
      ]);
    }
    const seen = new Set([sameFileKey(PACKAGE_MANIFEST_FILE)]);
    let total = 0;
    for (const file of files) {
      const key = sameFileKey(file.path);
      if (seen.has(key)) {
        throw new PackageError('unsafe_path', [
          `"${file.path}" is listed twice, or as another name for one file on Windows or macOS.`,
        ]);
      }
      seen.add(key);
      total += file.size;
      if (file.size > limits.maxFileBytes || total > limits.maxTotalBytes) {
        throw new PackageError('too_large', ['The package lists more than a package may hold.']);
      }
    }
    for (const file of files) {
      try {
        await hub.download(
          repository,
          commit,
          file.path,
          join(dir, ...file.path.split('/')),
          { sha256: file.sha256, bytes: file.size },
          signal,
        );
      } catch (error) {
        if (error instanceof HubError && error.code === 'mismatch') {
          throw new PackageError('checksum', [
            `${file.path} doesn't match the checksum ${PACKAGE_MANIFEST_FILE} gives it.`,
          ]);
        }
        if (error instanceof HubError && error.code === 'not_found') {
          throw new PackageError('missing_file', [
            `${file.path} is listed in ${PACKAGE_MANIFEST_FILE} but isn't in ${repository} at ${commit}.`,
          ]);
        }
        throw error;
      }
    }
    return {
      dir,
      source: {
        kind: 'huggingface',
        repository,
        revision: commit,
        url: repositoryUrl(hub.endpoint, repository, commit),
      },
      discard,
    };
  } catch (error) {
    await discard();
    throw asDiskFull(error);
  }
}

/**
 * Installs a version from a Hugging Face repository: downloads it at one commit, then imports it
 * like any package, with the same validation, bindings, grants and checks, recording the
 * repository and the commit it came from.
 */
export async function installFromHub(
  ctx: HubInstallContext,
  source: string,
  input: HubInstallRequest = {},
  signal?: AbortSignal,
): Promise<HubInstallResult> {
  const { revision, ...request } = HubInstallRequestSchema.parse(input);
  const downloaded = await downloadFromHub(ctx, source, revision, signal);
  try {
    const result = await importPackage(ctx, downloaded.dir, request, { source: downloaded.source });
    return { ...result, source: downloaded.source };
  } finally {
    await downloaded.discard();
  }
}
