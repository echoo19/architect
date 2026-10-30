import type { SplitConfig, SplitName, Task } from '@architect/shared';
import { seededRandom, shuffle } from './random';

/**
 * The split sizes, and the size of the sealed calibration split a certificate is computed on
 * (decision 077): none unless asked for.
 */
export type SplitRequest = SplitConfig & { certify?: number };

export interface TaskSplits {
  calibration: Task[];
  train: Task[];
  dev: Task[];
  test: Task[];
  /** The sealed calibration split of a certified job; empty otherwise. */
  certify: Task[];
  /** Tasks beyond the requested counts, left out of every split. */
  unused: Task[];
}

/** The split request can't be met; the message says what to change. */
export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitError';
  }
}

/** Held-out splits are filled first, so their type proportions are the most exact. */
const BUCKETS = ['test', 'certify', 'dev', 'train', 'calibration', 'unused'] as const;
type Bucket = (typeof BUCKETS)[number];
/** Search steps allowed per tolerance level before trying a looser one. */
const SEARCH_LIMIT = 200_000;

interface Family {
  name: string;
  tasks: Task[];
  /** Tasks of each type, indexed like the sorted type list. */
  counts: number[];
  size: number;
}

/**
 * Splits tasks into calibration, train, dev and test, and the sealed calibration split when asked. The result depends only on the task set and
 * the seed, never on input order or platform. Families never cross splits, each split gets
 * exactly the requested count, and task types (at each organization, for a job with them) are
 * spread in proportion as closely as the family sizes allow.
 */
export function splitTasks(tasks: readonly Task[], config: SplitRequest): TaskSplits {
  const ids = tasks.map((task) => task.id);
  const repeated = ids.find((id, index) => ids.indexOf(id) !== index);
  if (repeated !== undefined) {
    throw new SplitError(
      `Task id "${repeated}" appears more than once; every task needs its own id.`,
    );
  }
  const certify = config.certify ?? 0;
  const requested = config.calibration + config.train + config.dev + config.test + certify;
  if (requested > tasks.length) {
    throw new SplitError(
      `The splits ask for ${requested} tasks (${describeCounts(config)}), but there are only ${tasks.length}.`,
    );
  }

  const types = [...new Set(tasks.map(stratum))].sort(byCodeUnit);
  const families = groupFamilies(tasks, types);
  const totals: Record<Bucket, number> = {
    test: config.test,
    dev: config.dev,
    train: config.train,
    calibration: config.calibration,
    certify,
    unused: tasks.length - requested,
  };
  const targets = typeTargets(families, types.length, totals);
  const order = shuffle(families, seededRandom(`architect-split:${config.seed}`));

  const largest = Math.max(...families.map((family) => family.size));
  for (let slack = 0; slack <= largest; slack += 1) {
    const assignment = search(order, targets, totals, slack, types.length);
    if (assignment) return collect(order, assignment);
  }
  const big = [...families]
    .sort((a, b) => b.size - a.size || byCodeUnit(a.name, b.name))
    .slice(0, 3)
    .map((family) => `${family.name} (${family.size} tasks)`);
  throw new SplitError(
    `Can't split ${tasks.length} tasks into ${describeCounts(config)} while keeping each family in one split. The largest families are ${big.join(', ')}; split them up or change the split sizes.`,
  );
}

function groupFamilies(tasks: readonly Task[], types: readonly string[]): Family[] {
  const byName = new Map<string, Task[]>();
  for (const task of tasks) byName.set(task.family, [...(byName.get(task.family) ?? []), task]);
  return [...byName.keys()].sort(byCodeUnit).map((name) => {
    const members = (byName.get(name) ?? []).sort((a, b) => byCodeUnit(a.id, b.id));
    const counts = types.map((type) => members.filter((task) => stratum(task) === type).length);
    return { name, tasks: members, counts, size: members.length };
  });
}

/**
 * How many tasks of each type each bucket should get: each bucket in turn takes its share of what
 * is left, in proportion, rounded by largest remainder with ties going to the earlier type.
 */
function typeTargets(
  families: readonly Family[],
  typeCount: number,
  totals: Record<Bucket, number>,
): number[][] {
  const left = Array.from({ length: typeCount }, (_, type) =>
    families.reduce((sum, family) => sum + (family.counts[type] ?? 0), 0),
  );
  return BUCKETS.map((bucket) => {
    const pool = left.reduce((sum, count) => sum + count, 0);
    const total = totals[bucket];
    const shares = left.map((count) => (pool === 0 ? 0 : Math.floor((total * count) / pool)));
    const order = left
      .map((count, type) => ({ type, remainder: pool === 0 ? 0 : (total * count) % pool }))
      .sort((a, b) => b.remainder - a.remainder || a.type - b.type);
    let extra = total - shares.reduce((sum, share) => sum + share, 0);
    for (const { type } of order) {
      if (extra === 0) break;
      shares[type] = (shares[type] ?? 0) + 1;
      extra -= 1;
    }
    shares.forEach((share, type) => (left[type] = (left[type] ?? 0) - share));
    return shares;
  });
}

