import {
  PACKAGE_SCHEMA,
  PackageError,
  PackageManifestSchema,
  type PackageManifest,
} from '@architect/shared';
import { errorMessage } from '../codec';
import { camelToSnake, isRecord, mapKeys, snakeToCamel } from '../keys';
import { check } from '../parse';
import { normalizeText } from '../text';
import { PACKAGE_MANIFEST_FILE, sha256Bytes } from './files';

/**
 * `graduate.json` as written: snake_case keys like every other Architect file, two-space
 * indents, a final newline. The manifest has no free-form maps, so renaming keys is safe.
 */
export function serializeManifest(manifest: PackageManifest): string {
  const problems: string[] = [];
  const checked = check(PACKAGE_MANIFEST_FILE, PackageManifestSchema, manifest, problems);
  if (!checked) throw new PackageError('invalid_manifest', problems);
  return `${JSON.stringify(mapKeys(checked, camelToSnake), null, 2)}\n`;
}

/** The identity of a version: sha256 of its `graduate.json` bytes. */
export function manifestDigest(bytes: string | Uint8Array): string {
  return sha256Bytes(bytes);
}

/**
 * Parses `graduate.json`. The schema number is read first, so a package from a newer Architect
 * is refused for what it is rather than for the fields this version doesn't know.
 */
export function parseManifest(text: string): PackageManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(normalizeText(text));
  } catch (error) {
    throw new PackageError('invalid_manifest', [
      `${PACKAGE_MANIFEST_FILE} isn't valid JSON (${errorMessage(error)}).`,
    ]);
  }
  if (!isRecord(raw)) {
    throw new PackageError('invalid_manifest', [`${PACKAGE_MANIFEST_FILE} isn't a JSON object.`]);
  }
  const schema = raw['schema'];
  if (schema !== PACKAGE_SCHEMA) {
    throw new PackageError('unknown_schema', [
      typeof schema === 'number' && schema > PACKAGE_SCHEMA
        ? `This package uses format ${schema}, made by a newer Architect. This version reads format ${PACKAGE_SCHEMA}.`
        : `${PACKAGE_MANIFEST_FILE} names format ${JSON.stringify(schema ?? null)}, which Architect doesn't know.`,
    ]);
  }
  const problems: string[] = [];
  const manifest = check(
    PACKAGE_MANIFEST_FILE,
    PackageManifestSchema,
    mapKeys(raw, snakeToCamel),
    problems,
  );
  if (!manifest) throw new PackageError('invalid_manifest', problems);
  return manifest;
}
