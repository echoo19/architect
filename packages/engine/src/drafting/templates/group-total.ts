import type { GroupTotalSpec } from '@architect/shared';
import { shuffle } from '../../splits/random';
import {
  cellsOf,
  dayCell,
  kindOf,
  numberCell,
  profileColumn,
  resolveDateOrder,
  type Table,
} from '../table';
import { addDays, dayNumber, decimalToNumber, foldKey, sumDecimals, type Decimal } from '../values';
import {
  canonicalJson,
  checkRequest,
  fillRequest,
  needColumn,
  spellings,
  type Candidate,
  type TemplateRun,
} from './common';

/**
 * The most date ranges made for one group, none overlapping another, how long one runs in days,
 * and how many tries a group gets to find them.
 */
const RANGES_PER_GROUP = 6;
const RANGE_LENGTHS = [7, 14, 21, 30, 45];
const ATTEMPTS = 40;
/** The fewest days the dates must cover for ranges to make sense. */
const MIN_SPAN_DAYS = 14;
/** Candidates to collect before stopping, so one huge table can't take long. */
const CANDIDATE_LIMIT = 1_200;
/** Unreadable cells to name in a message. */
const EXAMPLES = 3;

interface Entry {
  day: string | null;
  amount: Decimal | null;
  /** Whether the row counts when rows are counted. */
  counted: boolean;
}

function exampleCells(bad: readonly string[]): string {
  return bad
    .slice(0, EXAMPLES)
    .map((text) => `"${text}"`)
    .join(', ');
}

/**
 * The sum, or the count, of a column for one value of a grouping column, such as the total of
 * amount for a region, optionally within a range of dates. Rows with no date are left out of a
 * ranged total, and an empty amount adds nothing. A total is made only when every filled cell of
 * the column read can be read, so no total rests on a guess.
 */
