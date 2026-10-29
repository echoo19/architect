import type { FilteredListSpec, FilterSpec } from '@architect/shared';
import type { Table } from '../table';
import { cleanText, foldKey } from '../values';
import {
  canonicalJson,
  checkRequest,
  columnList,
  fillRequest,
  inWords,
  needColumn,
  spellings,
  type Candidate,
  type TemplateRun,
} from './common';

/** The most keys an answer may list; a longer list is more than a request should ask for. */
export const MAX_LISTED = 20;

/** The most varying columns, and the most conditions of any kind. */
const MAX_VARYING = 2;
const MAX_FIXED = 2;

/** The values a membership filter keeps, cleaned and without repeats. */
function keptValues(filter: FilterSpec): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const value of filter.values ?? []) {
    const text = cleanText(value);
    if (text === '' || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    kept.push(text);
  }
  return kept;
}

function describeFixed(filter: FilterSpec): string {
  switch (filter.op) {
    case 'equals':
      return `${filter.column} is ${cleanText(filter.value)}`;
    case 'in':
      return `${filter.column} is ${inWords(keptValues(filter), 'or')}`;
    case 'not_equals':
      return `${filter.column} is not ${cleanText(filter.value)}`;
    case 'empty':
      return `${filter.column} is empty`;
    case 'not_empty':
      return `${filter.column} is filled in`;
  }
}

/** Whether a row's cell meets a fixed condition. */
function meets(filter: FilterSpec, cell: string | null): boolean {
  const empty = cleanText(cell) === '';
  switch (filter.op) {
    case 'empty':
      return empty;
    case 'not_empty':
      return !empty;
    case 'equals':
      return !empty && foldKey(cell) === foldKey(filter.value);
    case 'in':
      return !empty && keptValues(filter).some((value) => foldKey(value) === foldKey(cell));
    case 'not_equals':
      return foldKey(cell) !== foldKey(filter.value);
  }
}

/**
 * What else a membership filter's column holds, so the person can see which rows are left out
 * and say so if one of those values should count.
 */
