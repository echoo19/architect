import type { JsonValue, LookupSpec } from '@architect/shared';
import {
  cellsOf,
  kindOf,
  resolveDateOrder,
  type ColumnKind,
  type Table,
  profileColumn,
} from '../table';
import { cleanText, decimalToNumber, foldKey, isBlank, parseDay, parseDecimal } from '../values';
import {
  answerKeyNames,
  canonicalJson,
  checkRequest,
  fillRequest,
  inWords,
  needColumn,
  type Candidate,
  type TemplateRun,
} from './common';

/** The share of rows with a key that more than one row shares, above which the key is not one. */
const MAX_SHARED_KEYS = 0.2;

/** How a column's value is written in the answer, for the line that states its shape. */
function shapeOf(kind: ColumnKind): string {
  if (kind === 'number') return '<number>';
  if (kind === 'date') return '"<YYYY-MM-DD>"';
  return '"<text>"';
}

/**
 * The value of one to three columns for the row with a given key, such as the email of customer
 * C-1042. A row is asked about only when its key is its own and every column asked for has a
 * value Architect can read.
 */
export function runLookup(spec: LookupSpec, table: Table): TemplateRun<LookupSpec> {
  const problems: string[] = [];
  const notes: string[] = [];
  const keyColumn = needColumn(table, spec.keyColumn, 'The key column', problems);
  const columns = spec.columns.map((name) => needColumn(table, name, 'The column', problems));
  checkRequest(spec.request, ['key'], ['key'], problems);
  const resolved: LookupSpec = {
    ...spec,
    keyColumn: keyColumn ?? spec.keyColumn,
    columns: columns.map((column, index) => column ?? spec.columns[index] ?? ''),
  };
  const rule = `Look up ${inWords(resolved.columns)} by ${resolved.keyColumn}, from ${table.name}`;
  if (keyColumn === null || columns.some((column) => column === null)) {
    return { spec: resolved, candidates: [], problems, notes, rule };
  }
  const asked = columns as string[];
  if (new Set(asked).size !== asked.length) problems.push('A column is asked for twice.');
  if (asked.includes(keyColumn)) {
    problems.push(`${keyColumn} is the key, so its value can't also be what is asked for.`);
  }
  if (problems.length > 0) return { spec: resolved, candidates: [], problems, notes, rule };

  const kinds = asked.map((column) => kindOf(cellsOf(table, column)));
  const dayOrders = asked.map((column, index) => {
    if (kinds[index] !== 'date') return null;
    const order = resolveDateOrder(cellsOf(table, column), column, undefined);
    if (order.problem) problems.push(order.problem);
    if (order.assumed) {
      notes.push(
        `${column} writes dates like 03/04/2026 that could be read either way. Architect read them month first, so that is March 4.`,
      );
    }
    return order.order;
  });
  if (problems.length > 0) return { spec: resolved, candidates: [], problems, notes, rule };

  const keys = new Map<string, number>();
  for (const row of table.rows) {
    const key = foldKey(row[keyColumn]);
    if (key !== '') keys.set(key, (keys.get(key) ?? 0) + 1);
  }
  const withKey = [...keys.values()].reduce((sum, count) => sum + count, 0);
  const shared = [...keys.values()].filter((count) => count > 1).reduce((sum, c) => sum + c, 0);
  if (withKey === 0) {
    problems.push(`${keyColumn} has no values in ${table.name}.`);
    return { spec: resolved, candidates: [], problems, notes, rule };
  }
  if (shared / withKey > MAX_SHARED_KEYS) {
    const example = [...keys].find(([, count]) => count > 1)?.[0] ?? '';
    problems.push(
      `${keyColumn} isn't a key: ${shared} of ${withKey} rows share their value with another row, such as "${example}".`,
    );
    return { spec: resolved, candidates: [], problems, notes, rule };
  }
  if (shared > 0) {
    notes.push(
      `${shared} rows share their ${keyColumn} with another row, so Architect left them out.`,
    );
  }

  const names = answerKeyNames(asked);
  const decorated = asked.map((column) => profileColumn(table, column).decorated);
  const candidates: Candidate[] = [];
  let unreadable = 0;
  let missing = 0;
  const askedAbout = asked.map(foldKey).sort();
  for (const [at, row] of table.rows.entries()) {
    const keyText = cleanText(row[keyColumn]);
    if (keyText === '' || (keys.get(keyText.toLowerCase()) ?? 0) !== 1) continue;
    const values: JsonValue[] = [];
    let skip = false;
    for (const [index, column] of asked.entries()) {
      const cell = row[column] ?? null;
      const kind = kinds[index];
      if (kind === 'text' ? cleanText(cell) === '' : isBlank(cell)) {
        missing += 1;
        skip = true;
        break;
      }
      if (kind === 'number') {
        const number = parseDecimal(cell);
        if (number === null) {
          unreadable += 1;
          skip = true;
          break;
        }
        values.push(decimalToNumber(number));
      } else if (kind === 'date') {
        const day = parseDay(cell, dayOrders[index] ?? 'month_first');
        if (day === null) {
          unreadable += 1;
          skip = true;
          break;
        }
        values.push(day);
      } else {
        values.push(cleanText(cell));
      }
    }
    if (skip) continue;

    const answer = Object.fromEntries(names.map((name, index) => [name, values[index] ?? null]));
    const shape = `{${names
      .map((name, index) => `"${name}": ${shapeOf(kinds[index] ?? 'text')}`)
      .join(', ')}}`;
    const hints = [
      kinds.includes('number') &&
        (decorated.some(Boolean)
          ? 'Write numbers as plain digits, without currency signs or commas.'
          : 'Write numbers as plain digits.'),
      kinds.includes('date') && 'Write dates as YYYY-MM-DD.',
    ].filter((hint): hint is string => typeof hint === 'string');
    const question = fillRequest(spec.request, { key: keyText });
    candidates.push({
      family: `row:${table.name}:${keyColumn}=${keyText.toLowerCase()}`,
      identity: canonicalJson([
        'lookup',
        foldKey(table.name),
        foldKey(keyColumn),
        foldKey(keyText),
        askedAbout,
      ]),
      rows: [at],
      prompt: [question, ...hints, `End with: ANSWER: ${shape}`].join('\n'),
      expected: {
        kind: 'facts',
        facts: names.map((name, index) => ({ path: name, value: values[index] ?? null })),
      },
      answerKey: canonicalJson(answer),
      meta: { template: 'lookup', key: keyText, request: question },
    });
  }
  if (missing > 0) {
    notes.push(`${missing} rows lack a value in a column asked for, so Architect left them out.`);
  }
  if (unreadable > 0) {
    notes.push(`${unreadable} rows have a value Architect can't read, so it left them out.`);
  }
  if (candidates.length === 0) {
    problems.push(
      `No row of ${table.name} has a value for ${inWords(asked)} that Architect can read.`,
    );
  }
  return { spec: resolved, candidates, problems, notes, rule };
}
