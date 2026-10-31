import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Job } from '@architect/shared';
import { createEngineDeps } from '../../src/host/wiring';
import { systemClock } from '../../src/loop/deps';
import { JobLibrary } from '../../src/loop/jobs';
import { DataPaths } from '../../src/loop/paths';
import { openEngineStore } from '../../src/store/engine-store';

/** The Academy desk's job as it ships: four academies, one of them never trained on. */
export const ACADEMY_JOB_FILE = fileURLToPath(
  new URL('../../../../examples/academy/job/job.json', import.meta.url),
);

/**
 * Imports a job file into an app data folder as the app does: its train organizations in the
 * job's folder, its tasks split, and the test split and the sealed organizations in the vault.
 */
export async function importJobInto(dataDir: string, jobFile = ACADEMY_JOB_FILE): Promise<Job> {
  mkdirSync(dataDir, { recursive: true });
  const paths = new DataPaths(dataDir);
  const store = openEngineStore(paths.database);
  try {
    const deps = createEngineDeps({ dataDir, getSecret: async () => undefined });
    return await new JobLibrary(store, paths, deps, systemClock).importFile(jobFile);
  } finally {
    store.close();
  }
}
