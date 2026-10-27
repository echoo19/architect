import { fileURLToPath } from 'node:url';
import { JOB_FOLDERS, LATEST_VERSION } from './versions';
import type { JobVersion } from './versions';

export { DEFAULT_SEED, buildJobFiles, generateJob } from './generate';
export type { GeneratedJob } from './generate';
export { JOB_VERSIONS, LATEST_VERSION } from './versions';
export type { JobVersion } from './versions';

/** A committed job folder (generated with DEFAULT_SEED): job.json, tasks, data and checker. */
export function jobDir(version: JobVersion): string {
  return fileURLToPath(new URL(`../${JOB_FOLDERS[version]}/`, import.meta.url));
}

/** The job folder the app ships as its sample. */
export const sampleJobDir = jobDir(LATEST_VERSION);
