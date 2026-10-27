import { join, sep } from 'node:path';

/** Where the app is running from. */
export interface AppLocation {
  /** The folder of the built main bundle (`out/main`). */
  outDir: string;
  packaged: boolean;
  /** The app folder: `apps/desktop` in development, `app.asar` when packaged. */
  appPath: string;
  /** Where electron-builder puts extra resources (`process.resourcesPath`). */
  resourcesPath: string;
}

/** Files the background processes need besides the engine's own bundle. */
export interface ProcessResources {
  /** The tool sandbox's entry, which the engine forks as a Node process. */
  sandboxEntry: string;
  sampleJobFile: string;
}

export function processResources(location: AppLocation): ProcessResources {
  const out = join(location.outDir, '..');
  return {
    // The sandbox is forked with its folder as the working directory, and a folder inside the
    // app archive isn't a real one, so packaging leaves the sandbox unpacked.
    sandboxEntry: unpackedPath(join(out, 'sandbox', 'child.mjs')),
    sampleJobFile: location.packaged
      ? join(location.resourcesPath, 'sample-job', 'job.json')
      : join(location.appPath, '..', '..', 'examples', 'home-services', 'job', 'job.json'),
  };
}

/** Where electron-builder puts a file it leaves out of `app.asar`. */
export function unpackedPath(path: string): string {
  return path
    .split(sep)
    .map((part) => (part === 'app.asar' ? 'app.asar.unpacked' : part))
    .join(sep);
}
