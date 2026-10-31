import { fileURLToPath } from 'node:url';

export { LAB_SEEDS, buildJobFiles, buildLab, generateJob } from './generate';
export type { GeneratedJob, GeneratedLab } from './generate';

/** The committed job folder: job.json, the checker, the tasks and each lab's files. */
export const jobDir = fileURLToPath(new URL('../job/', import.meta.url));
