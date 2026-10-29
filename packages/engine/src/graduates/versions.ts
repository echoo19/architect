import { randomUUID } from 'node:crypto';
import { cp, mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { writePackage, type WrittenPackage } from '@architect/harness';
import type {
  DataFile,
  JobContract,
  VersionRef,
  VersionSource,
  VersionState,
} from '@architect/shared';
import type { DataPaths } from '../loop/paths';
import type { EngineStore } from '../store/engine-store';
import type { StoredInstallation, StoredVersion } from '../store/records';
import { storedFolder } from './bindings';
import { buildPackage, type VersionFacts } from './build';

/** The next version number of an agent on this computer. */
export function nextVersion(store: EngineStore, graduateId: string): number {
  return (store.versions.list(graduateId).at(-1)?.version ?? 0) + 1;
}

/**
 * Writes a version's package folder. A folder left behind by an attempt that never reached the
 * database (a crash between the two) is replaced; a version the database knows is never touched.
 */
export async function writeVersionFolder(
  store: EngineStore,
  paths: DataPaths,
  facts: VersionFacts,
): Promise<WrittenPackage> {
  if (store.versions.get(facts.agentId, facts.version)) {
    throw new Error(`Version ${facts.version} of ${facts.name} already exists and never changes.`);
  }
  const dir = paths.versionDir(facts.agentId, facts.version);
  await rm(dir, { recursive: true, force: true });
  const { draft, entries } = buildPackage(facts);
  return writePackage(dir, draft, entries);
}

export interface NewVersion {
  graduateId: string;
  name: string;
  version: number;
  written: Pick<WrittenPackage, 'manifest' | 'digest'>;
  /** The local version it was derived from. */
  parent?: number;
  /** Where an imported version came from. */
  origin?: VersionRef;
  /** The hub repository and commit an imported version was downloaded from. */
  source?: VersionSource;
  /** The local run that made it. */
  runId?: string;
  state: VersionState;
  /** When an accepted version was accepted, if not now. */
  acceptedAt?: string;
  /** The installation to create with a new agent; an existing agent keeps its own. */
  installation: StoredInstallation;
  at: string;
}

/**
 * Records a written version, and its agent when this is the agent's first: the agent's first
 * version is its active one from the start, since nothing else could be; any later version waits
 * apart until it is accepted and promoted. Synchronous, so a caller can fold it into the same
 * transaction as whatever else made the version (graduation files its run there too).
 */
export function registerVersion(
  store: EngineStore,
  paths: DataPaths,
  input: NewVersion,
): StoredVersion {
  const { graduateId, version, at } = input;
  const { manifest, digest } = input.written;
  const existing = store.graduates.get(graduateId);
  if (!existing) {
    store.graduates.insert({
      id: graduateId,
      runId: input.runId ?? null,
      name: input.name,
      path: paths.toStored(paths.graduateDir(graduateId)),
      manifest: null,
      settings: null,
      activeVersion: null,
      createdAt: at,
    });
  }
  const stored: StoredVersion = {
    graduateId,
    version,
    ...(input.parent === undefined ? {} : { parent: input.parent }),
    ...(input.origin === undefined ? {} : { origin: input.origin }),
    ...(input.source === undefined ? {} : { source: input.source }),
    path: paths.toStored(paths.versionDir(graduateId, version)),
    manifest,
    digest,
    contractVersion: manifest.contract.version,
    state: input.state,
    evaluation: manifest.evidence.status,
    ...(input.runId === undefined ? {} : { runId: input.runId }),
    createdAt: at,
    ...(input.state === 'accepted' ? { acceptedAt: input.acceptedAt ?? at } : {}),
  };
  store.versions.insert(stored);
  store.versionEvents.insert({ graduateId, kind: 'created', version, at });
  if (input.state === 'accepted') {
    store.versionEvents.insert({
      graduateId,
      kind: 'accepted',
      version,
      at: input.acceptedAt ?? at,
    });
  }
  const agent = store.graduates.get(graduateId);
  if (agent && agent.activeVersion === null) {
    store.graduates.update({ ...agent, activeVersion: version });
    store.versionEvents.insert({ graduateId, kind: 'promoted', version, at });
  }
  if (!store.installations.get(graduateId)) store.installations.put(input.installation);
  return stored;
}

/**
 * Copies a job's data files into a graduate's own folder the first time, so its workspace never
 * writes to the data training used (decision 019). A folder already there is kept as it is, and
 * the copy is renamed into place whole. A ready-made agent's data is copied the same way
 * (decision 054).
 */
export async function seedDataFolder(
  folder: string,
  sourceDir: string,
  files: readonly Pick<DataFile, 'name'>[],
): Promise<void> {
  if (await exists(folder)) return;
  const staging = `${folder}.${randomUUID()}.partial`;
  try {
    await mkdir(staging, { recursive: true });
    for (const file of files) {
      const from = join(sourceDir, file.name);
      if (await exists(from)) await cp(from, join(staging, file.name));
    }
    await rename(staging, folder);
  } catch (error) {
    if (!(await exists(folder))) throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/**
 * The bindings a graduate made on this computer starts with: `data/` to its own copy of the
 * job's data, and `output/` to a folder of its own when its contract allows one.
 */
export async function sameComputerBindings(
  paths: DataPaths,
  graduateId: string,
  contract: JobContract,
  data: string,
): Promise<Record<string, string>> {
  const bindings: Record<string, string> = {};
  if (await exists(data)) bindings['data'] = storedFolder(paths, data);
  if (contract.outputs.folder !== undefined) {
    const output = paths.outputDir(graduateId);
    await mkdir(output, { recursive: true });
    bindings['output'] = storedFolder(paths, output);
  }
  return bindings;
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
