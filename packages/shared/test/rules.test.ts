import { describe, expect, it } from 'vitest';
import { RuleDetailsSchema, RuleReportSchema, RuleStepSchema } from '../src';

const REPORT = {
  typeId: 'cost',
  label: 'Ticket totals',
  version: 'affdb6c549fa',
  statement: 'Add parts cost.',
  passages: [{ file: 'policy.md', passage: 'Labor is billed at $65 an hour.' }],
  conventions: [],
  cases: { total: 10, eligible: 10 },
  excluded: [],
  branches: [],
  flags: [],
  confirmedAt: '2026-10-29T12:00:00.000Z',
  expression: { op: 'col', column: 'parts_cost', from: 'row' },
};

describe('a rule told as steps', () => {
  it('is a sentence with the files it names and what the person said it rests on, both optional', () => {
    expect(RuleStepSchema.parse({ text: 'Multiply by 65.' })).toEqual({ text: 'Multiply by 65.' });
    expect(
      RuleStepSchema.parse({
        text: 'When member (customers.csv) is yes, multiply by 0.9.',
        files: ['customers.csv'],
        note: 'An empty parts cost counts as 0, as you said.',
      }),
    ).toMatchObject({ files: ['customers.csv'] });
  });

  it('is never an empty step or a file with no name', () => {
    expect(RuleStepSchema.safeParse({ text: '' }).success).toBe(false);
    expect(RuleStepSchema.safeParse({ text: 'Add parts cost.', files: [''] }).success).toBe(false);
    expect(RuleStepSchema.safeParse({ text: 'Add parts cost.', note: '' }).success).toBe(false);
  });

  it('is optional in a report, so a report made before the steps existed is read as it was', () => {
    const before = RuleReportSchema.parse(REPORT);
    expect(before.steps).toBeUndefined();
    const after = RuleReportSchema.parse({ ...REPORT, steps: [{ text: 'Add parts cost.' }] });
    expect(after.steps).toEqual([{ text: 'Add parts cost.' }]);
    // The sentence is still there for a screen that has no steps to show.
    expect(after.statement).toBe('Add parts cost.');
  });

  it('is optional in the details of a draft too, which never hold them', () => {
    const { typeId: _t, label: _l, confirmedAt: _c, expression: _e, ...details } = REPORT;
    expect(RuleDetailsSchema.safeParse({ ...details, examples: [], uncovered: [] }).success).toBe(
      true,
    );
    expect(
      RuleDetailsSchema.safeParse({
        ...details,
        examples: [],
        uncovered: [],
        steps: [{ text: '' }],
      }).success,
    ).toBe(false);
  });
});
