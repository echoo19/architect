import { createHash } from 'node:crypto';
import {
  DRAFTING_LIMITS,
  TaskSchema,
  type SplitConfig,
  type Task,
  type TaskSpec,
} from '@architect/shared';
import { seededRandom, shuffle } from '../splits/random';
import { runFilteredList } from './templates/filtered-list';
import { runGroupTotal } from './templates/group-total';
import { runLookup } from './templates/lookup';
import type { Candidate, TemplateRun } from './templates/common';
import type { Table } from './table';

/*
 * Making the tasks of a drafted job. Coverage, not a quota: every kind of request makes as many
 * different requests as its table honestly supports, up to about a hundred and twenty in all.
 */

/** The most tasks a drafted job holds. */
export const MAX_TASKS = 120;

/**
 * The fewest tasks a job can be trained on. Thirty split as the sample jobs are (a third to the
 * final test, a quarter to the check tasks) leaves 10 final-test tasks, 8 check tasks and 9
 * practice tasks. With fewer, the check tasks can't tell the two-task gain the keep rule asks
 * for from luck, and a final test under 8 can't tell a 90% agent from a 70% one.
 */
export const MIN_TASKS = DRAFTING_LIMITS.minTasks;
export const MIN_FINAL_TEST = 8;

/** The fewest requests a kind of task must support to be worth a place in the job. */
export const MIN_PER_TYPE = 6;

/**
 * No answer may be right for more than this many requests of a type, so that an agent can't pass
 * by remembering a value (decision 018), and no more than this many requests may ask about the
 * same row, group or filter value.
 */
export const MAX_SAME_ANSWER = 3;
export const MAX_PER_FAMILY = 3;
/** An empty list is a fair answer, but only now and then. */
export const MAX_EMPTY_ANSWERS = 2;
const EMPTY_LIST = '[]';

export interface TypeInput {
  id: string;
  label: string;
  description: string;
  spec: TaskSpec;
}

export interface GeneratedType {
  id: string;
  label: string;
  description: string;
  rule: string;
  /** The specification with its columns spelled as the table spells them. */
  spec: TaskSpec;
  notes: string[];
  /** Different requests the table supports, once repeated answers and families are held to their limits. */
  available: number;
  /** How many of them are tasks of the job. */
  chosen: number;
}

export interface Generation {
  tasks: Task[];
  /** The kinds of task that made tasks, in the order they were given. */
  types: GeneratedType[];
  /** Kinds of task that can't be used, each with its reasons. */
  rejected: { id: string; label: string; problems: string[] }[];
  /** Kinds of task whose table supports fewer than `MIN_PER_TYPE` requests. */
  thin: { id: string; label: string; available: number }[];
}

function runTemplate(spec: TaskSpec, table: Table, random: () => number): TemplateRun<TaskSpec> {
  switch (spec.template) {
    case 'lookup':
      return runLookup(spec, table);
    case 'filtered_list':
      return runFilteredList(spec, table);
    case 'group_total':
      return runGroupTotal(spec, table, random);
  }
}

/**
 * The requests to keep, in a seeded order: no answer repeated more than `MAX_SAME_ANSWER` times,
 * and no family more than `MAX_PER_FAMILY` times.
 */
export function limitRepeats(candidates: readonly Candidate[], random: () => number): Candidate[] {
  const byAnswer = new Map<string, number>();
  const byFamily = new Map<string, number>();
  const kept: Candidate[] = [];
  for (const candidate of shuffle(candidates, random)) {
    const answers = byAnswer.get(candidate.answerKey) ?? 0;
    const limit = candidate.answerKey === EMPTY_LIST ? MAX_EMPTY_ANSWERS : MAX_SAME_ANSWER;
    const families = byFamily.get(candidate.family) ?? 0;
    if (answers >= limit || families >= MAX_PER_FAMILY) continue;
    byAnswer.set(candidate.answerKey, answers + 1);
    byFamily.set(candidate.family, families + 1);
    kept.push(candidate);
  }
  return kept;
}

/** `count` of the requests, taking one from each family before taking a second from any. */
export function spread(candidates: readonly Candidate[], count: number): Candidate[] {
  const families = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    families.set(candidate.family, [...(families.get(candidate.family) ?? []), candidate]);
  }
  const lists = [...families.values()];
  const picked: Candidate[] = [];
  for (let round = 0; picked.length < count; round += 1) {
    let added = false;
    for (const list of lists) {
      const next = list[round];
      if (next === undefined) continue;
      picked.push(next);
      added = true;
      if (picked.length === count) break;
    }
    if (!added) break;
  }
  return picked;
}

