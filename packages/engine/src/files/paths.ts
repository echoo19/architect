import { GuardError } from '@architect/shared';

const EXAMPLE = 'Paths here are like data/orders.csv.';

/**
 * A path the agent gave, as a path in its folder: forward slashes, no leading "./" or "/", no
 * "." segments, no trailing slash. The agent only ever sees these logical paths, never the
 * computer's, so a drive letter, a network path, a null character or a ".." that climbs out is
 * refused rather than corrected. The empty path is the folder itself.
 */
export function agentPath(raw: string): string {
  const text = raw.trim().replace(/\\/g, '/');
  if (text.includes('\0')) {
    throw new GuardError('permission', `"${raw}" has a null character in it. ${EXAMPLE}`);
  }
  if (/^[A-Za-z]:/.test(text) || text.startsWith('//')) {
    throw new GuardError('permission', `"${raw}" is a path on the computer. ${EXAMPLE}`);
  }
  const parts = text.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.includes('..')) {
    throw new GuardError('permission', `"${raw}" climbs out of your folder with "..". ${EXAMPLE}`);
  }
  return parts.join('/');
}

/** The folder a path is in, or '' for a path at the top. */
export function parentOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** True when `path` is `folder` itself or anything inside it. The top folder holds everything. */
export function isWithin(path: string, folder: string): boolean {
  return folder === '' || path === folder || path.startsWith(`${folder}/`);
}

/** Windows treats these as devices whatever the extension. */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
/** A name a file may have on every system: no separators, no trailing dot or space. */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._ -]{0,119}$/;

/** Why a new file can't have this path on disk, or null when it can. */
export function unsafeName(path: string): string | null {
  for (const part of path.split('/')) {
    if (!SAFE_NAME.test(part) || /[. ]$/.test(part)) {
      return `"${part}" can't be a file or folder name: use letters, digits, dots, dashes, underscores and spaces, and don't end it with a dot or a space`;
    }
    if (WINDOWS_DEVICE.test(part)) return `"${part}" is a name Windows keeps for devices`;
  }
  return null;
}
