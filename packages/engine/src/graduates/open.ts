import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readPackage } from '@architect/harness';
import { GuardError, PackageError, type Grants, type ModelBinding } from '@architect/shared';
import type { ServeRequest } from '../local-runtime';
import type { DataPaths } from '../loop/paths';
import type { EngineStore } from '../store/engine-store';
import type { StoredInstallation, StoredVersion } from '../store/records';
import { absoluteBindings } from './bindings';
import { HARNESS_DIR } from './build';

/** The active version of an agent, checked and ready to load, with this computer's bindings. */
export interface ActiveVersion {
  graduateId: string;
  name: string;
  version: StoredVersion;
  /** The version's package folder. */
  dir: string;
  harnessDir: string;
  /**
   * What the adapter runtime (decision 035) loads for a version with an adapter: the base by the
   * name this computer's installation serves it under, the version's GGUF LoRA (its checksum
   * verified just now, with the harness) and the scale it was measured at. The runtime holds the
   * base to the adapter's `baseDigest` and the file to its sha256 again before every start.
   * Null without one.
   */
  adapter: ServeRequest | null;
  model: ModelBinding;
  /** Logical resource name to an absolute folder on this computer. */
  bindings: Record<string, string>;
  grants: Grants;
  /** Which version and which state of the installation this is; see `activeStamp`. */
  stamp: string;
}

/**
 * What the adapter runtime serves for a version with an adapter, on this computer: the base by
 * the name its installation gives it in Ollama's store, held to the build the adapter was trained
 * on, and the version's own adapter file, held to its sha256, at the scale it was measured at.
 * Null for a version without an adapter.
 */
export function serveRequestFor(
  name: string,
  version: StoredVersion,
  dir: string,
  installation: Pick<StoredInstallation, 'model'>,
): ServeRequest | null {
  const adapter = version.manifest.model.adapter;
  if (adapter === undefined) return null;
  const key = `${name} v${version.version}`;
  return {
    model: installation.model.model,
    adapters: [{ key, path: join(dir, ...adapter.path.split('/')), sha256: adapter.sha256 }],
    scales: { [key]: adapter.scale },
    baseDigest: adapter.baseDigest,
  };
}

function stampOf(version: number, installation: StoredInstallation): string {
  const setup = JSON.stringify([installation.model, installation.bindings, installation.grants]);
  return `${version}@${createHash('sha256').update(setup).digest('hex').slice(0, 16)}`;
}

/**
 * What an open graduate was opened from: its active version and its installation as it is now.
 * A different stamp means a promotion, a rollback, a new binding, grant or model endpoint.
 */
export function activeStamp(store: EngineStore, graduateId: string): string | null {
  const agent = store.graduates.get(graduateId);
  const installation = store.installations.get(graduateId);
  if (!agent || agent.activeVersion === null || !installation) return null;
  return stampOf(agent.activeVersion, installation);
}

/**
 * Finds an agent's active version and checks it before anything loads it: its `graduate.json` is
 * still the one recorded when the version was made, and every file still matches its checksum,
 * adapter and harness together, so a rollback can never pair one version's harness with
 * another's adapter. Refuses a version its last installation checks found can't run here.
 */
export async function activeVersion(
  store: EngineStore,
  paths: DataPaths,
  graduateId: string,
): Promise<ActiveVersion> {
  const agent = store.graduates.get(graduateId);
  if (!agent) throw new Error(`There is no graduate "${graduateId}" in Architect.`);
  if (agent.activeVersion === null) {
    throw new Error(`${agent.name} has no version that can run yet.`);
  }
  const version = store.versions.get(graduateId, agent.activeVersion);
  const installation = store.installations.get(graduateId);
  if (!version || !installation) {
    throw new Error(`${agent.name} isn't installed on this computer.`);
  }
  const checks = store.installationChecks.get(graduateId, version.version);
  if (checks?.status === 'blocked') {
    throw new GuardError(
      'permission',
      `${agent.name} can't run on this computer: ${checks.reasons.join(' ')}`,
    );
  }
  const dir = paths.fromStored(version.path);
  let digest: string;
  try {
    ({ digest } = await readPackage(dir));
  } catch (error) {
    if (!(error instanceof PackageError)) throw error;
    throw new PackageError(error.code, [
      `Version ${version.version} of ${agent.name} changed on disk after it was installed, so it wasn't opened.`,
      ...error.problems,
    ]);
  }
  if (digest !== version.digest) {
    throw new PackageError('checksum', [
      `Version ${version.version} of ${agent.name} has a different graduate.json from the one installed, so it wasn't opened.`,
    ]);
  }
  return {
    graduateId,
    name: agent.name,
    version,
    dir,
    harnessDir: join(dir, HARNESS_DIR),
    adapter: serveRequestFor(agent.name, version, dir, installation),
    model: installation.model,
    bindings: absoluteBindings(paths, installation.bindings),
    grants: installation.grants,
    stamp: stampOf(version.version, installation),
  };
}