function leftOutValues(table: Table, filter: FilterSpec): string[] {
  const kept = new Set(keptValues(filter).map((value) => value.toLowerCase()));
  const shown = spellings(table.rows.map((row) => row[filter.column] ?? null));
  const counts = new Map<string, number>();
  let empty = 0;
  for (const row of table.rows) {
    const key = cleanText(row[filter.column]).toLowerCase();
    if (key === '') empty += 1;
    else if (!kept.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const others = [...counts].sort((a, b) => b[1] - a[1]);
  const notes: string[] = [];
  if (others.length > 0) {
    const named = others
      .slice(0, 6)
      .map(([key, rows]) => `${shown.get(key) ?? key} (${rows} ${rows === 1 ? 'row' : 'rows'})`);
    notes.push(
      `${filter.column} also holds ${inWords(named)}${others.length > 6 ? ' and more' : ''}. ${others.length === 1 ? 'Those rows are' : 'Rows with those values are'} not listed, because only ${inWords(keptValues(filter), 'or')} count.`,
    );
  }
  if (empty > 0) {
    notes.push(
      `${empty} ${empty === 1 ? 'row has' : 'rows have'} no ${filter.column}, so ${empty === 1 ? 'it is' : 'they are'} not listed.`,
    );
  }
  return notes;
}

/**
 * The key values of the rows that meet a few conditions, such as the orders still unshipped in a
 * region. One or two conditions take each of their column's values in turn, one request apiece; the
 * others are fixed. A request is made only when its list is short enough to write out.
 */
export function runFilteredList(
  spec: FilteredListSpec,
  table: Table,
): TemplateRun<FilteredListSpec> {
  const problems: string[] = [];
  const notes: string[] = [];
  const keyColumn = needColumn(table, spec.keyColumn, 'The column to list', problems);
  const filters = spec.filters.map((filter) => {
    const column = needColumn(table, filter.column, 'The filter column', problems);
    return { ...filter, column: column ?? filter.column, found: column !== null };
  });
  const varying = filters.filter((filter) => filter.varies);
  const fixed = filters.filter((filter) => !filter.varies);
  const resolved: FilteredListSpec = {
    ...spec,
    keyColumn: keyColumn ?? spec.keyColumn,
    filters: filters.map(({ found: _found, ...filter }) => filter),
  };
  const fixedWords = fixed.map(describeFixed);
  const rule =
    `List the ${resolved.keyColumn} in ${table.name}` +
    (fixedWords.length > 0 ? ` where ${inWords(fixedWords)}` : '') +
    `, for each ${inWords(varying.map((filter) => filter.column))}`;

  if (varying.length === 0) {
    problems.push(
      'One filter must take each value of its column in turn (varies: true), or every request would be the same.',
    );
  }
  if (varying.length > MAX_VARYING) {
    problems.push(`At most ${MAX_VARYING} filters may take their values in turn.`);
  }
  if (fixed.length > MAX_FIXED) problems.push(`At most ${MAX_FIXED} filters may stay fixed.`);
  for (const filter of varying) {
    if (filter.op !== 'equals') {
      problems.push(
        `The filter on ${filter.column} takes its values in turn, so it must be "equals".`,
      );
    }
  }
  for (const filter of fixed) {
    const needsValue = filter.op === 'equals' || filter.op === 'not_equals';
    if (needsValue && filter.value === undefined) {
      problems.push(`The filter on ${filter.column} needs the value it compares with.`);
    }
    if (filter.op === 'in' && keptValues(filter).length === 0) {
      problems.push(`The filter on ${filter.column} needs the values it keeps.`);
    }
  }
  const columns = filters.map((filter) => filter.column);
  if (new Set(columns).size !== columns.length) {
    problems.push('Two filters use the same column.');
  }
  if (columns.includes(resolved.keyColumn)) {
    problems.push(`${resolved.keyColumn} is what is listed, so it can't also be a filter.`);
  }
  checkRequest(
    spec.request,
    varying.map((filter) => filter.column),
    varying.map((filter) => filter.column),
    problems,
  );
  if (keyColumn === null || filters.some((filter) => !filter.found) || problems.length > 0) {
    return { spec: resolved, candidates: [], problems, notes, rule };
  }

  // A condition that no row can meet would leave every list empty. A set of values to keep must
  // be values the column really holds, so a misspelled one can't quietly drop rows.
  for (const filter of fixed) {
    const held = spellings(table.rows.map((row) => row[filter.column] ?? null));
    const holds = (): string => {
      const values = [...held.values()];
      const some = values.slice(0, 12).join(', ');
      return `${filter.column} holds ${some === '' ? 'nothing' : some}${values.length > 12 ? ' and more' : ''}.`;
    };
    if (filter.op === 'in') {
      const unseen = keptValues(filter).filter((value) => !held.has(value.toLowerCase()));
      if (unseen.length > 0) {
        problems.push(
          `No row of ${table.name} has ${inWords(
            unseen.map((value) => `"${value}"`),
            'or',
          )} in ${filter.column}. ${holds()}`,
        );
      }
    } else if (!table.rows.some((row) => meets(filter, row[filter.column] ?? null))) {
      problems.push(`No row of ${table.name} meets "${describeFixed(filter)}". ${holds()}`);
    }
  }
  if (problems.length > 0) return { spec: resolved, candidates: [], problems, notes, rule };
  for (const filter of fixed) {
    if (filter.op === 'in') notes.push(...leftOutValues(table, filter));
  }

  const forms = varying.map((filter) =>
    spellings(table.rows.map((row) => row[filter.column] ?? null)),
  );
  // Each combination of values the varying columns take together, with the keys of the rows that
  // meet every fixed condition. A combination no row meets has an empty list.
  const lists = new Map<string, Map<string, string>>();
  let rowsWithoutKey = 0;
  for (const row of table.rows) {
    const values = varying.map((filter) => foldKey(row[filter.column]));
    if (values.some((value) => value === '')) continue;
    const combination = JSON.stringify(values);
    const list = lists.get(combination) ?? new Map<string, string>();
    lists.set(combination, list);
    if (!fixed.every((filter) => meets(filter, row[filter.column] ?? null))) continue;
    const key = cleanText(row[keyColumn]);
    if (key === '') {
      rowsWithoutKey += 1;
      continue;
    }
    list.set(key.toLowerCase(), key);
  }
  if (rowsWithoutKey > 0) {
    notes.push(`${rowsWithoutKey} rows have no ${keyColumn}, so they are never listed.`);
  }

  const candidates: Candidate[] = [];
  let tooLong = 0;
  for (const [combination, list] of lists) {
    const folded = JSON.parse(combination) as string[];
    const keys = [...list.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (keys.length > MAX_LISTED) {
      tooLong += 1;
      continue;
    }
    const shown = folded.map((value, index) => forms[index]?.get(value) ?? value);
    const values = Object.fromEntries(
      varying.map((filter, index) => [filter.column, shown[index]]),
    );
    const question = fillRequest(spec.request, values as Record<string, string>);
    candidates.push({
      family: `list:${table.name}:${varying[0]?.column ?? ''}=${folded[0] ?? ''}`,
      prompt: [
        question,
        `List each ${resolved.keyColumn} once, in any order, and use [] if there are none.`,
        `End with: ANSWER: ["<${resolved.keyColumn}>", ...]`,
      ].join('\n'),
      expected: { kind: 'answer', value: keys, compare: { mode: 'set' } },
      answerKey: canonicalJson(keys.map((key) => key.toLowerCase())),
      meta: { ...values, template: 'filtered_list', request: question },
    });
  }
  if (tooLong > 0) {
    notes.push(
      `${tooLong} requests would list more than ${MAX_LISTED} ${resolved.keyColumn} values, so Architect left them out.`,
    );
  }
  if (candidates.length === 0) {
    problems.push(
      `Every list is longer than ${MAX_LISTED}. Narrow it with another condition. ${table.name} has the columns ${columnList(table)}.`,
    );
  }
  return { spec: resolved, candidates, problems, notes, rule };
}
