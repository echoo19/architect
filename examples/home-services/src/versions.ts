/**
 * The sample job comes in two versions, both generated from this package. Version 1 is the first
 * published job, kept as a frozen secondary benchmark so earlier measurements stay reproducible:
 * its files must never change. Version 2 is the harder revision the app ships as its sample.
 */
export type JobVersion = 1 | 2;

export const JOB_VERSIONS: readonly JobVersion[] = [1, 2];

export const LATEST_VERSION: JobVersion = 2;

/** The folder each version is generated into, beside `src/`. */
export const JOB_FOLDERS: Readonly<Record<JobVersion, string>> = { 1: 'job-v1', 2: 'job' };
