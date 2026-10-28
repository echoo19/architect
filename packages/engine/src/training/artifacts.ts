import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { TrainerOutput } from '@architect/shared';
import type { FetchedArtifacts } from './backend';

/** Downloaded outputs that don't match what the job said it produced. Not worth retrying. */
export class ArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactError';
  }
}

export function hashFile(path: string): { sha256: string; bytes: number } {
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  const fd = openSync(path, 'r');
  let bytes = 0;
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, buffer.length, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
      bytes += read;
    }
  } finally {
    closeSync(fd);
  }
  return { sha256: hash.digest('hex'), bytes };
}

/** A manifest path inside a folder; refuses anything that would land outside it. */
export function insideDir(dir: string, path: string): string {
  const target = resolve(dir, ...path.split('/'));
  const rel = relative(resolve(dir), target);
  if (rel === '' || rel.startsWith('..') || rel.split(sep).includes('..')) {
    throw new ArtifactError(`The output path ${path} points outside the job's folder.`);
  }
  return join(dir, ...path.split('/'));
}

/** Checks every file the manifest lists against its hash and size. */
export function checkOutputs(manifest: TrainerOutput, dir: string): FetchedArtifacts['files'] {
  return manifest.files.map((file) => {
    const path = insideDir(dir, file.path);
    let actual: { sha256: string; bytes: number };
    try {
      actual = hashFile(path);
    } catch {
      throw new ArtifactError(`The job's ${file.path} is missing.`);
    }
    if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes) {
      throw new ArtifactError(`The job's ${file.path} doesn't match its manifest.`);
    }
    return { kind: file.kind, path, sha256: file.sha256, bytes: file.bytes };
  });
}