/**
 * Depth-first search for a bucket per family such that every bucket total is exact and every
 * bucket's count of each type is within `slack` of its target. Buckets are tried in a fixed
 * order and families in shuffled order, so the first solution is a seeded random one.
 */
function search(
  families: readonly Family[],
  targets: readonly number[][],
  totals: Record<Bucket, number>,
  slack: number,
  typeCount: number,
): number[] | null {
  const capacity = BUCKETS.map((bucket) => totals[bucket]);
  const high = targets.map((row) => row.map((target) => target + slack));
  const low = targets.map((row) => row.map((target) => Math.max(0, target - slack)));
  const filled = BUCKETS.map(() => new Array<number>(typeCount).fill(0));
  const sizes = BUCKETS.map(() => 0);
  const unassigned = Array.from({ length: typeCount }, (_, type) =>
    families.reduce((sum, family) => sum + (family.counts[type] ?? 0), 0),
  );

  const move = (family: Family, bucket: number, direction: 1 | -1) => {
    sizes[bucket] = (sizes[bucket] ?? 0) + direction * family.size;
    family.counts.forEach((count, type) => {
      const row = filled[bucket] as number[];
      row[type] = (row[type] ?? 0) + direction * count;
      unassigned[type] = (unassigned[type] ?? 0) - direction * count;
    });
  };
  const fits = (family: Family, bucket: number) =>
    (sizes[bucket] ?? 0) + family.size <= (capacity[bucket] ?? 0) &&
    family.counts.every(
      (count, type) => (filled[bucket]?.[type] ?? 0) + count <= (high[bucket]?.[type] ?? 0),
    );
  // The unassigned tasks must still be able to meet every lower bound and fill every bucket.
  const reachable = () =>
    unassigned.every((left, type) => {
      const needed = BUCKETS.reduce(
        (sum, _, bucket) =>
          sum + Math.max(0, (low[bucket]?.[type] ?? 0) - (filled[bucket]?.[type] ?? 0)),
        0,
      );
      return needed <= left;
    }) &&
    BUCKETS.every((_, bucket) => {
      const room = unassigned.reduce(
        (sum, left, type) =>
          sum + Math.min(left, (high[bucket]?.[type] ?? 0) - (filled[bucket]?.[type] ?? 0)),
        0,
      );
      return (capacity[bucket] ?? 0) - (sizes[bucket] ?? 0) <= room;
    });

  const choice = new Array<number>(families.length).fill(-1);
  let depth = 0;
  let steps = 0;
  while (depth >= 0) {
    steps += 1;
    if (steps > SEARCH_LIMIT) return null;
    const family = families[depth] as Family;
    const previous = choice[depth] ?? -1;
    if (previous >= 0) move(family, previous, -1);
    let bucket = previous + 1;
    while (bucket < BUCKETS.length && !fits(family, bucket)) bucket += 1;
    if (bucket === BUCKETS.length) {
      choice[depth] = -1;
      depth -= 1;
      continue;
    }
    choice[depth] = bucket;
    move(family, bucket, 1);
    if (!reachable()) continue;
    if (depth === families.length - 1) return choice;
    depth += 1;
  }
  return null;
}

function collect(families: readonly Family[], assignment: readonly number[]): TaskSplits {
  const splits: TaskSplits = {
    calibration: [],
    train: [],
    dev: [],
    test: [],
    certify: [],
    unused: [],
  };
  families.forEach((family, index) => {
    const bucket = BUCKETS[assignment[index] ?? -1] as Bucket;
    splits[bucket].push(...family.tasks);
  });
  for (const bucket of BUCKETS) splits[bucket].sort((a, b) => byCodeUnit(a.id, b.id));
  return splits;
}

function describeCounts(config: SplitRequest): string {
  const names = ['calibration', 'train', 'dev', 'test'] as const satisfies SplitName[];
  const counts = names.map((name) => `${name} ${config[name]}`);
  return [...counts, ...(config.certify ? [`certification ${config.certify}`] : [])].join(', ');
}

/**
 * What a split spreads in proportion: the task's type, and for a task of an organization the type
 * at that organization, so every split holds each organization's share of each type.
 */
function stratum(task: Task): string {
  return task.org === undefined ? task.type : `${task.type}@${task.org}`;
}

/** Code-unit order, not localeCompare, so sorting is the same on every machine. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
