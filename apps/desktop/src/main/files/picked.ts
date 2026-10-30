import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/**
 * Files and folders the user chose in a file dialog this session. The renderer may hand the
 * engine only these, or a path inside a chosen folder, so a compromised page can't make the app
 * read or write anything else.
 */
export class PickedPaths {
  private readonly files = new Set<string>();
  private readonly folders = new Set<string>();

  add(paths: readonly string[], kind: 'files' | 'folders'): void {
    const into = kind === 'files' ? this.files : this.folders;
    for (const path of paths) into.add(resolve(path));
  }

  /**
   * The path, if the user chose it or a folder it's in; otherwise an error. A path inside a chosen
   * folder is returned by its real location, and refused if a link on the way leads out of the
   * folder.
   */
  check(path: string): string {
    const target = resolve(path);
    if (this.files.has(target) || this.folders.has(target)) return target;
    let leaves = false;
    for (const folder of this.folders) {
      if (!isInside(folder, target)) continue;
      const real = realPath(target);
      if (isInside(realPath(folder), real)) return real;
      leaves = true;
    }
    throw new Error(
      leaves
        ? LEAVES_FOLDER
        : 'Architect only opens files and folders you choose. Choose it again, then try once more.',
    );
  }

  /**
   * The file, resolved, if the user chose exactly it: never one that is merely inside a chosen
   * folder. For a program Architect will run, such as llama-server.
   */
  checkFile(path: string): string {
    const target = resolve(path);
    if (this.files.has(target)) return target;
    throw new Error(
      'Architect only runs a program you choose. Choose it again, then try once more.',
    );
  }
}

function isInside(folder: string, path: string): boolean {
  const steps = relative(folder, path);
  return steps !== '' && steps !== '..' && !steps.startsWith(`..${sep}`) && !isAbsolute(steps);
}

const LEAVES_FOLDER =
  'That path leads out of the folder you chose through a link, so Architect will not open it. Choose the real location instead.';

/**
 * The path with every link followed. A part that doesn't exist yet is kept as written under its
 * real parent; a link that points nowhere is refused, since writing through it would create
 * something where it points.
 */
function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    if (!missing || lstatSync(path, { throwIfNoEntry: false }) !== undefined) {
      throw new Error(LEAVES_FOLDER, { cause: error });
    }
    const parent = dirname(path);
    return parent === path ? path : join(realPath(parent), basename(path));
  }
}
