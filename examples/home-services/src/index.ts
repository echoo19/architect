import { fileURLToPath } from 'node:url';

export { DEFAULT_SEED, buildJobFiles, generateJob } from './generate';
export type { GeneratedJob } from './generate';

/** The committed job folder (generated with DEFAULT_SEED): job.json, tasks, data and checker. */
export const sampleJobDir = fileURLToPath(new URL('../job/', import.meta.url));