/** Shares a quota among kinds of task that can each give only so many, as evenly as it can. */
export function allocate(supports: readonly number[], quota: number): number[] {
  const given = supports.map(() => 0);
  let left = quota;
  for (;;) {
    const open = supports.flatMap((support, index) =>
      (given[index] ?? 0) < support ? [index] : [],
    );
    if (left === 0 || open.length === 0) break;
    const share = Math.max(1, Math.floor(left / open.length));
    for (const index of open) {
      const take = Math.min(share, (supports[index] ?? 0) - (given[index] ?? 0), left);
      given[index] = (given[index] ?? 0) + take;
      left -= take;
      if (left === 0) break;
    }
  }
  return given;
}

/** The text of an answer, for a message about it. */
function shown(answerKey: string): string {
  return answerKey.length > 60 ? `${answerKey.slice(0, 59)}...` : answerKey;
}

function taskId(type: string, index: number): string {
  return `${type}-${String(index + 1).padStart(3, '0')}`;
}

/**
 * Makes the tasks of a job from the kinds of task the teacher chose, each held against its table.
 * A kind whose specification names a column the table lacks, or whose requests would all have
 * one answer, is rejected with its reasons; one whose table supports too few requests is set
 * aside as thin. The rest share the quota.
 */
export function generateTasks(
  inputs: readonly TypeInput[],
  tables: ReadonlyMap<string, Table>,
  seed: number,
): Generation {
  const rejected: Generation['rejected'] = [];
  const thin: Generation['thin'] = [];
  const usable: {
    input: TypeInput;
    run: TemplateRun<TaskSpec>;
    candidates: Candidate[];
    random: () => number;
  }[] = [];

  for (const input of inputs) {
    const random = seededRandom(`architect-draft:${seed}:${input.id}`);
    const table = tables.get(input.spec.table);
    if (table === undefined) {
      rejected.push({
        id: input.id,
        label: input.label,
        problems: [`There is no table called ${input.spec.table}.`],
      });
      continue;
    }
    const run = runTemplate(input.spec, table, random);
    const problems = [...run.problems];
    if (problems.length === 0) {
      const answers = new Set(run.candidates.map((candidate) => candidate.answerKey));
      if (answers.size < 2) {
        problems.push(
          `Every request would have the same answer${answers.size === 1 ? `, ${shown([...answers][0] ?? '')}` : ''}, so an agent could pass without reading the data.`,
        );
      }
    }
    if (problems.length > 0) {
      rejected.push({ id: input.id, label: input.label, problems });
      continue;
    }
    const candidates = limitRepeats(run.candidates, random);
    if (candidates.length < MIN_PER_TYPE) {
      thin.push({ id: input.id, label: input.label, available: candidates.length });
      continue;
    }
    usable.push({ input, run, candidates, random });
  }

  const shares = allocate(
    usable.map((entry) => entry.candidates.length),
    MAX_TASKS,
  );
  const types: GeneratedType[] = [];
  const tasks: Task[] = [];
  usable.forEach((entry, index) => {
    const chosen = spread(entry.candidates, shares[index] ?? 0);
    chosen.forEach((candidate, position) => {
      tasks.push(
        TaskSchema.parse({
          id: taskId(entry.input.id, position),
          type: entry.input.id,
          family: candidate.family,
          prompt: candidate.prompt,
          expected: candidate.expected,
          meta: candidate.meta,
        }),
      );
    });
    types.push({
      id: entry.input.id,
      label: entry.input.label,
      description: entry.input.description,
      rule: entry.run.rule,
      spec: entry.run.spec,
      notes: entry.run.notes,
      available: entry.candidates.length,
      chosen: chosen.length,
    });
  });
  return { tasks, types, rejected, thin };
}

/**
 * How many tasks go to each set, in the proportions of the sample jobs: a third to the final
 * test, a quarter to the check tasks, a twelfth to calibration, the rest to practice.
 */
export function splitSizes(
  total: number,
): Pick<SplitConfig, 'calibration' | 'train' | 'dev' | 'test'> {
  const test = Math.round(total / 3);
  const dev = Math.round(total / 4);
  const calibration = Math.round(total / 12);
  return { calibration, train: total - test - dev - calibration, dev, test };
}

/** Whether this many tasks can be trained on: enough in all, and enough for the final test. */
export function trainable(total: number): boolean {
  return total >= MIN_TASKS && splitSizes(total).test >= MIN_FINAL_TEST;
}

/** A seed that follows from what the job is made of, so the same files and answers make the same tasks. */
export function seedFrom(parts: readonly string[]): number {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(`${part.length}:${part}\n`);
  return Number.parseInt(hash.digest('hex').slice(0, 8), 16) % 2_147_483_647;
}
