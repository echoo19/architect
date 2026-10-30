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
  /** The tool sandbox's entry, which the engine and the agent host fork as a Node process. */
  sandboxEntry: string;
  /** The agent host's entry, started as a utility process. */
  agentHostEntry: string;
  sampleJobFile: string;
  /** The tutor's job, with its academies beside it. */
  academyJobFile: string;
  /** The ready-made agent's package, which a build that doesn't ship it leaves out. */
  sampleAgentFile: string;
  /** The data the ready-made agent works on, which comes with its package. */
  sampleAgentDataDir: string;
  /** The pinned training recipe and its scripts, which the engine's training worker sends. */
  trainerDir: string;
}

export function processResources(location: AppLocation): ProcessResources {
  const out = join(location.outDir, '..');
  return {
    // The sandbox is forked with its folder as the working directory, and a folder inside the
    // app archive isn't a real one, so packaging leaves the sandbox unpacked.
    sandboxEntry: unpackedPath(join(out, 'sandbox', 'child.mjs')),
    agentHostEntry: join(out, 'agent-host', 'main.mjs'),
    sampleJobFile: location.packaged
      ? join(location.resourcesPath, 'sample-job', 'job.json')
      : join(location.appPath, '..', '..', 'examples', 'home-services', 'job', 'job.json'),
    academyJobFile: location.packaged
      ? join(location.resourcesPath, 'academy-job', 'job.json')
      : join(location.appPath, '..', '..', 'examples', 'academy', 'job', 'job.json'),
    // The returns desk's package, and its own data, which the package's agent works on.
    sampleAgentFile: location.packaged
      ? join(location.resourcesPath, 'sample-agent', 'returns-desk.architect.zip')
      : join(
          location.appPath,
          '..',
          '..',
          'examples',
          'gear-returns',
          'graduate',
          'returns-desk.architect.zip',
        ),
    sampleAgentDataDir: location.packaged
      ? join(location.resourcesPath, 'sample-agent', 'data')
      : join(location.appPath, '..', '..', 'examples', 'gear-returns', 'graduate', 'data'),
    trainerDir: location.packaged
      ? join(location.resourcesPath, 'trainer')
      : join(location.appPath, '..', '..', 'trainer'),
  };
}

/** Where electron-builder puts a file it leaves out of `app.asar`. */
export function unpackedPath(path: string): string {
  return path
    .split(sep)
    .map((part) => (part === 'app.asar' ? 'app.asar.unpacked' : part))
    .join(sep);
}
