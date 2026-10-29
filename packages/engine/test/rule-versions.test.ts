import { createHash } from 'node:crypto';
import { RuleSpecSchema, type DraftRecord, type RuleSpec, type Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { bindingOf } from '../src/drafting/confirmation';
import { generateTasks, seedFrom } from '../src/drafting/generate';
import { ruleVersion, runRule } from '../src/drafting/templates/rule';
import { bikeRule, bikeShop, bikeTables, col, num } from './support/rule-data';

/*
 * The version of a rule names what a person confirmed, and a confirmation binds to it. These are
 * the versions, the tokens and the words of rules as they stood before a placeholder such as N/A
 * could be counted as zero (decision 061). A rule that never mentions a placeholder has to keep
 * every one of them, byte for byte: the new field is optional, has no default, and is never added
 * to a rule that does not need it. A figure here changes only by deciding, on purpose, that every
 * rule already confirmed is a different rule.
 */

const bike = bikeShop({ offGrid: true });

const SIMPLE: RuleSpec = {
  template: 'rule',
  table: 'tickets.csv',
  keyColumn: 'ticket_id',
  request: 'What is the bill for {key}?',
  answerName: 'fee',
  categories: [],
  expression: {
    op: 'round',
    increment: '1',
    mode: 'up',
    arg: { op: 'mul', args: [col('labor_hours'), num('12')] },
  },
  sources: [{ file: 'description', passage: 'Twelve an hour.' }],
};

const ZERO_PARTS = { emptyMeansZero: [{ column: 'parts_cost', from: 'row' as const }] };

describe('the version of a rule that says nothing of a placeholder', () => {
  it('is what it was, for rules with and without an answer about an empty cell', () => {
    expect(ruleVersion(bikeRule())).toBe('db5fc3156380');
    expect(ruleVersion(bikeRule(ZERO_PARTS))).toBe('d549179221a2');
    expect(ruleVersion(bikeRule({ emptyMeansZero: [] }))).toBe('e24735a020a7');
    expect(ruleVersion(bikeRule({ familyColumn: 'customer_id' }))).toBe('4dc520df7616');
    expect(ruleVersion(bikeRule({ currency: 'CAD' }))).toBe('7e6d3663bd8c');
    expect(ruleVersion(SIMPLE)).toBe('80df9cee30a9');
  });

  it('is what it was once the spec has been read through its schema, which adds no key', () => {
    for (const spec of [
      bikeRule(),
      bikeRule(ZERO_PARTS),
      bikeRule({ emptyMeansZero: [] }),
      SIMPLE,
    ]) {
      const parsed = RuleSpecSchema.parse(spec);
      expect(Object.keys(parsed).sort()).toEqual(Object.keys(spec).sort());
      expect(parsed).not.toHaveProperty('placeholderMeansZero');
      expect(ruleVersion(parsed)).toBe(ruleVersion(spec));
    }
  });

  it('is what it was for the rule a run resolves, and the questions it asks stay the same', () => {
    const plain = runRule(bikeRule(), bikeTables(bike));
    expect(plain.problems).toEqual([]);
    expect(plain.outcome?.details.version).toBe('db5fc3156380');
    expect(plain.spec).not.toHaveProperty('placeholderMeansZero');
    const digest = (run: ReturnType<typeof runRule>) =>
      createHash('sha256')
        .update(run.candidates.map((candidate) => candidate.identity).join('\n'))
        .digest('hex')
        .slice(0, 16);
    expect(plain.candidates).toHaveLength(118);
    expect(digest(plain)).toBe('051c06935db48573');

    const zero = runRule(bikeRule(ZERO_PARTS), bikeTables(bike));
    expect(zero.problems).toEqual([]);
    expect(zero.outcome?.details.version).toBe('d549179221a2');
    expect(zero.spec).not.toHaveProperty('placeholderMeansZero');
    expect(zero.candidates).toHaveLength(137);
    expect(digest(zero)).toBe('8cf8a77acb6d6143');
  });

  it('says what it said about empty and N/A cells, and why rows were left out', () => {
    const plain = runRule(bikeRule(), bikeTables(bike)).outcome?.details;
    expect(plain?.conventions[0]).toBe(
      'Numbers are read as written: a currency sign, thousands separators and brackets or a minus sign for a negative are understood. A cell that is empty, N/A or not a number leaves its row out; it is never counted as zero.',
    );
    expect(plain?.excluded).toEqual([
      { reason: 'parts_cost is empty or N/A', count: 42, example: 'T-2001' },
    ]);
    expect(plain?.flags).toEqual([
      'None of your records needed rounding to the nearest cent, so no task tests it.',
    ]);
    expect(plain?.statement).toBe(
      'Start with (labor hours rounded up to a multiple of 0.5) times 65 times 0.9 when member (customers.csv) is yes. Add parts cost. The result is rounded to the nearest cent, half a cent rounds up.',
    );

    const zero = runRule(bikeRule(ZERO_PARTS), bikeTables(bike)).outcome?.details;
    expect(zero?.conventions.slice(0, 2)).toEqual([
      'Numbers are read as written: a currency sign, thousands separators and brackets or a minus sign for a negative are understood. A cell that is N/A or not a number leaves its row out. Nothing is counted as zero unless you said so.',
      'An empty parts_cost counts as 0, as you said. N/A or words in it still leave the row out.',
    ]);
    expect(zero?.excluded).toEqual([
      {
        reason: 'parts_cost says N/A or a dash, which is not the same as empty',
        count: 23,
        example: 'N/A in T-2001',
      },
    ]);
    expect(zero?.flags).toEqual([
      'None of your records needed rounding to the nearest cent, so no task tests it.',
      '19 rows have an empty parts cost, which counts as 0, as you said.',
    ]);
    expect(zero?.statement).toBe(
      'Start with (labor hours rounded up to a multiple of 0.5) times 65 times 0.9 when member (customers.csv) is yes. Add parts cost. The result is rounded to the nearest cent, half a cent rounds up. An empty parts cost counts as 0, as you said.',
    );
  });
});

describe('the tasks of a rule that says nothing of a placeholder', () => {
  const tasksOf = (spec: RuleSpec) =>
    generateTasks(
      [{ id: 'cost', label: 'Ticket totals', description: '', spec }],
      bikeTables(bike),
      11,
    );
  const digestOf = (tasks: readonly Task[]) =>
    createHash('sha256')
      .update(
        tasks
          .map((task) => JSON.stringify([task.id, task.family, task.prompt, task.expected]))
          .join('\n'),
      )
      .digest('hex')
      .slice(0, 16);

  it('are the tasks they were: the same requests, families and answers, from the same seed', () => {
    const plain = tasksOf(bikeRule());
    expect(plain.tasks).toHaveLength(118);
    expect(digestOf(plain.tasks)).toBe('bb99f6f0bac610ca');
    const zero = tasksOf(bikeRule(ZERO_PARTS));
    expect(zero.tasks).toHaveLength(120);
    expect(digestOf(zero.tasks)).toBe('cee3b8fcba4bdb44');
    // The seed the requests are chosen with follows from the spec as it is written to the draft.
    const seedOf = (made: ReturnType<typeof tasksOf>) =>
      seedFrom(['x', JSON.stringify(['cost', made.types[0]?.spec])]);
    expect(seedOf(plain)).toBe(912068193);
    expect(seedOf(zero)).toBe(964168016);
  });
});

describe('the confirmation token of a rule that says nothing of a placeholder', () => {
  const draftOf = (spec: RuleSpec): DraftRecord => ({
    format: 1,
    source: 'generated',
    createdAt: '2026-10-29T12:00:00.000Z',
    seed: 1,
    teacher: { label: 'Spark', model: 'scripted' },
    cost: { calls: 1, inputTokens: 1, outputTokens: 1, usd: 0 },
    types: [{ id: 'cost', spec }],
    unresolved: [],
    notes: [],
  });
  const bytes = new Map<string, Uint8Array>([
    ['tickets.csv', Buffer.from(bike.ticketsCsv)],
    ['customers.csv', Buffer.from(bike.customersCsv)],
  ]);
  const bind = (spec: RuleSpec) =>
    bindingOf(
      draftOf(spec),
      ['customers.csv', 'tickets.csv'],
      async (name) => bytes.get(name) ?? null,
    );

  it('is what it was, so a rule confirmed before still reads as confirmed', async () => {
    expect((await bind(bikeRule())).token).toBe('4185966d7e7a4e54');
    expect((await bind(bikeRule(ZERO_PARTS))).token).toBe('8eb3c1b3bd0b7113');
    expect((await bind(bikeRule({ emptyMeansZero: [] }))).token).toBe('7a8189d39a59ca67');
    const binding = await bind(bikeRule());
    expect(binding.rules).toEqual([{ typeId: 'cost', version: 'db5fc3156380' }]);
    expect(binding.files).toEqual([
      {
        name: 'customers.csv',
        sha256: '3c3f44bbba9cc8afcc50e0afbf2987187c4b657c3ebd15c9d1f1d11fbb3cd85e',
      },
      {
        name: 'tickets.csv',
        sha256: '966de9a8f97addc8fcf6b2a869c24444951853a2a33c3a79696d154a4a0f3d13',
      },
    ]);
  });
});
