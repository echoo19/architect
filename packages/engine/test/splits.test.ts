import type { SplitConfig, Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { seededRandom } from '../src/splits/random';
import { SplitError, splitTasks, type TaskSplits } from '../src/splits/split';

/** Tasks of each type in families of the given sizes, e.g. invoice: [1, 2, 3]. */
function makeTasks(families: Record<string, number[]>): Task[] {
  const tasks: Task[] = [];
  for (const [type, sizes] of Object.entries(families)) {
    sizes.forEach((size, family) => {
      for (let member = 0; member < size; member += 1) {
        tasks.push({
          id: `${type}-${family}-${member}`,
          type,
          family: `${type}-family-${family}`,
          prompt: `Handle ${type} case ${family}.${member}.`,
          expected: { kind: 'answer', value: family, compare: { mode: 'exact' } },
        });
      }
    });
  }
  return tasks;
}

const cycle = (count: number, sizes: number[]) =>
  Array.from({ length: count }, (_, i) => sizes[i % sizes.length] as number);
const ids = (tasks: Task[]) => tasks.map((task) => task.id);
const SPLITS = ['calibration', 'train', 'dev', 'test'] as const;

function perType(splits: TaskSplits) {
  return Object.fromEntries(
    SPLITS.map((split) => {
      const counts: Record<string, number> = {};
      for (const task of splits[split]) counts[task.type] = (counts[task.type] ?? 0) + 1;
      return [split, counts];
    }),
  );
}

// 165 tasks like the sample job: three types of 55, in families of one to three.
const sample = makeTasks({
  invoice: [...cycle(27, [1, 2, 3]), 1],
  overdue: cycle(33, [2, 1, 2]),
  schedule: [...cycle(39, [1, 1, 2]), 1, 1, 1],
});
const sampleConfig: SplitConfig = { seed: 20261027, calibration: 15, train: 60, dev: 30, test: 60 };

describe('splitTasks', () => {
  it('fills every split with exactly the requested number of tasks', () => {
    const splits = splitTasks(sample, sampleConfig);
    expect(SPLITS.map((split) => splits[split].length)).toEqual([15, 60, 30, 60]);
    expect(new Set(SPLITS.flatMap((split) => ids(splits[split]))).size).toBe(165);
    expect(splits.unused).toEqual([]);
  });

  it('never lets a family cross splits', () => {
    const splits = splitTasks(sample, sampleConfig);
    const home = new Map<string, string>();
    for (const split of SPLITS) {
      for (const task of splits[split]) {
        expect(home.get(task.family) ?? split).toBe(split);
        home.set(task.family, split);
      }
    }
  });

  it('spreads task types in proportion', () => {
    const counts = perType(splitTasks(sample, sampleConfig));
    expect(counts.test).toEqual({ invoice: 20, overdue: 20, schedule: 20 });
    expect(counts.dev).toEqual({ invoice: 10, overdue: 10, schedule: 10 });
    expect(counts.train).toEqual({ invoice: 20, overdue: 20, schedule: 20 });
    expect(counts.calibration).toEqual({ invoice: 5, overdue: 5, schedule: 5 });
  });

  it('depends only on the task set and the seed', () => {
    const first = splitTasks(sample, sampleConfig);
    const reversed = splitTasks([...sample].reverse(), sampleConfig);
    expect(reversed).toEqual(first);
    const reordered = [...sample].sort((a, b) => (a.id.length % 3) - (b.id.length % 3));
    expect(splitTasks(reordered, sampleConfig)).toEqual(first);
    const other = splitTasks(sample, { ...sampleConfig, seed: 1 });
    expect(ids(other.test)).not.toEqual(ids(first.test));
  });

  it('gives the same split on every platform', () => {
    // Pinned output: CI on Linux and development on Windows must both produce exactly this.
    const small = makeTasks({ invoice: [1, 1, 2, 1, 1], overdue: [2, 1, 1, 2] });
    const splits = splitTasks(small, { seed: 7, calibration: 0, train: 6, dev: 2, test: 4 });
    expect(ids(splits.test)).toEqual(['invoice-3-0', 'invoice-4-0', 'overdue-0-0', 'overdue-0-1']);
    expect(ids(splits.dev)).toEqual(['invoice-1-0', 'overdue-1-0']);
    expect(ids(splits.train)).toEqual([
      'invoice-0-0',
      'invoice-2-0',
      'invoice-2-1',
      'overdue-2-0',
      'overdue-3-0',
      'overdue-3-1',
    ]);
  });

  it('meets exact counts when families make the proportional split impossible', () => {
    // 10 invoice tasks in families of five cannot give test its proportional 3; types shift by a family.
    const tasks = makeTasks({ invoice: [5, 5], overdue: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
    const splits = splitTasks(tasks, { seed: 3, calibration: 0, train: 10, dev: 4, test: 6 });
    expect(SPLITS.map((split) => splits[split].length)).toEqual([0, 10, 4, 6]);
  });

  it('leaves out tasks beyond the requested counts', () => {
    const tasks = makeTasks({ invoice: [1, 1, 1, 1, 1, 1], overdue: [1, 1, 1, 1] });
    const splits = splitTasks(tasks, { seed: 5, calibration: 1, train: 4, dev: 2, test: 1 });
    expect(splits.unused).toHaveLength(2);
    expect(SPLITS.map((split) => splits[split].length)).toEqual([1, 4, 2, 1]);
  });

  it('explains requests it cannot meet', () => {
    const tasks = makeTasks({ invoice: [1, 1, 1] });
    expect(() => splitTasks(tasks, { seed: 1, calibration: 0, train: 2, dev: 1, test: 1 })).toThrow(
      new SplitError(
        'The splits ask for 4 tasks (calibration 0, train 2, dev 1, test 1), but there are only 3.',
      ),
    );
    const twice = [...tasks, { ...(tasks[0] as Task) }];
    expect(() => splitTasks(twice, { seed: 1, calibration: 0, train: 1, dev: 1, test: 1 })).toThrow(
      'Task id "invoice-0-0" appears more than once; every task needs its own id.',
    );
    const lumpy = makeTasks({ invoice: [4, 4] });
    expect(() => splitTasks(lumpy, { seed: 1, calibration: 0, train: 5, dev: 1, test: 2 })).toThrow(
      "Can't split 8 tasks into calibration 0, train 5, dev 1, test 2 while keeping each family in one split. The largest families are invoice-family-0 (4 tasks), invoice-family-1 (4 tasks); split them up or change the split sizes.",
    );
  });
});

describe('seededRandom', () => {
  it('repeats its sequence for a seed and stays in [0, 1)', () => {
    const a = seededRandom('seed');
    const b = seededRandom('seed');
    const values = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(values);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(seededRandom('other')()).not.toBe(values[0]);
  });
});
