import type { RuleBranch, RuleNode, RuleSpec } from '@architect/shared';
import { addProblem } from '../templates/common';
import { parseDecimal } from '../values';
import type { RuleCase, Tables } from './cases';
import {
  answerTakingOtherSide,
  answerWithout,
  conditionalsOf,
  nodesOf,
  reached,
} from './expression';
import * as q from './rational';
import { roundingText, sideLabel, type WordsContext } from './words';

/*
 * What a rule must not be, however well it is written. An agent that can pass without working
 * anything out teaches nothing and proves nothing, so a rule that makes the same answer for every
 * case, repeats the key, copies a column, or has a branch that never changes an answer is refused
 * with the reason. An answer that is already written in a column is allowed but said.
 */

/** The share of cases in which an answer may equal one value before the rule is called a copy. */
const COPY_SHARE = 0.9;
/** ... and before it is only mentioned. */
const MENTION_SHARE = 0.25;

/**
 * The most significant digits an answer may have. A number the checker compares holds fifteen
 * digits exactly, and at fifteen a wrong answer one step off lies within the rounding of the right
 * one, so it could pass. Thirteen leaves room to spare, and money to the cent, which is under a
 * billion here, needs eleven.
 */
export const MAX_ANSWER_DIGITS = 13;

/** The digits of a number's text that tell it apart: its leading zeros and its point don't count. */
export function significantDigits(text: string): number {
  return text.replace(/^-/, '').replace('.', '').replace(/^0+/, '').length;
}

export interface Audit {
  /** What is wrong with the rule, in the words the teacher is told: counts, and no answer. */
  problems: string[];
  /** A problem again with the answers of the records in it, by the words the teacher is told. */
  inFull: Map<string, string>;
  flags: string[];
  /** Each side of each condition, each operand of a smallest or largest. */
  branches: RuleBranch[];
}

interface Side {
  cases: number;
  changes: number;
}

function percent(count: number, of: number): string {
  return `${Math.round((100 * count) / of)}%`;
}

/** Every numeric column of a table with the value of each case, to look for copies of the answer. */
function copiesOf(
  tables: Tables,
  spec: RuleSpec,
  cases: readonly RuleCase[],
): { name: string; matches: number }[] {
  const found: { name: string; matches: number }[] = [];
  const scan = (
    name: string,
    columns: readonly string[],
    rowOf: (row: RuleCase) => Record<string, string | null> | null,
  ) => {
    for (const column of columns) {
      let matches = 0;
      for (const item of cases) {
        const cell = rowOf(item)?.[column] ?? null;
        const value = cell === null ? null : parseDecimal(cell);
        if (value !== null && q.equal(q.fromDecimal(value), item.answer)) matches += 1;
      }
      if (matches > 0) {
        found.push({ name: name === '' ? column : `${column} (${name})`, matches });
      }
    }
  };
  // The key is not scanned: an answer that is the key is told apart, with its own reason.
  scan(
    '',
    tables.source.columns.filter((column) => column !== spec.keyColumn),
    (item) => item.row,
  );
  if (tables.lookup && spec.lookup)
    scan(spec.lookup.table, tables.lookup.columns, (item) => item.lookupRow);
  return found;
}

/** How many cases have their own key for an answer. */
function echoesIn(cases: readonly RuleCase[]): number {
  return cases.filter((item) => {
    const key = parseDecimal(item.key);
    return key !== null && q.equal(q.fromDecimal(key), item.answer);
  }).length;
}

/** The share of the final test a job asks to get right, when nobody said. */
export const DEFAULT_PASS_RATE = 0.9;

/**
 * Holds the cases that became the tasks of one set to the guard all of a rule's cases are held
 * to. Every case together can be short of a copy and the few that were chosen for a set not: with
 * an 80% target, 79 copies in 100 cases pass `auditCases`, and a final test of 33 holding 27 of
 * them is a copy that passes. `set` names the tasks and what a copy would get past.
 */
