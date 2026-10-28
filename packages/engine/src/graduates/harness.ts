import { join } from 'node:path';
import { readStoredHarness } from '@architect/harness';
import { PackageError, type Harness, type PackageManifest } from '@architect/shared';
import { HARNESS_DIR } from './build';

/**
 * A version's harness, read (never run) and held to its manifest: the folder is in the format
 * the manifest names, and its files as stored have the manifest's hash. A harness a package
 * keeps in format 1 comes back migrated to the current format, with a hash of its own and the
 * manifest's in `meta.migratedFrom`.
 */
export async function readPackageHarness(
  dir: string,
  manifest: Pick<PackageManifest, 'harness'>,
): Promise<Harness> {
  const stored = await readStoredHarness(join(dir, HARNESS_DIR));
  if (stored.format !== manifest.harness.format) {
    throw new PackageError('invalid_harness', [
      `Its harness is saved in format ${stored.format}, but its manifest says format ${manifest.harness.format}.`,
    ]);
  }
  if (stored.filesHash !== manifest.harness.hash) {
    throw new PackageError('invalid_harness', [
      "Its harness isn't the one its manifest names: the hashes differ.",
    ]);
  }
  return stored.harness;
}
