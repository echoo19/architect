import { splitTasks } from '@architect/engine';
import type { Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, buildJobFiles } from '../src';
import { parseCsv } from '../src/lib/csv';
import type { OrderQuestion } from '../src/reference/orders';
import { answerOrder, solvePickup, solveReturn } from '../src/reference/solver';
import type { PickupRequest, ReturnRequest } from '../src/reference/solver';
import { DeskTools } from '../src/reference/tools';
import { plainTables } from '../src/shop/exports';
import { BUSINESS_DATE, MESSY_TABLES, job } from './helpers';

/**
 * The mentor sees each file's first rows and the attempts on train tasks; the locked test stays
 * in the vault. So the values written another way must turn up in the rows train attempts read,
 * or watching could never show them. The split here is the runner's own, from job.json's seed.
 */

const splits = splitTasks(job.allTasks(), job.job().splits);

describe("the runner's split of this job", () => {
  it('has the sizes job.json asks for, each split with every task type', () => {
    expect(
      [splits.calibration, splits.train, splits.dev, splits.test].map((s) => s.length),
    ).toEqual([15, 60, 45, 60]);
    expect(splits.unused).toEqual([]);
    for (const split of [splits.train, splits.dev, splits.test]) {
      expect(new Set(split.map((task) => task.type))).toEqual(
        new Set(['refund', 'order', 'pickup']),
      );
    }
  });

  it('keeps every family in one split', () => {
    const home = new Map<string, string>();
    for (const [name, tasks] of Object.entries(splits) as [string, Task[]][]) {
      for (const task of tasks) {
        expect(home.get(task.family) ?? name, task.family).toBe(name);
        home.set(task.family, name);
      }
    }
  });
});

describe('the rows train attempts read', () => {
  const tools = splits.train.map((task) => {
    const desk = new DeskTools(job.data());
    if (task.type === 'refund') {
      solveReturn(desk, task.meta?.request as unknown as ReturnRequest, BUSINESS_DATE);
    } else if (task.type === 'pickup') {
      solvePickup(desk, task.meta?.request as unknown as PickupRequest, BUSINESS_DATE);
    } else {
      answerOrder(desk, task.meta?.question as unknown as OrderQuestion);
    }
    return desk;
  });
  const plain = plainTables(buildJobFiles(DEFAULT_SEED).shop);

  it.each(MESSY_TABLES)('include rows of %s written another way', (name) => {
    const truth = parseCsv(plain[name] as string);
    const written = job.table(name);
    const seen = new Set(tools.flatMap((desk) => [...desk.rowsSeen(name)]));
    const varied = [...seen].filter((index) =>
      Object.keys(written[index] ?? {}).some(
        (column) => written[index]?.[column] !== truth[index]?.[column],
      ),
    );
    expect(varied.length, name).toBeGreaterThanOrEqual(1);
    expect([...seen].every((index) => index >= 0)).toBe(true);
  });

  it('meet every kind of value written another way', () => {
    const kinds = new Set<string>();
    for (const task of splits.train) {
      for (const trap of task.meta?.traps as string[]) {
        if (trap.startsWith('messy_') || trap === 'old_category') kinds.add(trap);
      }
    }
    expect([...kinds].sort()).toEqual(
      ['messy_date', 'messy_email', 'messy_money', 'messy_sku', 'old_category'].sort(),
    );
  });
});
