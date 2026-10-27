import { createHash } from 'node:crypto';

/**
 * A task's sampler seed, fixed by the evaluation seed and the task id. Two harnesses evaluated
 * with the same seed meet the same seed on every task, so their results compare pair by pair.
 */
export function taskSeed(seed: number, taskId: string): number {
  return createHash('sha256').update(`${seed}:${taskId}`).digest().readUInt32LE(0) & 0x7fffffff;
}
