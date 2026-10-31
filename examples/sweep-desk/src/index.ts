import { fileURLToPath } from 'node:url';

export { GROUP_SEEDS, buildGroup, buildJobFiles, generateJob } from './generate';
export type { GeneratedGroup, GeneratedJob } from './generate';

/** The committed job folder: job.json, the checker, the tasks and each group's files. */
export const jobDir = fileURLToPath(new URL('../job/', import.meta.url));