export function auditSet(
  spec: RuleSpec,
  tables: Tables,
  cases: readonly RuleCase[],
  passRate: number,
  set: { tasks: string; passes: string },
): string[] {
  const chosen = cases.length;
  if (chosen === 0) return [];
  const copyShare = Math.min(COPY_SHARE, passRate);
  const copying = (what: string, matches: number): string =>
    `Of the ${chosen} ${set.tasks} Architect set aside, ${matches} (${percent(matches, chosen)}) have ${what} for their answer, and the job asks for ${percent(passRate, 1)} right, so an agent that copies it would ${set.passes} without working anything out. A rule has to work something out.`;
  const problems: string[] = [];
  const echoes = echoesIn(cases);
  if (echoes / chosen >= copyShare) problems.push(copying(`the ${spec.keyColumn}`, echoes));
  for (const copy of copiesOf(tables, spec, cases)) {
    if (copy.matches / chosen >= copyShare) {
      problems.push(copying(`the value of ${copy.name}`, copy.matches));
    }
  }
  return problems;
}

/**
 * Holds the cases of a rule to the guards and counts what each branch does. `passRate` is the
 * share of tasks the job asks to get right: a rule that copies a value in that many cases lets a
 * copy pass.
 */
export function auditCases(
  spec: RuleSpec,
  tables: Tables,
  cases: readonly RuleCase[],
  words: WordsContext,
  passRate: number = DEFAULT_PASS_RATE,
): Audit {
  const problems: string[] = [];
  const inFull = new Map<string, string>();
  const flags: string[] = [];
  const branches: RuleBranch[] = [];
  const eligible = cases.length;
  if (eligible === 0) return { problems, inFull, flags, branches };

  // The teacher is told that the answers are all one, or how long the longest is; the person is
  // told which, since an answer is the value of a row the teacher was not shown.
  const answers = new Set(cases.map((item) => q.toText(item.answer).text));
  if (answers.size < 2) {
    const same = `Every row of ${spec.table} that can be worked out comes to the same ${spec.answerName}`;
    const agent = 'so an agent could pass without working anything out.';
    addProblem(
      problems,
      inFull,
      `${same}, ${agent}`,
      `${same}, ${[...answers][0] ?? ''}, ${agent}`,
    );
  }
  // An answer is graded as a number, so one with more digits than a number holds exactly could be
  // matched by a wrong answer that differs from it in the last place.
  const longest = [...answers].reduce(
    (most, text) => (significantDigits(text) > significantDigits(most) ? text : most),
    '0',
  );
  if (significantDigits(longest) > MAX_ANSWER_DIGITS) {
    const grading = `has ${significantDigits(longest)} digits, and an answer is graded as a number that holds ${MAX_ANSWER_DIGITS} exactly, so a wrong answer could be taken for the right one. Round the answer to a coarser step, such as the cent for money.`;
    addProblem(
      problems,
      inFull,
      `The longest answer ${grading}`,
      `An answer such as ${longest} ${grading}`,
    );
  }

  // An agent that copies a value passes as soon as the copy is right in as many cases as the job
  // asks to get right, so a rule that is a copy in that many is no test at all.
  const copyShare = Math.min(COPY_SHARE, passRate);
  const copying = (what: string, why: string, matches: number): string =>
    matches / eligible >= COPY_SHARE
      ? `The answer is just ${what}, ${why}. A rule has to work something out.`
      : `The answer is ${what} in ${percent(matches, eligible)} of the rows, and the job asks for ${percent(passRate, 1)} right, so an agent that copies it would pass without working anything out. A rule has to work something out.`;

  const echoes = echoesIn(cases);
  if (echoes / eligible >= copyShare) {
    problems.push(copying(`the ${spec.keyColumn}`, 'which the request already gives', echoes));
  }

  for (const copy of copiesOf(tables, spec, cases)) {
    if (copy.matches / eligible >= copyShare) {
      problems.push(copying(`the value of ${copy.name}`, 'which needs no rule', copy.matches));
    } else if (copy.matches / eligible >= MENTION_SHARE) {
      flags.push(
        `In ${percent(copy.matches, eligible)} of the rows the answer is already written in ${copy.name}, so an agent could read it instead of working it out.`,
      );
    }
  }

  // What each condition, smallest, largest and rounding did across the cases. A side or an operand
  // counts as changing an answer only when the final answer is different without it: a difference
  // that the last rounding wipes out changes nothing for the person.
  const sides = new Map<RuleNode, [Side, Side]>();
  const wins = new Map<RuleNode, Side[]>();
  const rounds = new Map<RuleNode, { reached: number; changed: number }>();
  for (const item of cases) {
    reached(item.run, (run) => {
      const { node } = run;
      if (node.op === 'if' && run.choice) {
        const pair = sides.get(node) ?? [
          { cases: 0, changes: 0 },
          { cases: 0, changes: 0 },
        ];
        const side = run.choice.held ? pair[0] : pair[1];
        side.cases += 1;
        const other = answerTakingOtherSide(spec.expression, item.inputs, node, run.choice.held);
        if (!q.equal(other, item.answer)) side.changes += 1;
        sides.set(node, pair);
      } else if ((node.op === 'min' || node.op === 'max') && run.winner) {
        const counts = wins.get(node) ?? node.args.map(() => ({ cases: 0, changes: 0 }));
        const won = counts[run.winner.index];
        if (run.winner.alone && won !== undefined) {
          won.cases += 1;
          const without = answerWithout(spec.expression, item.inputs, node, run.winner.index);
          if (!q.equal(without, item.answer)) won.changes += 1;
        }
        wins.set(node, counts);
      } else if (node.op === 'round' && run.before) {
        const seen = rounds.get(node) ?? { reached: 0, changed: 0 };
        seen.reached += 1;
        if (!q.equal(run.before, run.value)) seen.changed += 1;
        rounds.set(node, seen);
      }
    });
  }

  const idle = (label: string, why: string): string =>
    `The rule never changes an answer where ${label}: ${why}. Add records where it does, or leave it out of the rule and say it is left open.`;
  for (const node of conditionalsOf(spec.expression)) {
    const pair = sides.get(node) ?? [
      { cases: 0, changes: 0 },
      { cases: 0, changes: 0 },
    ];
    pair.forEach((side, at) => {
      const label = sideLabel(node, at === 0 ? 'first' : 'second', words);
      branches.push({ label, cases: side.cases, changes: side.changes });
      if (side.changes === 0) {
        problems.push(
          idle(
            label,
            side.cases === 0
              ? `no row of ${spec.table} that can be worked out is like that`
              : `the answer is the same on either side for all ${side.cases} rows that are`,
          ),
        );
      }
    });
  }
  for (const node of nodesOf(spec.expression)) {
    if (node.op !== 'min' && node.op !== 'max') continue;
    const counts = wins.get(node) ?? [];
    node.args.forEach((_arg, at) => {
      const label = sideLabel(node, String(at), words);
      const { cases, changes } = counts[at] ?? { cases: 0, changes: 0 };
      branches.push({ label, cases, changes });
      if (changes === 0) {
        problems.push(
          idle(
            label,
            cases === 0
              ? `no row of ${spec.table} that can be worked out is like that`
              : `the answer is the same without it for all ${cases} rows that are`,
          ),
        );
      }
    });
  }
  for (const [node, seen] of rounds) {
    if (node.op !== 'round' || seen.changed > 0) continue;
    flags.push(
      `The rounding step (${roundingText(node.mode, node.increment, words.currency)}) never changed a value in your records, so no task shows it at work.`,
    );
  }
  // A rounding written on both sides of a condition is one thing to say, once.
  return { problems, inFull, flags: [...new Set(flags)], branches };
}
