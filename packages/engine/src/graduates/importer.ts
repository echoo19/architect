import { randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { isLoopbackUrl } from '@architect/adapters';
import {
  extractZip,
  hashHarness,
  LEGACY_MANIFEST_FILE,
  listPackageFiles,
  MAX_HARNESS_BYTES,
  PACKAGE_LIMITS,
  PACKAGE_MANIFEST_FILE,
  readGraduate,
  readHarness,
  readPackage,
  readZipEntries,
  writePackage,
  type PackageFileInfo,
  type PackageLimits,
} from '@architect/harness';
import {
  ADAPTER_RUNTIMES,
  BINDABLE_RUNTIMES,
  GuardError,
  HARNESS_FORMAT,
  ImportRequestSchema,
  newId,
  OLLAMA_BASE_URL,
  PackageError,
  SafeIdSchema,
  type ImportRequest,
  type ImportResult,
  type ModelBinding,
  type PackageInspection,
  type PackageManifest,
} from '@architect/shared';
import { isoNow } from '../loop/time';
import { grantsFor, storedFolder } from './bindings';
import { buildPackage, HARNESS_DIR } from './build';
import { contractFromManifest, legacyFacts } from './legacy';
import type { GraduateLibrary } from './library';
import { exists, nextVersion, registerVersion } from './versions';

export interface ImportContext {
  library: GraduateLibrary;
  limits?: PackageLimits;
}

/** A package unpacked and checked in a staging folder of its own. Nothing in it has run. */
interface Staged {
  /** The package folder. */
  dir: string;
  manifest: PackageManifest;
  digest: string;
  /** Every file but `graduate.json`, with its size. */
  files: PackageFileInfo[];
  bytes: number;
  migratedFrom?: 1;
}

/**
 * What a format 1 folder's own files may weigh before they are parsed, so a small archive that
 * unpacks to a huge report or lineage can't exhaust memory.
 */
const LEGACY_FILE_BYTES: Readonly<Record<string, number>> = {
  [LEGACY_MANIFEST_FILE]: 64 * 1024,
  'report.json': 1024 ** 2,
  'report.md': 1024 ** 2,
  'lineage.jsonl': 8 * 1024 ** 2,
};

const LEGACY_HARNESS_FILE =
  /^(harness\.yaml|system\.md|retrieval\.yaml|decoding\.yaml|guardrails\.yaml|skills\/.*|tools\/.*|examples\/.*)$/;

const runtimesList = (names: readonly string[]): string => names.join(' or ');

/**
 * Refuses a package this build can't use, before anything else happens: one that runs on no
 * runtime an installation here can serve (an adapter needs one that loads adapters), one whose
 * harness format is newer than this build reads, or one whose resources don't match its
 * contract. Nothing about it has been parsed beyond its manifest.
 */
function assertUsable(manifest: PackageManifest): void {
  const problems: string[] = [];
  const { compatible } = manifest.model.runtime;
  const bindable = compatible.filter((runtime) =>
    (BINDABLE_RUNTIMES as readonly string[]).includes(runtime),
  );
  if (manifest.model.adapter !== undefined) {
    const loaders = bindable.filter((runtime) =>
      (ADAPTER_RUNTIMES as readonly string[]).includes(runtime),
    );
    if (loaders.length === 0) {
      problems.push(
        `It carries a LoRA adapter, which needs ${runtimesList(ADAPTER_RUNTIMES)}; this version of Architect can't run that yet.`,
      );
    }
  } else if (bindable.length === 0) {
    problems.push(
      `It needs ${runtimesList(compatible)}, which this version of Architect can't run.`,
    );
  }
  if (manifest.harness.format > HARNESS_FORMAT) {
    problems.push(
      `Its harness is format ${manifest.harness.format}, newer than the format ${HARNESS_FORMAT} this version reads.`,
    );
  }
  if (!SafeIdSchema.safeParse(manifest.identity.agentId).success) {
    problems.push(`"${manifest.identity.agentId}" can't be an agent id here.`);
  }
  if (problems.length > 0) throw new PackageError('incompatible', problems);

  const data = manifest.resources.find((resource) => resource.name === 'data');
  const declared = manifest.contract.inputs.files;
  const listed = data?.files ?? [];
  const same =
    declared.length === listed.length &&
    declared.every((file, index) => {
      const other = listed[index];
      return other?.name === file.name && other.kind === file.kind && other.access === file.access;
    });
  if (!same || (declared.length > 0 && data?.required !== true)) {
    throw new PackageError('invalid_manifest', [
      "Its data/ resource doesn't name the files its contract does, so what it asks for can't be checked.",
    ]);
  }
}

/** A harness bigger than any harness may be is refused before a byte of it is parsed. */
function assertHarnessSize(files: readonly PackageFileInfo[], prefix: string): void {
  const total = files
    .filter((file) => file.path.startsWith(prefix))
    .reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_HARNESS_BYTES + 64 * 1024) {
    throw new PackageError('too_large', [
      `Its harness is ${Math.ceil(total / 1024)} KB, more than a harness may hold.`,
    ]);
  }
}

