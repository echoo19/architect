import { isAbsolute, relative, resolve, sep } from 'node:path';

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

  /** The path, resolved, if the user chose it or a folder it's in; otherwise an error. */
  check(path: string): string {
    const target = resolve(path);
    if (this.files.has(target) || this.folders.has(target)) return target;
    for (const folder of this.folders) {
      if (isInside(folder, target)) return target;
    }
    throw new Error(
      'Architect only opens files and folders you choose. Choose it again, then try once more.',
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
