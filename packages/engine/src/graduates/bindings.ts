import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {
  DataFile,
  Grants,
  JobContract,
  PackageManifest,
  ResourceGrant,
} from '@architect/shared';
import type { DataPaths } from '../loop/paths';

/**
 * A folder as an installation stores it: relative to the app's data folder when it is inside it,
 * so that folder can move, and absolute when the user chose it somewhere else.
 */
export function storedFolder(paths: DataPaths, folder: string): string {
  const absolute = resolve(folder);
  const steps = relative(paths.root, absolute);
  const inside =
    steps !== '' && steps !== '..' && !steps.startsWith(`..${sep}`) && !isAbsolute(steps);
  return inside ? steps.split(sep).join('/') : absolute;
}

export function absoluteFolder(paths: DataPaths, stored: string): string {
  return isAbsolute(stored) ? stored : paths.fromStored(stored);
}

export function absoluteBindings(
  paths: DataPaths,
  bindings: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(bindings).map(([name, stored]) => [name, absoluteFolder(paths, stored)]),
  );
}

const RANK: Record<ResourceGrant, number> = { none: 0, read: 1, read_write: 2 };

/** The lesser of two grants. */
export function lesserGrant(a: ResourceGrant, b: ResourceGrant): ResourceGrant {
  return RANK[a] <= RANK[b] ? a : b;
}

/**
 * Grants on this computer for a package's resources: what the user named, never more than the
 * package asks for, and nothing at all for a resource the user didn't name.
 */
export function grantsFor(
  manifest: Pick<PackageManifest, 'resources'>,
  named: Partial<Grants> | undefined,
): Grants {
  const resources: Grants['resources'] = {};
  for (const resource of manifest.resources) {
    const asked = resource.access;
    const given = named?.resources?.[resource.name] ?? 'none';
    resources[resource.name] = lesserGrant(given, asked);
  }
  return { writes: named?.writes ?? 'ask', resources };
}

/** What the same computer that trained a graduate grants it: what its job allowed. */
export function sameComputerGrants(
  manifest: Pick<PackageManifest, 'resources' | 'contract'>,
  writes: Grants['writes'],
): Grants {
  return {
    writes,
    resources: Object.fromEntries(
      manifest.resources.map((resource) => [resource.name, resource.access]),
    ),
  };
}

/**
 * The contract's files as the runtime enforces them here: a file the contract may write is
 * writable only if the `data` folder was granted for writing, and nothing is open at all when
 * the folder wasn't granted.
 */
export function grantedFiles(contract: JobContract, grants: Grants): DataFile[] {
  const grant = grants.resources['data'] ?? 'none';
  if (grant === 'none') return [];
  return contract.inputs.files.map((file) => ({
    ...file,
    access: file.access === 'write' && grant === 'read_write' ? 'write' : 'read',
  }));
}
