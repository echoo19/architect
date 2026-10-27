import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs';

/**
 * Writes a file so readers see either the old content or the new, never half of it: the content
 * goes to a temporary file beside the target, is flushed to disk, then renamed over it.
 */
export function writeFileAtomic(path: string, content: string): void {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const fd = openSync(temp, 'w');
    try {
      writeFileSync(fd, content, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}