/**
 * Copies a package folder into staging, after checking every entry as an archive's would be.
 * Each file is looked at again just before it is copied, so one swapped for a link meanwhile is
 * refused rather than followed.
 */
async function stageFolder(source: string, target: string, limits: PackageLimits): Promise<void> {
  const files = await listPackageFiles(source, limits);
  await mkdir(target, { recursive: true });
  for (const file of files) {
    const from = join(source, ...file.path.split('/'));
    const now = await lstat(from);
    if (!now.isFile() || now.size !== file.size) {
      throw new PackageError('link', [`"${file.path}" changed while it was being read.`]);
    }
    const to = join(target, ...file.path.split('/'));
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
  }
}

/** Reads a format 1 folder as version 1 of a package, after checking what its files weigh. */
async function convertLegacy(
  unpacked: string,
  converted: string,
  limits: PackageLimits,
): Promise<void> {
  const files = await listPackageFiles(unpacked, limits);
  for (const file of files) {
    const cap = LEGACY_FILE_BYTES[file.path];
    if (cap !== undefined && file.size > cap) {
      throw new PackageError('too_large', [`${file.path} is too large for a graduate's file.`]);
    }
  }
  assertHarnessSize(
    files.filter((file) => LEGACY_HARNESS_FILE.test(file.path)),
    '',
  );
  let folder;
  try {
    folder = await readGraduate(unpacked);
  } catch (error) {
    throw new PackageError('invalid_manifest', [
      `This format 1 graduate folder doesn't read: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  const facts = legacyFacts(folder, contractFromManifest(folder), {}, false);
  const { draft, entries } = buildPackage(facts);
  await writePackage(converted, draft, entries);
}

/**
 * Unpacks a folder or `.architect.zip` into staging and checks all of it without running any of
 * it: the archive's entries, the manifest's format and fields, every checksum, whether this build
 * can run it at all, and whether its resources match its contract. A format 1 graduate folder is
 * read, its files' sizes checked first, and converted to a package. Throws a PackageError; the
 * staging folder is the caller's to remove.
 */
async function stage(ctx: ImportContext, path: string, staging: string): Promise<Staged> {
  const limits = ctx.limits ?? PACKAGE_LIMITS;
  const source = resolve(path);
  const info = await stat(source).catch(() => null);
  const unpacked = join(staging, 'unpacked');
  if (info?.isDirectory()) {
    await stageFolder(source, unpacked, limits);
  } else if (info?.isFile()) {
    await extractZip(source, await readZipEntries(source, limits), unpacked);
  } else {
    throw new PackageError('not_a_package', [`${source} isn't a file or a folder.`]);
  }

  let dir = unpacked;
  let migratedFrom: 1 | undefined;
  if (!(await exists(join(unpacked, PACKAGE_MANIFEST_FILE)))) {
    if (!(await exists(join(unpacked, LEGACY_MANIFEST_FILE)))) {
      throw new PackageError('not_a_package', [
        `There is no ${PACKAGE_MANIFEST_FILE} in it, so it isn't a graduate package.`,
      ]);
    }
    dir = join(staging, 'converted');
    await convertLegacy(unpacked, dir, limits);
    migratedFrom = 1;
  }
  const read = await readPackage(dir, limits);
  assertUsable(read.manifest);
  return {
    dir,
    manifest: read.manifest,
    digest: read.digest,
    files: read.files,
    bytes: read.bytes,
    ...(migratedFrom === undefined ? {} : { migratedFrom }),
  };
}

function stagingFolder(ctx: ImportContext): string {
  return join(ctx.library.ctx.paths.stagingDir(), `import-${randomUUID()}`);
}

/** Checks a package as an import would, and installs nothing. */
export async function inspectPackage(ctx: ImportContext, path: string): Promise<PackageInspection> {
  const staging = stagingFolder(ctx);
  try {
    const staged = await stage(ctx, path, staging);
    return {
      ok: true,
      manifest: staged.manifest,
      digest: staged.digest,
      ...(staged.migratedFrom === undefined ? {} : { migratedFrom: staged.migratedFrom }),
      files: staged.files.length + 1,
      bytes: staged.bytes,
    };
  } catch (error) {
    if (!(error instanceof PackageError)) throw error;
    return { ok: false, code: error.code, problems: [...error.problems] };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** The local runtime to serve a package's model with, when the user named none. */
function defaultModel(manifest: PackageManifest): ModelBinding {
  const { compatible } = manifest.model.runtime;
  const runtime =
    compatible.includes('openai_compatible') && !compatible.includes('ollama')
      ? 'openai_compatible'
      : 'ollama';
  return { runtime, baseUrl: OLLAMA_BASE_URL, model: manifest.model.base.name };
}

/**
 * Where an import goes: the agent the package continues, when this computer has the version its
 * manifest names as parent (by digest, under whatever local id it has); otherwise a new agent,
 * under the package's own id when that is free here. An id alone never joins an agent, since
 * anyone holding an export knows it.
 */
function placeOf(
  ctx: ImportContext,
  manifest: PackageManifest,
): { graduateId: string; isNew: boolean; parent?: number } {
  const { store } = ctx.library.ctx;
  const parentDigest = manifest.identity.parent?.digest;
  const parent = parentDigest === undefined ? null : store.versions.withDigest(parentDigest);
  if (parent) return { graduateId: parent.graduateId, isNew: false, parent: parent.version };
  const claimed = manifest.identity.agentId;
  if (store.graduates.get(claimed) === null) return { graduateId: claimed, isNew: true };
  return { graduateId: newId('grd'), isNew: true };
}

/**
 * Installs a package as a new local version. Everything about the package is checked first, and
 * its harness parsed (never run) against its hash; then the version gets its own folder and
 * record. A package never replaces anything: one installed before is found by its digest, and
 * one that continues a version this computer has becomes the next version of that agent, as a
 * candidate apart from the active one; anything else becomes a new agent. Only what the request
 * grants is granted, never more than the package asks for. The installation checks run last.
 */
export async function importPackage(
  ctx: ImportContext,
  path: string,
  input: ImportRequest = {},
): Promise<ImportResult> {
  const request = ImportRequestSchema.parse(input);
  if (request.model && !isLoopbackUrl(request.model.baseUrl)) {
    throw new GuardError(
      'network',
      `${new URL(request.model.baseUrl).host} isn't this computer. A graduate only runs on a local model.`,
    );
  }
  const { library } = ctx;
  const { store, paths } = library.ctx;
  const staging = stagingFolder(ctx);
  try {
    const staged = await stage(ctx, path, staging);
    const { manifest } = staged;
    assertHarnessSize(staged.files, `${HARNESS_DIR}/`);
    let harnessHash: string;
    try {
      harnessHash = hashHarness(await readHarness(join(staged.dir, HARNESS_DIR)));
    } catch (error) {
      throw new PackageError('invalid_harness', [
        `Its harness doesn't read: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
    if (harnessHash !== manifest.harness.hash) {
      throw new PackageError('invalid_harness', [
        "Its harness isn't the one its manifest names: the hashes differ.",
      ]);
    }

    const installed = store.versions.withDigest(staged.digest);
    if (installed) {
      return {
        graduate: library.summary(installed.graduateId),
        version: installed.version,
        installation: library.installation(installed.graduateId, installed.version),
        alreadyInstalled: true,
      };
    }
    const place = placeOf(ctx, manifest);
    const { graduateId } = place;
    return await library.lock.run(graduateId, async () => {
      const { isNew } = place;
      if (!isNew && (Object.keys(request.bindings).length > 0 || request.grants || request.model)) {
        throw new Error(
          `${library.agent(graduateId).name} is already installed here, with its own folders and permissions. Change those in its settings; this import only adds a version.`,
        );
      }
      const resources = new Set(manifest.resources.map((resource) => resource.name));
      const bindings: Record<string, string> = {};
      for (const [name, folder] of Object.entries(request.bindings)) {
        if (!resources.has(name)) throw new Error(`The package has no resource called "${name}".`);
        const absolute = resolve(folder);
        if (!(await stat(absolute).catch(() => null))?.isDirectory()) {
          throw new Error(`${absolute} isn't a folder.`);
        }
        bindings[name] = storedFolder(paths, absolute);
      }

      const version = nextVersion(store, graduateId);
      const dir = paths.versionDir(graduateId, version);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dirname(dir), { recursive: true });
      await rename(staged.dir, dir);

      if (isNew) {
        for (const resource of manifest.resources) {
          if (!resource.bundled || bindings[resource.name] !== undefined) continue;
          const folder = join(paths.workspaceDir(graduateId), resource.name);
          if (!(await exists(folder))) {
            await mkdir(folder, { recursive: true });
            for (const file of resource.files) {
              const from = join(dir, ...resource.bundled.path.split('/'), file.name);
              if (await exists(from)) await copyFile(from, join(folder, file.name));
            }
          }
          bindings[resource.name] = storedFolder(paths, folder);
        }
      }

      const at = isoNow(library.ctx.clock);
      store.transaction(() => {
        registerVersion(store, paths, {
          graduateId,
          name: manifest.identity.name,
          version,
          written: { manifest, digest: staged.digest },
          ...(place.parent === undefined ? {} : { parent: place.parent }),
          origin: {
            agentId: manifest.identity.agentId,
            version: manifest.identity.version,
            digest: staged.digest,
          },
          state: isNew ? 'accepted' : 'candidate',
          installation: {
            graduateId,
            model: request.model ?? defaultModel(manifest),
            bindings,
            grants: grantsFor(manifest, request.grants),
            createdAt: at,
            updatedAt: at,
          },
          at,
        });
      });
      await library.checkNow(graduateId, { loadModel: request.loadModel, version });
      return {
        graduate: library.summary(graduateId),
        version,
        installation: library.installation(graduateId, version),
        alreadyInstalled: false,
      };
    });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
