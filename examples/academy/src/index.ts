import { fileURLToPath } from 'node:url';

export { ACADEMY_SEEDS, buildAcademy, buildJobFiles, generateJob } from './generate';
export type { BuildOptions, GeneratedAcademy, GeneratedJob } from './generate';
export { buildRecordTasks, readAcademyFolder } from './tasks/records';
export type { RecordTaskOptions } from './tasks/records';

/** The committed job folder: job.json, the checker, the tasks and each academy's files. */
export const jobDir = fileURLToPath(new URL('../job/', import.meta.url));
