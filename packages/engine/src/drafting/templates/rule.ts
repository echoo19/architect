import { createHash } from 'node:crypto';
import {
  RULE_CONVENTIONS_VERSION,
  type JsonValue,
  type RuleCategory,
  type RuleCondition,
  type RuleNode,
  type RuleSpec,
} from '@architect/shared';
import { cellsOf, findColumn, kindOf, type Table } from '../table';
import { cleanText, foldKey, isBlank } from '../values';
import { makeCases, type Tables } from '../rule/cases';
import { agreed, currencyName, marksIn } from '../rule/currency';
import { checkExpression, numberRefs, refKey } from '../rule/expression';
import { auditCases, DEFAULT_PASS_RATE } from '../rule/guards';
import type { RuleOutcome } from '../rule/outcome';
import * as q from '../rule/rational';
import { NEAREST_CLAUSE, nameOf, statementOf, type WordsContext } from '../rule/words';
import {
  addProblem,
  answerKeyName,
  canonicalJson,
  checkRequest,
  columnList,
  fillRequest,
  type Candidate,
  type TemplateRun,
} from './common';

/** The share of a lookup table's rows that may share a key before it is not a key at all. */
const MAX_SHARED_KEYS = 0.2;

/** How far from the expected answer a right one may be: half a step of the last rounding, at most. */
const MOST_TOLERANCE = 0.005;

/** A short hash of the rule and of how Architect reads and rounds, so a confirmation can name it. */
export function ruleVersion(spec: RuleSpec): string {
  const plain = JSON.parse(JSON.stringify(spec)) as JsonValue;
  return createHash('sha256')
    .update(canonicalJson({ conventions: RULE_CONVENTIONS_VERSION, spec: plain }))
    .digest('hex')
    .slice(0, 12);
}

/**
 * What makes two rules ask the same question of a row: how the answer is worked out, apart from
 * the words of the request and the passages quoted.
 */
function semanticsOf(spec: RuleSpec): JsonValue {
  const { expression, lookup, categories, currency, emptyMeansZero } = spec;
  return JSON.parse(
    JSON.stringify({ expression, lookup, categories, currency, emptyMeansZero }),
  ) as JsonValue;
}

/** How numbers, words and rounding are read, in plain words, for the person and the report. */
export function conventionsOf(spec: RuleSpec): string[] {
  const zero = spec.emptyMeansZero ?? [];
  const conventions = [
    zero.length === 0
      ? 'Numbers are read as written: a currency sign, thousands separators and brackets or a minus sign for a negative are understood. A cell that is empty, N/A or not a number leaves its row out; it is never counted as zero.'
      : 'Numbers are read as written: a currency sign, thousands separators and brackets or a minus sign for a negative are understood. A cell that is N/A or not a number leaves its row out. Nothing is counted as zero unless you said so.',
    ...zero.map(
      (ref) =>
        `An empty ${ref.column}${ref.from === 'lookup' && spec.lookup ? ` (${spec.lookup.table})` : ''} counts as 0, as you said. N/A or words in it still leave the row out.`,
    ),
  ];
  if (spec.currency !== undefined) {
    conventions.push(
      `Amounts are in ${currencyName(spec.currency)} (${spec.currency}). A cell written in another currency leaves its row out, and a column that mixes currencies is refused.`,
    );
  }
  if (spec.categories.length > 0) {
    conventions.push(
      'Words are compared without regard to capitals or spacing. A value the rule does not list leaves its row out.',
    );
  }
  if (spec.lookup) {
    conventions.push(
      `Each row is matched to one row of ${spec.lookup.table} by ${spec.lookup.matchColumn} = ${spec.lookup.keyColumn}. A row with no match, or whose key that table lists more than once, leaves its row out.`,
    );
  }
  conventions.push(
    `All arithmetic is exact until a rounding step. Up rounds to the larger multiple, down to the smaller, ${NEAREST_CLAUSE}.`,
  );
  return conventions;
}

/** Maps every column of an expression, or says which one a table lacks. */
function resolveNode(
  node: RuleNode,
  column: (name: string, from: 'row' | 'lookup') => string,
): RuleNode {
  const map = (inner: RuleNode): RuleNode => resolveNode(inner, column);
  switch (node.op) {
    case 'num':
      return node;
    case 'col':
      return { ...node, column: column(node.column, node.from) };
    case 'add':
    case 'mul':
    case 'min':
    case 'max':
      return { ...node, args: node.args.map(map) };
    case 'sub':
      return { op: 'sub', args: [map(node.args[0]), map(node.args[1])] };
    case 'div':
    case 'round':
      return { ...node, arg: map(node.arg) };
    case 'if': {
      const when: RuleCondition =
        node.when.test === 'equals' || node.when.test === 'in'
          ? { ...node.when, column: column(node.when.column, node.when.from) }
          : { ...node.when, arg: map(node.when.arg) };
      return { op: 'if', when, then: map(node.then), else: map(node.else) };
    }
  }
}

function distinctValues(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of values) {
    const text = cleanText(value);
    if (text === '' || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    kept.push(text);
  }
  return kept;
}

