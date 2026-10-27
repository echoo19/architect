import { createHash } from 'node:crypto';
import type { Harness } from '@architect/shared';
import { META_PATH } from './paths';
import { harnessToFiles } from './serialize';
import { compareText, normalizeText } from './text';

/**
 * sha256 over a file map: each path and its content with LF line endings, in path order, with
 * lengths so no two different maps can produce the same byte stream. `harness.yaml` is skipped
 * because it stores the hash.
 */
export function hashFiles(files: Readonly<Record<string, string>>): string {
  const hash = createHash('sha256');
  for (const path of Object.keys(files).sort(compareText)) {
    if (path === META_PATH) continue;
    const content = Buffer.from(normalizeText(files[path] ?? ''), 'utf8');
    hash.update(`${path}\n${content.length}\n`);
    hash.update(content);
    hash.update('\n');
  }
  return `sha256-${hash.digest('hex')}`;
}

/** Identifies a harness by its content alone, whatever its version number or where it is stored. */
export function hashHarness(harness: Harness): string {
  return hashFiles(harnessToFiles(harness));
}
