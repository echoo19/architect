import type { Task } from '@architect/shared';
import type { RunSeeds } from '../store/records';

/**
 * The runner owns every sampler seed (decision 007). A run's seed fans out into independent
 * sub-seeds that are recorded on the run, so any number it produces can be reproduced.
 */

/** Mixes a seed and a label into an independent non-negative 31-bit seed. */
export function deriveSeed(seed: number, label: string): number {
  const text = `${seed}:${label}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // A murmur3 finalizer, so labels that differ by one character give unrelated seeds.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash & 0x7fffffff;
}

export function fanOutSeeds(seed: number): RunSeeds {
  return {
    trainBatch: deriveSeed(seed, 'train-batch'),
    trainStudent: deriveSeed(seed, 'train-student'),
    devPanel: deriveSeed(seed, 'dev-panel'),
    test: deriveSeed(seed, 'test'),
    mentor: deriveSeed(seed, 'mentor'),
  };
}

/** The seed one round uses, derived from a sub-seed. */
export function roundSeed(subSeed: number, round: number): number {
  return deriveSeed(subSeed, `round-${round}`);
}

/**
 * The sampler seeds of one dev evaluation, one per repeat, from the run's dev panel seed: the
 * baseline's (round null) start with the panel seed itself, and each round draws its own, which
 * its candidate and the incumbent share.
 */
export function devSeeds(panel: number, round: number | null, repeats: number): number[] {
  const first = round === null ? panel : roundSeed(panel, round);
  return Array.from({ length: repeats }, (_, repeat) =>
    repeat === 0 ? first : deriveSeed(first, `repeat-${repeat + 1}`),
  );
}

/** mulberry32: small and fast, and plenty for shuffling task lists. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Plain code-unit order, so sorting is identical on every machine and locale. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The train tasks one round attempts. Tasks are shuffled within each type and the types are
 * taken in turn, so a batch covers every type it has room for.
 */
export function sampleTrainBatch(train: readonly Task[], size: number, seed: number): Task[] {
  const random = seededRandom(seed);
  const byType = new Map<string, Task[]>();
  for (const task of [...train].sort((a, b) => compareText(a.id, b.id))) {
    const group = byType.get(task.type);
    if (group) group.push(task);
    else byType.set(task.type, [task]);
  }
  const types = shuffle([...byType.keys()].sort(compareText), random);
  const queues = types.map((type) => shuffle(byType.get(type) ?? [], random));
  const batch: Task[] = [];
  while (batch.length < size && queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const task = queue.shift();
      if (task && batch.length < size) batch.push(task);
    }
  }
  return batch;
}
