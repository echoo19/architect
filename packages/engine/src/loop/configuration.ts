import { DEFAULT_CONFIG_KEY, type Actor, type TrainedAdapter } from '@architect/shared';

/**
 * What an attempt runs as, beside its harness version (decision 042): who acts, on which backend,
 * and with which adapter at which scale. Attempts are stored and reused by this key, so an
 * adapter-off measurement is never taken for an adapter-on one, nor the student's for Spark's.
 */
export interface AttemptConfig {
  actor: Actor;
  /**
   * `job` for the job's own student endpoint on the evaluation's target, `llama.cpp` for a
   * student served with adapters, or the reference model's provider.
   */
  backend: string;
  /** The adapter applied, by its training job's id, at its scale; null applies none. */
  adapter: { id: string; scale: number } | null;
  /**
   * Every adapter a llama.cpp server loads, so all the configurations of one experiment share a
   * server and a copy of the weights; the key leaves them out, since only `adapter` is applied.
   */
  loaded?: readonly TrainedAdapter[];
}

/** The job's own student with no adapter: every attempt made before configurations existed. */
export const STUDENT_CONFIG: AttemptConfig = { actor: 'student', backend: 'job', adapter: null };

/** The backend that serves a student with adapters. */
export const LLAMA_CPP = 'llama.cpp';

/** The stored key of a configuration; the job's student with no adapter keeps the old key. */
/** Whether an attempt was Spark's as a reference, which nothing about the student counts. */
export function isReferenceAttempt(attempt: { config?: string }): boolean {
  return attempt.config?.startsWith('reference/') === true;
}

export function configurationKey(config: AttemptConfig): string {
  if (config.actor === 'student' && config.backend === 'job' && config.adapter === null) {
    return DEFAULT_CONFIG_KEY;
  }
  const adapter = config.adapter === null ? 'none' : `${config.adapter.id}@${config.adapter.scale}`;
  return `${config.actor}/${config.backend}/${adapter}`;
}

/**
 * The student on llama.cpp with `applied` at scale 1 and every other loaded adapter at 0, or
 * the base alone when `applied` is null.
 */
export function llamaCppConfig(
  loaded: readonly TrainedAdapter[],
  applied: TrainedAdapter | null,
): AttemptConfig {
  return {
    actor: 'student',
    backend: LLAMA_CPP,
    adapter: applied === null ? null : { id: applied.id, scale: 1 },
    loaded,
  };
}
