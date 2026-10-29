import { createHash } from 'node:crypto';
import {
  DRAFTING_LIMITS,
  TaskSchema,
  type SplitConfig,
  type Task,
  type TaskSpec,
} from '@architect/shared';
import { seededRandom, shuffle } from '../splits/random';
import { DEFAULT_PASS_RATE } from './rule/guards';
import type { RuleOutcome } from './rule/outcome';
import { runFilteredList } from './templates/filtered-list';
import { runGroupTotal } from './templates/group-total';
import { runLookup } from './templates/lookup';
import { runRule } from './templates/rule';
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
  /** For a rule: every case worked out, from which the examples are chosen. */
  outcome?: RuleOutcome;
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

function runTemplate(
  spec: TaskSpec,
  table: Table,
  tables: ReadonlyMap<string, Table>,
  random: () => number,
  passRate: number,
): TemplateRun<TaskSpec> & { outcome?: RuleOutcome | null } {
  switch (spec.template) {
    case 'lookup':
      return runLookup(spec, table);
    case 'filtered_list':
      return runFilteredList(spec, table);
    case 'group_total':
      return runGroupTotal(spec, table, random);
    case 'rule':
      return runRule(spec, tables, passRate);
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

/** The rows of each table, by position, that the teacher was shown while drafting. */
export type ShownRows = ReadonlyMap<string, ReadonlySet<number>>;

/** What the tasks are made with besides the kinds of task: what was shown, and what is asked. */
export interface GenerationContext {
  shown?: ShownRows;
  passRate?: number;
}

/**
 * The requests left once the ones worked out only from rows the teacher was shown are taken out.
 * What the teacher has read the answer to must not come up again as a practice task or in the
 * final test.
 */
function exceptShown(
  candidates: readonly Candidate[],
  rows: ReadonlySet<number> | undefined,
): { kept: Candidate[]; left: number } {
  if (rows === undefined || rows.size === 0) return { kept: [...candidates], left: 0 };
  const kept = candidates.filter(
    (candidate) =>
      candidate.rows === undefined ||
      candidate.rows.length === 0 ||
      !candidate.rows.every((row) => rows.has(row)),
  );
  return { kept, left: candidates.length - kept.length };
}

/**
 * A request as it reads, with case, spacing and punctuation set aside: what two kinds of task
 * ask when they put the same words to the same row, however their rules were written.
 */
function wordsOf(candidate: Candidate): string {
  const request = candidate.meta['request'];
  const text = typeof request === 'string' ? request : (candidate.prompt.split('\n')[0] ?? '');
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Makes the tasks of a job from the kinds of task the teacher chose, each held against its table.
 * A kind whose specification names a column the table lacks, or whose requests would all have
 * one answer, is rejected with its reasons; one whose table supports too few requests is set
 * aside as thin. The rest share the quota.
 *
 * A request that asks what an earlier kind of task already asks, however its conditions are
 * ordered or which template wrote it, is left out, so that one question is never a practice task
 * and a final-test task at once. So is a request that puts an earlier one's words to the same
 * row, whatever rule is behind it: two rules that work out the same number in another order, or
 * differently, still ask one question in those words. So are the requests whose answer comes only
 * from rows the teacher was shown (`shown`). `passRate` is the share of tasks the job asks to get
 * right, which a rule that is a copy in that many cases must not reach.
 */
export function generateTasks(
  inputs: readonly TypeInput[],
  tables: ReadonlyMap<string, Table>,
  seed: number,
  { shown: shownRows = new Map(), passRate = DEFAULT_PASS_RATE }: GenerationContext = {},
): Generation {
  const rejected: Generation['rejected'] = [];
  const thin: Generation['thin'] = [];
  const usable: {
    input: TypeInput;
    run: ReturnType<typeof runTemplate>;
    candidates: Candidate[];
    random: () => number;
  }[] = [];
  /** The question each request asks, with the kind of task that asked it first. */
  const asked = new Map<string, string>();
  /** The words of each request, with the kind of task that put them first. */
  const worded = new Map<string, string>();

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
    const run = runTemplate(input.spec, table, tables, random, passRate);
    const problems = [...run.problems];
    let candidates = run.candidates;
    if (problems.length === 0) {
      const unshown = exceptShown(candidates, shownRows.get(input.spec.table));
      candidates = unshown.kept;
      if (unshown.left > 0) {
        run.notes.push(
          `${unshown.left} ${unshown.left === 1 ? 'request was' : 'requests were'} left out of ${table.name}: the teacher read the rows ${unshown.left === 1 ? 'it is' : 'they are'} about while drafting, and nothing may be asked whose answer it has seen.`,
        );
      }
      const before = (candidate: Candidate): string | undefined =>
        asked.get(candidate.identity) ?? worded.get(wordsOf(candidate));
      const fresh = candidates.filter((candidate) => before(candidate) === undefined);
      const repeats = candidates.length - fresh.length;
      if (repeats > 0) {
        const earlier = candidates.find((candidate) => before(candidate) !== undefined);
        const by = earlier === undefined ? '' : (before(earlier) ?? '');
        const how =
          earlier !== undefined && !asked.has(earlier.identity)
            ? 'in the same words'
            : 'in other words';
        if (fresh.length === 0 && candidates.length > 0) {
          problems.push(
            `Every request of this kind asks what "${by}" already asks, ${how}, so it would only repeat it. Change what it asks, or leave it out.`,
          );
        } else {
          run.notes.push(
            `${repeats} ${repeats === 1 ? 'request asks' : 'requests ask'} what "${by}" already asks, so Architect left ${repeats === 1 ? 'it' : 'them'} out.`,
          );
        }
      }
      candidates = fresh;
    }
    if (problems.length === 0 && candidates.length > 0) {
      const answers = new Set(candidates.map((candidate) => candidate.answerKey));
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
    // Every question this kind could ask is its own, whichever of them it ends up choosing, so a
    // later kind can't ask one of them again.
    const askable = candidates;
    candidates = limitRepeats(candidates, random);
    if (candidates.length < MIN_PER_TYPE) {
      thin.push({ id: input.id, label: input.label, available: candidates.length });
      continue;
    }
    for (const candidate of askable) {
      asked.set(candidate.identity, input.label);
      worded.set(wordsOf(candidate), input.label);
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
      ...(entry.run.outcome ? { outcome: entry.run.outcome } : {}),
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
