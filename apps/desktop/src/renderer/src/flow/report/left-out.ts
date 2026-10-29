import type { RuleReport } from '@architect/shared';

const count = (value: number): string => value.toLocaleString('en-US');

const rows = (value: number): string => `${count(value)} ${value === 1 ? 'row' : 'rows'}`;

/** "a", "a and b", "a, b and c". */
function joined(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * What a rule left out of the tests, in plain words for the Results page: how many rows the tests
 * could use and why the others were left out, from what the report holds of the rule. Null for a
 * rule that left no row out. A report holds no table's name, so the sentence says "rows".
 */
export function leftOutNote(rule: RuleReport, several: boolean): string | null {
  const out = rule.cases.total - rule.cases.eligible;
  if (out <= 0) return null;
  const used = `${several ? `For ${rule.label}, the tests` : 'The tests'} could use ${count(rule.cases.eligible)} of the ${rows(rule.cases.total)}.`;
  const [only, ...others] = rule.excluded;
  if (only === undefined) return `${used} The other ${count(out)} were left out.`;
  const why =
    others.length === 0
      ? ` because ${only.reason}`
      : `: ${joined(rule.excluded.map((item) => `${count(item.count)} because ${item.reason}`))}`;
  return `${used} The other ${count(out)} ${out === 1 ? 'was' : 'were'} left out${why}.`;
}

/** The notes of every rule that left rows out, one sentence each. */
export function leftOutNotes(rules: readonly RuleReport[]): string[] {
  return rules.flatMap((rule) => {
    const note = leftOutNote(rule, rules.length > 1);
    return note === null ? [] : [note];
  });
}
