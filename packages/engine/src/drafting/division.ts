import type { SplitConfig, Task } from '@architect/shared';
import type { TaskSplits } from '../loop/deps';
import { SplitError } from '../splits/split';
import { splitSizes, trainable, type GeneratedType } from './generate';
import { auditSet } from './rule/guards';

/*
 * Dividing a drafted job's tasks into its sets, and holding the sets as they were divided to the
 * guard a rule is held to over all its cases (decision 061). A rule that is a copy in 79 of 100
 * cases passes the guard at an 80% target, and the final test it is divided into can hold 27 of
 * those in 33 tasks: only the sets as they are sealed say whether a copy could pass them.
 */

/** The ways of dividing the same tasks tried, one seed after another, before they are refused. */
export const DIVISION_ATTEMPTS = 12;

/** Seeds stay under this, as the seeds that tasks are chosen with do. */
const SEED_RANGE = 2_147_483_647;

/**
 * Why a copy could pass a set of tasks a rule was divided into. `detail` says which set and how
 * many of its tasks, which is what the final test holds as proposed: for the person and nobody
 * else. The teacher is told that a copy could pass (`faultsToTeacher`), never what the sets hold.
 */
export interface Fault {
  id: string;
  label: string;
  detail: string;
}

/** What dividing the tasks of a drafted job came to. */
export type Division =
  | {
      kind: 'divided';
      /** The tasks that were divided: fewer than were made when they could not all be. */
      tasks: Task[];
      splits: TaskSplits;
      /** The seed that divided them, which the job keeps so that the same division is made again. */
      seed: number;
    }
  /** Every way of dividing them left a set that a copy could pass, as the first division had it. */
  | { kind: 'unsafe'; faults: Fault[] }
  /** Too few tasks, or none that can be divided with every family in one set. */
  | { kind: 'too_few' };

/**
 * What the person is told when no way of dividing the tasks is safe: each fault in full, with the
 * set and the counts, then how many ways were tried.
 */
export function faultsToPerson(faults: readonly Fault[]): string[] {
  return [
    ...faults.map((fault) => `Task type "${fault.id}" (${fault.label}): ${fault.detail}`),
    `Architect divided the tasks ${DIVISION_ATTEMPTS} ways, and in each the final test or the check tasks could be passed by copying.`,
  ];
}

/**
 * What the teacher is told: for each kind of task whose answers could be copied, that they could
 * be and what to do about it. Nothing of a set is said: not which, not how many tasks, not what
 * share, since the final test is not the teacher's to know, even as it was proposed.
 */
export function faultsToTeacher(faults: readonly Fault[]): string[] {
  const kinds = new Map(faults.map((fault) => [fault.id, fault.label] as const));
  return [...kinds].map(
    ([id, label]) =>
      `Task type "${id}" (${label}): its answers are close enough to a copy of a value in the table, or of the key, that an agent could pass by copying without working anything out. Change the rule so that its answers need more than a copy, or leave this kind of task out.`,
  );
}

/**
 * The faults a copy of a column, or of the key, could pass one of the sets the tasks were divided
 * into: the final test, which decides whether the agent graduates, and the check tasks, whose
 * target ends training. Each rule is held to the cases that became its tasks in that set.
 */
export function auditSplits(
  types: readonly GeneratedType[],
  splits: TaskSplits,
  passRate: number,
): Fault[] {
  const sets = [
    { tasks: 'final-test tasks', passes: 'pass the final test', of: splits.test },
    { tasks: 'check tasks', passes: 'reach the target on the check tasks', of: splits.dev },
  ] as const;
  return types.flatMap((type) => {
    const { outcome } = type;
    if (outcome === undefined) return [];
    const byKey = new Map(outcome.cases.map((item) => [item.key, item]));
    return sets.flatMap((set) => {
      const cases = set.of.flatMap((task) => {
        const key = task.type === type.id ? task.meta?.['key'] : undefined;
        const found = typeof key === 'string' ? byKey.get(key) : undefined;
        return found === undefined ? [] : [found];
      });
      return auditSet(outcome.spec, outcome.tables, cases, passRate, set).map((detail) => ({
        id: type.id,
        label: type.label,
        detail,
      }));
    });
  });
}

/**
 * Divides the tasks into the job's sets, with every family in one set. A job whose tasks can't be
 * divided loses its last tasks, one at a time from its largest kind, until they can; one left
 * with too few to train on is `too_few`. A division that `unsafe` finds a fault in is made again
 * with the next seed, and the faults of the first are what a job that no seed can divide is
 * refused with.
 */
export function divide(
  tasks: readonly Task[],
  seed: number,
  split: (tasks: Task[], config: SplitConfig) => TaskSplits,
  unsafe: (splits: TaskSplits) => Fault[],
): Division {
  const kept = [...tasks];
  for (;;) {
    if (!trainable(kept.length)) return { kind: 'too_few' };
    const sizes = splitSizes(kept.length);
    try {
      let faults: Fault[] = [];
      for (let attempt = 0; attempt < DIVISION_ATTEMPTS; attempt += 1) {
        const tried = (seed + attempt) % SEED_RANGE;
        let splits: TaskSplits;
        try {
          splits = split(kept, { seed: tried, ...sizes });
        } catch (error) {
          // The first seed that can't divide them says the tasks can't be; another seed may.
          if (attempt === 0 || !(error instanceof SplitError)) throw error;
          continue;
        }
        const found = unsafe(splits);
        if (found.length === 0) return { kind: 'divided', tasks: kept, splits, seed: tried };
        if (attempt === 0) faults = found;
      }
      return { kind: 'unsafe', faults };
    } catch (error) {
      if (!(error instanceof SplitError)) throw error;
      const counts = new Map<string, number>();
      for (const task of kept) counts.set(task.type, (counts.get(task.type) ?? 0) + 1);
      const largest = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
      const at = kept.findLastIndex((task) => task.type === largest);
      if (at < 0) return { kind: 'too_few' };
      kept.splice(at, 1);
    }
  }
}