/** The statement of the tolerance an answer is held to. */
function toleranceOf(spec: RuleSpec): number {
  const last = spec.expression.op === 'round' ? q.fromText(spec.expression.increment) : null;
  return last === null ? MOST_TOLERANCE : Math.min(MOST_TOLERANCE, q.toNumber(last) / 2);
}

/** The words that say how to write the answer: money to the cent, or plain digits. */
function hintOf(spec: RuleSpec): string {
  return spec.currency === undefined
    ? 'Write the number as plain digits.'
    : `Give the amount in ${currencyName(spec.currency)} as a plain number, without a currency sign or commas.`;
}

export type RuleRun = TemplateRun<RuleSpec> & { outcome: RuleOutcome | null };

/**
 * The cases of a rule: one answer for each row of a table, worked out with exact arithmetic from
 * the expression the teacher configured, with the plain-words statement written from that
 * expression. A rule that is wrongly made, or that a guard refuses, comes back with its reasons
 * and no tasks.
 */
export function runRule(
  spec: RuleSpec,
  tables: ReadonlyMap<string, Table>,
  passRate: number = DEFAULT_PASS_RATE,
): RuleRun {
  const problems: string[] = [];
  const inFull = new Map<string, string>();
  const notes: string[] = [];
  const refused = (resolved: RuleSpec, rule: string): RuleRun => ({
    spec: resolved,
    candidates: [],
    problems,
    inFull,
    notes,
    rule,
    outcome: null,
  });
  const source = tables.get(spec.table);
  if (source === undefined) {
    problems.push(`There is no table called ${spec.table}.`);
    return refused(spec, `Work out ${spec.answerName} for each ${spec.keyColumn}`);
  }
  const lookupTable = spec.lookup ? tables.get(spec.lookup.table) : undefined;
  if (spec.lookup && lookupTable === undefined) {
    problems.push(`The lookup names ${spec.lookup.table}, which isn't one of the attached tables.`);
  }

  // Spell every column as its table does, or say which one the table lacks.
  const missing = new Set<string>();
  const found = (table: Table | undefined, name: string, role: string): string => {
    const header = table === undefined ? null : findColumn(table, name);
    if (header !== null) return header;
    if (table !== undefined && !missing.has(`${table.name}:${name}`)) {
      missing.add(`${table.name}:${name}`);
      problems.push(
        `${role} "${name}" isn't a column of ${table.name}. Its columns are ${columnList(table)}.`,
      );
    }
    return name;
  };
  const inTable = (from: 'row' | 'lookup'): Table | undefined =>
    from === 'row' ? source : lookupTable;
  const keyColumn = found(source, spec.keyColumn, 'The key column');
  const familyColumn =
    spec.familyColumn === undefined
      ? undefined
      : found(source, spec.familyColumn, 'The family column');
  const lookup = spec.lookup && {
    table: lookupTable?.name ?? spec.lookup.table,
    keyColumn: found(lookupTable, spec.lookup.keyColumn, 'The lookup key column'),
    matchColumn: found(source, spec.lookup.matchColumn, 'The column to look up by'),
  };
  const expression = resolveNode(spec.expression, (name, from) =>
    found(inTable(from), name, 'The column'),
  );
  const categories: RuleCategory[] = spec.categories.map((category) => ({
    column: found(inTable(category.from), category.column, 'The column'),
    from: category.from,
    values: distinctValues(category.values),
  }));
  const emptyMeansZero = (spec.emptyMeansZero ?? []).map((ref) => ({
    column: found(inTable(ref.from), ref.column, 'The column'),
    from: ref.from,
  }));
  const resolved: RuleSpec = {
    ...spec,
    keyColumn,
    ...(familyColumn === undefined ? {} : { familyColumn }),
    ...(lookup === undefined ? {} : { lookup }),
    categories,
    expression,
    ...(emptyMeansZero.length === 0 ? {} : { emptyMeansZero }),
  };
  const words: WordsContext = {
    ...(lookup === undefined ? {} : { lookupTable: lookup.table }),
    ...(spec.currency === undefined ? {} : { currency: spec.currency }),
    categories,
    ...(emptyMeansZero.length === 0 ? {} : { emptyMeansZero }),
  };
  const rule = `Work out ${spec.answerName.replace(/_/g, ' ')} for each ${keyColumn} of ${source.name}`;

  checkRequest(spec.request, ['key'], ['key'], problems);
  checkExpression(expression, { categories, lookup: lookup !== undefined }, problems);
  // An empty cell can count as zero only in a column the rule adds up.
  const added = new Set(numberRefs(expression).map(refKey));
  for (const ref of emptyMeansZero) {
    if (!added.has(refKey(ref))) {
      problems.push(
        `${ref.column} is said to count as zero when it is empty, but the rule doesn't read it.`,
      );
    }
  }
  if (!/^[a-z]/i.test(spec.answerName))
    problems.push('The name of the answer must start with a letter.');
  if (problems.length > 0) return refused(resolved, rule);

  // The columns the rule adds up must hold numbers, in one currency.
  for (const ref of numberRefs(expression)) {
    const table = inTable(ref.from);
    if (table === undefined) continue;
    const cells = cellsOf(table, ref.column);
    if (cells.every((cell) => isBlank(cell))) {
      problems.push(`${ref.column} in ${table.name} has no values, so a rule can't use it.`);
      continue;
    }
    if (kindOf(cells) !== 'number') {
      problems.push(
        `${ref.column} in ${table.name} holds words or dates, not numbers, so a rule can't add it up.`,
      );
      continue;
    }
    const marks = cells.flatMap(marksIn);
    if (marks.length === 0) continue;
    if (agreed(marks).length === 0) {
      problems.push(
        `${ref.column} in ${table.name} mixes currencies, and adding amounts in different currencies gives an amount in neither.`,
      );
    } else if (spec.currency === undefined) {
      problems.push(
        `${ref.column} in ${table.name} has currency signs, so the rule has to name the currency its amounts are in.`,
      );
    }
  }
  if (lookup && lookupTable) {
    const counts = new Map<string, number>();
    for (const row of lookupTable.rows) {
      const key = foldKey(row[lookup.keyColumn]);
      if (key !== '') counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const withKey = [...counts.values()].reduce((sum, count) => sum + count, 0);
    const shared = [...counts.values()].filter((count) => count > 1).reduce((sum, c) => sum + c, 0);
    if (withKey === 0) problems.push(`${lookup.keyColumn} has no values in ${lookup.table}.`);
    else if (shared / withKey > MAX_SHARED_KEYS) {
      const example = [...counts].find(([, count]) => count > 1)?.[0] ?? '';
      const sharing = `${lookup.keyColumn} isn't a key in ${lookup.table}: ${shared} of ${withKey} rows share their value with another row`;
      addProblem(problems, inFull, `${sharing}.`, `${sharing}, such as "${example}".`);
    }
  }
  if (problems.length > 0) return refused(resolved, rule);

  const caseTables: Tables = { source, lookup: lookupTable ?? null };
  const made = makeCases(resolved, caseTables);
  if (made.cases.length === 0) {
    const why = made.excluded
      .slice(0, 3)
      .map((item) => `${item.count} because ${item.reason}`)
      .join('; ');
    problems.push(`No row of ${source.name} can be worked out${why === '' ? '' : `: ${why}`}.`);
    return refused(resolved, rule);
  }
  const audit = auditCases(resolved, caseTables, made.cases, words, passRate);
  problems.push(...audit.problems);
  for (const [teacher, person] of audit.inFull) inFull.set(teacher, person);
  if (problems.length > 0) return refused(resolved, rule);

  const statement = statementOf(expression, words);
  // How far an empty cell counted as zero reaches, so the person sees what their answer decided.
  const zeroed = emptyMeansZero.flatMap((ref) => {
    const count = made.cases.filter((item) => item.zeroed.has(refKey(ref))).length;
    return count === 0
      ? []
      : [
          `${count} ${count === 1 ? 'row has' : 'rows have'} an empty ${nameOf(ref, words)}, which counts as 0, as you said.`,
        ];
  });
  const flags = [...audit.flags, ...zeroed];
  const details: RuleOutcome['details'] = {
    version: ruleVersion(resolved),
    statement,
    passages: resolved.sources,
    conventions: conventionsOf(resolved),
    cases: { total: source.rows.length, eligible: made.cases.length },
    excluded: made.excluded.map(({ reason, count, example }) => ({ reason, count, example })),
    branches: audit.branches,
    flags,
  };
  const outcome: RuleOutcome = {
    spec: resolved,
    tables: caseTables,
    words,
    details,
    cases: made.cases,
    requestOf: (key) => fillRequest(spec.request, { key }),
  };

  const name = answerKeyName(spec.answerName);
  const tolerance = toleranceOf(resolved);
  const semantics = semanticsOf(resolved);
  const candidates: Candidate[] = made.cases.map((item) => {
    const answer = q.toNumber(item.answer);
    const question = outcome.requestOf(item.key);
    return {
      family: `rule:${source.name}:${familyColumn ?? keyColumn}=${item.family}`,
      identity: canonicalJson([
        'rule',
        foldKey(source.name),
        foldKey(keyColumn),
        foldKey(item.key),
        semantics,
      ]),
      rows: [item.rowIndex],
      prompt: [question, hintOf(resolved), `End with: ANSWER: {"${name}": <number>}`].join('\n'),
      expected: {
        kind: 'answer',
        value: { [name]: answer },
        compare: { mode: 'number', tolerance },
      },
      answerKey: canonicalJson({ [name]: answer }),
      meta: { template: 'rule', key: item.key, request: question },
    };
  });
  for (const item of made.excluded) {
    notes.push(
      `${item.count} ${item.count === 1 ? 'row' : 'rows'} of ${source.name} left out because ${item.reason}, such as ${item.example}.`,
    );
  }
  for (const flag of flags) notes.push(flag);
  return {
    spec: resolved,
    candidates,
    problems,
    notes,
    rule: `${rule}: ${statement}`,
    outcome,
  };
}