export function runGroupTotal(
  spec: GroupTotalSpec,
  table: Table,
  random: () => number,
): TemplateRun<GroupTotalSpec> {
  const problems: string[] = [];
  const notes: string[] = [];
  const groupColumn = needColumn(table, spec.groupColumn, 'The grouping column', problems);
  const valueColumn =
    spec.valueColumn === undefined
      ? null
      : needColumn(table, spec.valueColumn, 'The column to add up', problems);
  const dateColumn =
    spec.dateColumn === undefined
      ? null
      : needColumn(table, spec.dateColumn, 'The date column', problems);
  const resolved: GroupTotalSpec = {
    ...spec,
    groupColumn: groupColumn ?? spec.groupColumn,
    ...(valueColumn === null ? {} : { valueColumn }),
    ...(dateColumn === null ? {} : { dateColumn }),
  };
  const what =
    spec.measure === 'sum'
      ? `Total of ${resolved.valueColumn ?? 'the column'}${spec.unit === 'cents' ? ' in cents' : ''}`
      : resolved.valueColumn === undefined
        ? 'Number of rows'
        : `Number of rows with a ${resolved.valueColumn}`;
  const rule =
    `${what} for each ${resolved.groupColumn}` +
    (resolved.dateColumn === undefined
      ? ''
      : `, within a range of dates in ${resolved.dateColumn}`) +
    `, from ${table.name}`;

  if (spec.measure === 'sum' && spec.valueColumn === undefined) {
    problems.push('A total needs the column to add up.');
  }
  if (spec.unit === 'cents' && spec.measure !== 'sum') {
    problems.push('Cents only apply to a total, not to a count.');
  }
  checkRequest(
    spec.request,
    spec.dateColumn === undefined ? ['group'] : ['group', 'from', 'to'],
    spec.dateColumn === undefined ? ['group'] : ['group', 'from', 'to'],
    problems,
  );
  if (
    problems.length > 0 ||
    groupColumn === null ||
    (spec.valueColumn !== undefined && valueColumn === null) ||
    (spec.dateColumn !== undefined && dateColumn === null)
  ) {
    return { spec: resolved, candidates: [], problems, notes, rule };
  }

  // Read the amounts and the dates; one cell that can't be read stops the totals that use it.
  let order = resolved.dateOrder ?? 'month_first';
  if (dateColumn !== null) {
    const cells = cellsOf(table, dateColumn);
    const settled = resolveDateOrder(cells, dateColumn, spec.dateOrder);
    if (settled.problem) problems.push(settled.problem);
    order = settled.order;
    if (settled.assumed) {
      notes.push(
        `${dateColumn} writes dates like 03/04/2026 that could be read either way. Architect read them month first, so that is March 4.`,
      );
    }
    if (kindOf(cells) !== 'date') {
      problems.push(`${dateColumn} doesn't read as dates.`);
    }
  }
  const entries = new Map<string, Entry[]>();
  const badAmounts: string[] = [];
  const badDays: string[] = [];
  let missingDays = 0;
  for (const row of table.rows) {
    const group = foldKey(row[groupColumn]);
    if (group === '') continue;
    let amount: Decimal | null = null;
    let counted = true;
    if (valueColumn !== null) {
      const cell = numberCell(row[valueColumn] ?? null);
      if ('bad' in cell) badAmounts.push(cell.bad);
      else if (cell.empty) counted = false;
      else amount = cell.value;
    }
    let day: string | null = null;
    if (dateColumn !== null) {
      const cell = dayCell(row[dateColumn] ?? null, order);
      if ('bad' in cell) badDays.push(cell.bad);
      else if (cell.empty) missingDays += 1;
      else day = cell.day;
    }
    const list = entries.get(group) ?? [];
    list.push({ day, amount, counted });
    entries.set(group, list);
  }
  if (valueColumn !== null && badAmounts.length > 0) {
    problems.push(
      `${valueColumn} has ${badAmounts.length} values Architect can't read as numbers, such as ${exampleCells(badAmounts)}.`,
    );
  }
  if (dateColumn !== null && badDays.length > 0) {
    problems.push(
      `${dateColumn} has ${badDays.length} values Architect can't read as dates, such as ${exampleCells(badDays)}.`,
    );
  }
  if (problems.length > 0) return { spec: resolved, candidates: [], problems, notes, rule };
  if (dateColumn !== null && missingDays > 0) {
    notes.push(
      `${missingDays} rows have no ${dateColumn}, so they are left out of every total within dates.`,
    );
  }

  const places =
    valueColumn === null || spec.measure !== 'sum'
      ? 0
      : Math.max(
          0,
          ...[...entries.values()].flatMap((list) =>
            list.map((entry) => entry.amount?.places ?? 0),
          ),
        );
  if (spec.unit === 'cents' && places > 2) {
    problems.push(
      `${valueColumn ?? 'The column'} has amounts with more than two decimal places, so they can't be in cents.`,
    );
    return { spec: resolved, candidates: [], problems, notes, rule };
  }

  const names = spellings(cellsOf(table, groupColumn));
  const key = spec.measure === 'count' ? 'count' : spec.unit === 'cents' ? 'total_cents' : 'total';
  const tolerance =
    spec.measure === 'sum' && spec.unit === 'as_written' && places > 0 ? 0.5 * 10 ** -places : 0;
  const decorated = valueColumn !== null && profileColumn(table, valueColumn).decorated;
  const hint =
    spec.measure === 'count'
      ? 'Give it as a whole number.'
      : spec.unit === 'cents'
        ? 'Give it in cents, as a whole number.'
        : decorated
          ? 'Write the number as plain digits, without currency signs or commas.'
          : 'Write the number as plain digits.';

  const measured = (rows: readonly Entry[]): number => {
    if (spec.measure === 'count') return rows.filter((entry) => entry.counted).length;
    const total = sumDecimals(
      rows.flatMap((entry) => (entry.amount === null ? [] : [entry.amount])),
    );
    if (spec.unit === 'cents')
      return Number(total.units * 10n ** BigInt(2 - Math.min(2, total.places)));
    return decimalToNumber(total);
  };

  const days =
    dateColumn === null
      ? []
      : [...entries.values()].flatMap((list) =>
          list.flatMap((e) => (e.day === null ? [] : [e.day])),
        );
  const first = days.reduce((least, day) => (day < least ? day : least), days[0] ?? '');
  const last = days.reduce((most, day) => (day > most ? day : most), days[0] ?? '');
  const span = days.length === 0 ? 0 : dayNumber(last) - dayNumber(first) + 1;
  if (dateColumn !== null && span < MIN_SPAN_DAYS) {
    problems.push(
      `The dates in ${dateColumn} cover ${span} days, too few to ask about ranges of dates.`,
    );
    return { spec: resolved, candidates: [], problems, notes, rule };
  }
  const lengths = RANGE_LENGTHS.filter((length) => length <= span);

  const candidates: Candidate[] = [];
  const add = (
    group: string,
    rows: readonly Entry[],
    range: { from: string; to: string } | null,
  ) => {
    const answer = measured(rows);
    const question = fillRequest(spec.request, {
      group: names.get(group) ?? group,
      ...(range === null ? {} : { from: range.from, to: range.to }),
    });
    candidates.push({
      // Ranges of one group never overlap, so two of them share no rows and are no near-duplicates.
      family: `total:${table.name}:${groupColumn}=${group}${range === null ? '' : `:${range.from}`}`,
      prompt: [
        range === null ? question : `${question} Both dates are included.`,
        hint,
        `End with: ANSWER: {"${key}": <number>}`,
      ].join('\n'),
      expected: {
        kind: 'answer',
        value: { [key]: answer },
        compare: { mode: 'number', tolerance },
      },
      answerKey: canonicalJson({ [key]: answer }),
      meta: { template: 'group_total', group: names.get(group) ?? group, ...(range ?? {}) },
    });
  };

  for (const [group, rows] of shuffle([...entries], random)) {
    if (candidates.length >= CANDIDATE_LIMIT) break;
    if (dateColumn === null) {
      add(group, rows, null);
      continue;
    }
    const dated = rows.filter((entry) => entry.day !== null);
    const taken: { from: string; to: string }[] = [];
    for (let attempt = 0; attempt < ATTEMPTS && taken.length < RANGES_PER_GROUP; attempt += 1) {
      const length = lengths[Math.floor(random() * lengths.length)] ?? MIN_SPAN_DAYS;
      const from = addDays(first, Math.floor(random() * (span - length + 1)));
      const to = addDays(from, length - 1);
      if (taken.some((range) => from <= range.to && to >= range.from)) continue;
      const inside = dated.filter((entry) => (entry.day ?? '') >= from && (entry.day ?? '') <= to);
      // A range that holds nothing, or all of the group's dated rows, tests no date reading.
      if (inside.length === 0 || inside.length === dated.length) continue;
      taken.push({ from, to });
      add(group, inside, { from, to });
    }
  }
  if (candidates.length === 0) {
    problems.push(
      dateColumn === null
        ? `${groupColumn} has no values in ${table.name}.`
        : `No group in ${table.name} has dates that a range of dates would split.`,
    );
  }
  return { spec: resolved, candidates, problems, notes, rule };
}
