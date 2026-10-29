import type { RuleBranch, RuleNode, RuleSpec } from '@architect/shared';
import { parseDecimal } from '../values';
import type { RuleCase, Tables } from './cases';
import { conditionalsOf, reached } from './expression';
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

export interface Audit {
  problems: string[];
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

/** Holds the cases of a rule to the guards and counts what each branch does. */
export function auditCases(
  spec: RuleSpec,
  tables: Tables,
  cases: readonly RuleCase[],
  words: WordsContext,
): Audit {
  const problems: string[] = [];
  const flags: string[] = [];
  const branches: RuleBranch[] = [];
  const eligible = cases.length;
  if (eligible === 0) return { problems, flags, branches };

  const answers = new Set(cases.map((item) => q.toText(item.answer).text));
  if (answers.size < 2) {
    problems.push(
      `Every row of ${spec.table} that can be worked out comes to the same ${spec.answerName}, ${[...answers][0] ?? ''}, so an agent could pass without working anything out.`,
    );
  }

  const echoes = cases.filter((item) => {
    const key = parseDecimal(item.key);
    return key !== null && q.equal(q.fromDecimal(key), item.answer);
  }).length;
  if (echoes / eligible >= COPY_SHARE) {
    problems.push(
      `The answer is just the ${spec.keyColumn}, which the request already gives. A rule has to work something out.`,
    );
  }

  for (const copy of copiesOf(tables, spec, cases)) {
    if (copy.matches / eligible >= COPY_SHARE) {
      problems.push(
        `The answer is just the value of ${copy.name}, which needs no rule. A rule has to work something out.`,
      );
    } else if (copy.matches / eligible >= MENTION_SHARE) {
      flags.push(
        `In ${percent(copy.matches, eligible)} of the rows the answer is already written in ${copy.name}, so an agent could read it instead of working it out.`,
      );
    }
  }

  // What each condition, smallest, largest and rounding did across the cases.
  const sides = new Map<RuleNode, [Side, Side]>();
  const wins = new Map<RuleNode, number[]>();
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
        if (!q.equal(run.choice.first, run.choice.second)) side.changes += 1;
        sides.set(node, pair);
      } else if ((node.op === 'min' || node.op === 'max') && run.winner) {
        const counts = wins.get(node) ?? node.args.map(() => 0);
        if (run.winner.alone) counts[run.winner.index] = (counts[run.winner.index] ?? 0) + 1;
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
  for (const [node, counts] of wins) {
    if (node.op !== 'min' && node.op !== 'max') continue;
    node.args.forEach((_arg, at) => {
      const label = sideLabel(node, String(at), words);
      const cases = counts[at] ?? 0;
      branches.push({ label, cases, changes: cases });
      if (cases === 0) {
        problems.push(idle(label, `no row of ${spec.table} that can be worked out is like that`));
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
  return { problems, flags: [...new Set(flags)], branches };
}
