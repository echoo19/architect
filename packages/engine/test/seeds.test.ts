import { describe, expect, it } from 'vitest';
import { deriveSeed, devSeeds, fanOutSeeds, roundSeed, sampleTrainBatch } from '../src/loop/seeds';
import { task } from './fakes/job';

describe('run seeds', () => {
  it('fans a run seed out into independent, reproducible sub-seeds', () => {
    const seeds = fanOutSeeds(7);
    expect(fanOutSeeds(7)).toEqual(seeds);
    expect(new Set(Object.values(seeds)).size).toBe(5);
    expect(fanOutSeeds(8).devPanel).not.toBe(seeds.devPanel);
    for (const value of Object.values(seeds)) {
      expect(Number.isInteger(value) && value >= 0 && value < 2 ** 31).toBe(true);
    }
  });

  it('gives each round its own seed', () => {
    const seeds = fanOutSeeds(7);
    expect(roundSeed(seeds.trainBatch, 1)).not.toBe(roundSeed(seeds.trainBatch, 2));
    expect(roundSeed(seeds.trainBatch, 1)).toBe(deriveSeed(seeds.trainBatch, 'round-1'));
  });

  it('gives each dev evaluation one seed per repeat, the baseline from the panel seed', () => {
    const panel = fanOutSeeds(7).devPanel;
    expect(devSeeds(panel, null, 1)).toEqual([panel]);
    const first = devSeeds(panel, 1, 3);
    expect(first[0]).toBe(roundSeed(panel, 1));
    expect(new Set(first).size).toBe(3);
    expect(devSeeds(panel, 1, 3)).toEqual(first);
    expect(devSeeds(panel, 1, 2)).toEqual(first.slice(0, 2));
    expect(devSeeds(panel, 2, 3).some((seed) => first.includes(seed))).toBe(false);
  });
});

describe('sampleTrainBatch', () => {
  const train = ['invoice', 'overdue', 'scheduling'].flatMap((type) =>
    [1, 2, 3, 4].map((n) => task('train', type, n)),
  );

  it('is the same batch for the same seed, whatever order the tasks come in', () => {
    const batch = sampleTrainBatch(train, 6, 99).map((t) => t.id);
    expect(sampleTrainBatch([...train].reverse(), 6, 99).map((t) => t.id)).toEqual(batch);
  });

  it('covers every type it has room for', () => {
    const batch = sampleTrainBatch(train, 6, 3);
    expect(batch).toHaveLength(6);
    for (const type of ['invoice', 'overdue', 'scheduling']) {
      expect(batch.filter((t) => t.type === type)).toHaveLength(2);
    }
  });

  it('varies with the seed and never repeats a task', () => {
    const batches = [1, 2, 3, 4].map((seed) =>
      sampleTrainBatch(train, 5, seed)
        .map((t) => t.id)
        .join(','),
    );
    expect(new Set(batches).size).toBeGreaterThan(1);
    const big = sampleTrainBatch(train, 50, 1);
    expect(big).toHaveLength(train.length);
    expect(new Set(big.map((t) => t.id)).size).toBe(train.length);
  });
});
