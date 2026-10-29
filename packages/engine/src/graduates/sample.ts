import { readdir, stat } from 'node:fs/promises';
import type { SampleAgent } from '@architect/shared';
import type { SampleAgentFiles } from '../loop/deps';
import type { DataPaths } from '../loop/paths';
import { seedDataFolder } from './versions';

/** The folder under `samples/` in the app's data folder that holds the ready-made agent's data. */
const SAMPLE_AGENT_FOLDER = 'returns-desk';

/** What a path that isn't there gives: nothing, rather than an error. */
function isMissing(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/** The files a folder holds, by name; none when the folder isn't there. */
async function filesIn(dir: string): Promise<{ name: string }[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => ({ name: entry.name }));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/**
 * Whether this build ships the ready-made agent (decision 054): its package, and data for it to
 * work on, both inside the app. A build with only one of them, or neither, doesn't offer it.
 */
export async function sampleAgentAvailable(files: SampleAgentFiles | undefined): Promise<boolean> {
  if (files === undefined) return false;
  return (await isFile(files.packageFile)) && (await filesIn(files.dataDir)).length > 0;
}

/**
 * Makes the ready-made agent's data this computer's own, in `samples/returns-desk/data` of the
 * app's data folder, and says where that and the package are. The copy is made the first time;
 * one already there is kept as it is, never copied over, so what the agent changed in it stays
 * even if the agent is removed and installed again. The package is read where it is.
 */
export async function prepareSampleAgent(
  paths: DataPaths,
  files: SampleAgentFiles | undefined,
): Promise<SampleAgent> {
  if (files === undefined || !(await sampleAgentAvailable(files))) {
    throw new Error("The ready-made agent isn't available in this build.");
  }
  const data = paths.sampleDataDir(SAMPLE_AGENT_FOLDER);
  try {
    await seedDataFolder(data, files.dataDir, await filesIn(files.dataDir));
  } catch (error) {
    throw new Error(
      `The ready-made agent's data couldn't be copied to ${data}. ${whyCopyFailed(error)}`,
      { cause: error },
    );
  }
  return { package: files.packageFile, data };
}

/** Why a copy failed, in words a person can act on. */
function whyCopyFailed(error: unknown): string {
  const { code } = error as NodeJS.ErrnoException;
  if (code === 'ENOSPC') return 'There is not enough free disk space.';
  if (code === 'EACCES' || code === 'EPERM') return "Architect isn't allowed to write there.";
  return error instanceof Error ? error.message : String(error);
}
