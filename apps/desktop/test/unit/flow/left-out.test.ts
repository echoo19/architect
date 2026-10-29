import type { RuleReport } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { leftOutNote, leftOutNotes } from '../../../src/renderer/src/flow/report/left-out';
import { shortDate } from '../../../src/renderer/src/flow/format';

function rule(overrides: Partial<RuleReport> = {}): RuleReport {
  return {
    typeId: 'cost',
    label: 'Ticket totals',
    version: 'affdb6c549fa',
    statement: 'Add parts cost.',
    passages: [{ file: 'policy.md', passage: 'Labor is billed at $65 an hour.' }],
    conventions: [],
    cases: { total: 160, eligible: 108 },
    excluded: [{ reason: 'parts_cost is empty or N/A', count: 52, example: 'T-2001' }],
    branches: [],
    flags: [],
    confirmedAt: '2026-10-29T12:00:00.000Z',
    expression: { op: 'col', column: 'parts_cost', from: 'row' },
    ...overrides,
  };
}

describe('what a rule left out of the tests, said under the score', () => {
  it('says how many rows the tests could use and why the other rows were left out', () => {
    expect(leftOutNote(rule(), false)).toBe(
      'The tests could use 108 of the 160 rows. The other 52 were left out because parts_cost is empty or N/A.',
    );
  });

  it('gives each reason its count when there is more than one', () => {
    const several = rule({
      cases: { total: 1200, eligible: 1100 },
      excluded: [
        { reason: 'parts_cost is empty or N/A', count: 60 },
        { reason: 'customer_id has no row in customers.csv', count: 30 },
        { reason: 'the answer comes out below zero', count: 10 },
      ],
    });
    expect(leftOutNote(several, false)).toBe(
      'The tests could use 1,100 of the 1,200 rows. The other 100 were left out: 60 because parts_cost is empty or N/A, 30 because customer_id has no row in customers.csv and 10 because the answer comes out below zero.',
    );
    const two = rule({
      excluded: [
        { reason: 'parts_cost is empty or N/A', count: 40 },
        { reason: 'the answer comes out below zero', count: 12 },
      ],
    });
    expect(leftOutNote(two, false)).toContain(
      'were left out: 40 because parts_cost is empty or N/A and 12 because the answer comes out below zero.',
    );
  });

  it('says one row in the singular', () => {
    const one = rule({
      cases: { total: 30, eligible: 29 },
      excluded: [{ reason: 'ticket_id is empty', count: 1 }],
    });
    expect(leftOutNote(one, false)).toBe(
      'The tests could use 29 of the 30 rows. The other 1 was left out because ticket_id is empty.',
    );
  });

  it('says nothing for a rule that left no row out', () => {
    const none = rule({ cases: { total: 160, eligible: 160 }, excluded: [] });
    expect(leftOutNote(none, false)).toBeNull();
    expect(leftOutNotes([none])).toEqual([]);
  });

  it('does not make up a reason the report does not hold', () => {
    const unsaid = rule({ excluded: [] });
    expect(leftOutNote(unsaid, false)).toBe(
      'The tests could use 108 of the 160 rows. The other 52 were left out.',
    );
    const one = rule({ cases: { total: 30, eligible: 29 }, excluded: [] });
    expect(leftOutNote(one, false)).toBe(
      'The tests could use 29 of the 30 rows. The other 1 was left out.',
    );
  });

  it('names the rule when a job has several, and not when it has one', () => {
    const other = rule({ typeId: 'fees', label: 'Late fees' });
    expect(leftOutNotes([rule()])[0]).toMatch(/^The tests could use/);
    const notes = leftOutNotes([rule(), other]);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/^For Ticket totals, the tests could use 108 of the 160 rows\./);
    expect(notes[1]).toMatch(/^For Late fees, the tests could use/);
  });

  it('keeps to the words a person is shown: no dashes, no curly quotes', () => {
    expect(leftOutNotes([rule(), rule({ label: 'Fees' })]).join(' ')).not.toMatch(/[–—‘’“”]/);
  });
});

describe('a date the way the flow says one', () => {
  it('is the month and the day, as the confirmed rule says it on Define', () => {
    expect(shortDate('2026-10-29T12:00:00.000Z')).toBe('Oct 29');
    expect(shortDate('2026-01-05T12:00:00.000Z')).toBe('Jan 5');
  });

  it('is nothing for text that is no date', () => {
    expect(shortDate('yesterday')).toBeNull();
    expect(shortDate('')).toBeNull();
  });
});
