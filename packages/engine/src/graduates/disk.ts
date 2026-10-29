import { CodedError } from '@architect/shared';

/**
 * A full disk, as a failure a screen can word. An import writes the unpacked package, the new
 * version's folder and a hub download, and can run out of room at any of them; the system's own
 * message names a call and a path, so this says the one thing a person can act on. Any other
 * failure is returned as it came.
 */
export function asDiskFull(error: unknown): unknown {
  if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOSPC') {
    return new CodedError('disk_full', 'There is not enough free disk space to install it.', {
      cause: error,
    });
  }
  return error;
}
