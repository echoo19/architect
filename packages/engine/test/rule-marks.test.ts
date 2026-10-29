import {
  DraftRecordSchema,
  RULE_LIMITS,
  RuleSpecSchema,
  type RuleNode,
  type RuleSpec,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { ruleSteps } from '../src/drafting/rule/steps';
import { wordsOf } from '../src/drafting/rule/words';
import { conventionsOf, ruleVersion, runRule } from '../src/drafting/templates/rule';
import {
  bikeExpression,
  bikeRule,
  bikeShop,
  bikeTables,
  col,
  editedBikeTables,
  PARTS,
  truth,
} from './support/rule-data';

/*
 * A mark such as N/A or a dash, in a column the rule adds up, leaves its row out. The person can
 * say that a mark means none, and then it counts as exactly zero (decision 061). It is a mark and a
 * column at a time: nothing else changes, and a rule that names no mark is what it always was.
 */

const bike = bikeShop({ offGrid: true });

// The bike shop's export writes a ticket with no parts as N/A or as an empty cell, by turns.
const without = bike.tickets
  .map((ticket, at) => ({ ticket, at }))
  .filter(({ ticket }) => ticket.partsCents === null);
const notApplicable = without.filter(({ at }) => at % 2 === 0);
const empty = without.filter(({ at }) => at % 2 === 1);
const members = new Map(bike.customers.map((customer) => [customer.id, customer.member]));

const named = (...tokens: string[]): Partial<RuleSpec> => ({
  placeholderMeansZero: [{ column: 'parts_cost', from: 'row', tokens }],
});
const emptyToo: Partial<RuleSpec> = { emptyMeansZero: [{ column: 'parts_cost', from: 'row' }] };

function run(extra: Partial<RuleSpec>, tables = bikeTables(bike)) {
  return runRule(bikeRule(extra), tables);
}

/** The shop's records after the parts cost of some tickets was written another way. */
function written(cells: readonly string[]) {
  return editedBikeTables(bike, (csv) => {
    for (const [index, cell] of cells.entries()) {
      const at = notApplicable[index]?.at;
      if (at === undefined) throw new Error('Not enough tickets with N/A.');
      (csv.tickets[at + 1] as string[])[PARTS] = cell;
    }
  });
}

const reasonsOf = (result: ReturnType<typeof run>): Map<string, number> =>
  new Map(result.outcome?.details.excluded.map((item) => [item.reason, item.count]));

describe('the field that names the marks that count as zero', () => {
  it('is optional, has no default, and is never an empty list', () => {
    const plain = RuleSpecSchema.parse(bikeRule());
    expect(plain).not.toHaveProperty('placeholderMeansZero');
    const spec = bikeRule({ placeholderMeansZero: [] });
    expect(RuleSpecSchema.safeParse(spec).success).toBe(false);
    expect(
      RuleSpecSchema.safeParse(
        bikeRule({ placeholderMeansZero: [{ column: 'x', from: 'row', tokens: [] }] }),
      ).success,
    ).toBe(false);
    const kept = RuleSpecSchema.parse(bikeRule(named('N/A', '-')));
    expect(kept.placeholderMeansZero).toEqual([
      { column: 'parts_cost', from: 'row', tokens: ['N/A', '-'] },
    ]);
  });

  it('holds only the forms the reading of cells knows as standing for nothing, never a number', () => {
    const accepted = (...tokens: string[]) =>
      RuleSpecSchema.safeParse(bikeRule(named(...tokens))).success;
    for (const token of [
      'N/A',
      'n/a',
      'n.a.',
      'NA',
      'nan',
      'null',
      'nil',
      'None',
      '-',
      '---',
      '?',
      '??',
      '\u{2013}',
      '\u{2014}',
      ' N/A ',
    ]) {
      expect(accepted(token), token).toBe(true);
    }
    for (const token of ['0', '12.50', 'maybe', ' ', '$', '1-2', 'N/A?', 'unknown', '--1', '-1']) {
      expect(accepted(token), token).toBe(false);
    }
    // A hyphen and a longer dash are two marks, so naming both is no repeat.
    expect(accepted('-', '--')).toBe(true);
    expect(accepted('-', '\u{2014}')).toBe(true);
  });

  it('names a mark once for a column, and a column once for a place it is read from', () => {
    const accepted = (...tokens: string[]) =>
      RuleSpecSchema.safeParse(bikeRule(named(...tokens))).success;
    expect(accepted('N/A', 'n/a')).toBe(false);
    expect(accepted('N/A', ' N/A ')).toBe(false);
    expect(accepted('-', '-')).toBe(false);
    const column = (name: string, from: 'row' | 'lookup', tokens: string[]) => ({
      column: name,
      from,
      tokens,
    });
    const twice = [column('parts_cost', 'row', ['N/A']), column('Parts_Cost', 'row', ['-'])];
    expect(RuleSpecSchema.safeParse(bikeRule({ placeholderMeansZero: twice })).success).toBe(false);
    // The same column of the cases' table and of the looked-up table are two columns.
    const apart = [column('fee', 'row', ['N/A']), column('fee', 'lookup', ['N/A'])];
    expect(RuleSpecSchema.safeParse(bikeRule({ placeholderMeansZero: apart })).success).toBe(true);
  });

  it('is bounded: so many columns, so many marks, so long a mark', () => {
    const tokens = (count: number) => Array.from({ length: count }, (_, i) => '-'.repeat(i + 1));
    const ok = RULE_LIMITS.maxPlaceholderMarks;
    expect(RuleSpecSchema.safeParse(bikeRule(named(...tokens(ok)))).success).toBe(true);
    expect(RuleSpecSchema.safeParse(bikeRule(named(...tokens(ok + 1)))).success).toBe(false);
    expect(
      RuleSpecSchema.safeParse(bikeRule(named('-'.repeat(RULE_LIMITS.maxMarkChars)))).success,
    ).toBe(true);
    expect(
      RuleSpecSchema.safeParse(bikeRule(named('-'.repeat(RULE_LIMITS.maxMarkChars + 1)))).success,
    ).toBe(false);
    const columns = Array.from({ length: RULE_LIMITS.maxEmptyZero + 1 }, (_, i) => ({
      column: `c${i}`,
      from: 'row' as const,
      tokens: ['N/A'],
    }));
    expect(RuleSpecSchema.safeParse(bikeRule({ placeholderMeansZero: columns })).success).toBe(
      false,
    );
  });

  it('is kept in the draft with the answer it came from, and an old draft without it still reads', () => {
    const base = {
      format: 1,
      source: 'generated',
      createdAt: '2026-10-29T12:00:00.000Z',
      seed: 1,
      teacher: { label: 'Spark', model: 'scripted' },
      cost: { calls: 1, inputTokens: 1, outputTokens: 1, usd: 0 },
      types: [{ id: 'cost', spec: bikeRule(named('N/A')) }],
      unresolved: [],
      notes: [],
    };
    const answer = {
      question: 'In tickets.csv, parts_cost sometimes says "N/A". Does "N/A" mean no parts cost?',
      answer: 'Count it as zero',
      placeholder: { table: 'tickets.csv', column: 'parts_cost', mark: 'N/A', means: 'zero' },
    };
    const parsed = DraftRecordSchema.parse({ ...base, answers: [answer] });
    expect(parsed.answers?.[0]?.placeholder).toEqual(answer.placeholder);
    const older = DraftRecordSchema.parse({
      ...base,
      types: [{ id: 'cost', spec: bikeRule() }],
      answers: [{ question: 'q', answer: 'a' }],
    });
    expect(older.answers?.[0]).toEqual({ question: 'q', answer: 'a' });
    expect(
      DraftRecordSchema.safeParse({
        ...base,
        answers: [{ ...answer, placeholder: { ...answer.placeholder, means: 'average' } }],
      }).success,
    ).toBe(false);
  });
});

describe('a mark the person said counts as zero', () => {
  it('counts exactly zero for the mark they named, and leaves every other blank out', () => {
    expect(notApplicable.length).toBeGreaterThan(5);
    expect(empty.length).toBeGreaterThan(5);
    const result = run(named('N/A'));
    expect(result.problems).toEqual([]);
    const worked = new Map(
      result.candidates.map((candidate) => [candidate.meta['key'], candidate]),
    );
    for (const { ticket } of notApplicable) {
      expect(worked.get(ticket.id)?.expected, ticket.id).toMatchObject({
        value: { total: truth(ticket, members.get(ticket.customerId) ?? false) / 100 },
      });
    }
    // An empty cell was not asked about, so it is what it was: the ticket has no answer.
    for (const { ticket } of empty) expect(worked.has(ticket.id), ticket.id).toBe(false);
    const details = result.outcome?.details;
    expect(details?.excluded).toEqual([
      {
        reason: 'parts_cost is empty',
        count: empty.length,
        example: expect.stringMatching(/^T-\d+$/),
      },
    ]);
    expect(details?.cases).toEqual({ total: 160, eligible: 160 - empty.length });
    expect(result.spec).toHaveProperty('placeholderMeansZero', [
      { column: 'parts_cost', from: 'row', tokens: ['N/A'] },
    ]);
  });

  it('reads a mark however it is cased, spaced or quoted, and the token however it is written', () => {
    const tables = written(['n/a', ' N/A ', 'N/a', '"N/A"']);
    for (const token of ['N/A', 'n/a', ' n/A ']) {
      const result = run(named(token), tables);
      expect(result.problems, token).toEqual([]);
      expect(result.candidates, token).toHaveLength(160 - empty.length);
    }
  });

  it('does not take one mark for another: a dash is not N/A, and NA is not N/A', () => {
    const dashes = ['-', '--', '\u2014', '\u2013', 'NA', 'none', '?'];
    const result = run(named('N/A'), written(dashes));
    expect(result.problems).toEqual([]);
    expect(reasonsOf(result)).toEqual(
      new Map([
        ['parts_cost is empty', empty.length],
        ['parts_cost says a dash ("-"), which is not counted as 0', 1],
        ['parts_cost says a dash ("--"), which is not counted as 0', 1],
        ['parts_cost says a dash ("\u2014"), which is not counted as 0', 1],
        ['parts_cost says a dash ("\u2013"), which is not counted as 0', 1],
        ['parts_cost says "na", which is not counted as 0', 1],
        ['parts_cost says "none", which is not counted as 0', 1],
        ['parts_cost says a question mark ("?"), which is not counted as 0', 1],
      ]),
    );
    const shown = result.outcome?.details.excluded.map((item) => item.example);
    const first = notApplicable[0]?.ticket.id;
    expect(shown).toContain(`- in ${first}`);
    // Not one of the seven is a task: they were not named.
    const asked = new Set(result.candidates.map((candidate) => candidate.meta['key']));
    for (const { ticket } of notApplicable.slice(0, dashes.length)) {
      expect(asked.has(ticket.id), ticket.id).toBe(false);
    }
    expect(result.candidates).toHaveLength(160 - empty.length - dashes.length);
  });

  it('says one reason for a mark however it is cased, since N/A and n/a are one mark', () => {
    const result = run(named('-'), written(['n/a', 'N/a', ' N/A ']));
    expect(reasonsOf(result)).toEqual(
      new Map([
        ['parts_cost is empty', empty.length],
        ['parts_cost says "n/a", which is not counted as 0', notApplicable.length],
      ]),
    );
    // The example is the cell as the file wrote it.
    const shown = result.outcome?.details.excluded.map((item) => item.example) ?? [];
    expect(shown.some((example) => /^(?:n\/a|N\/a|N\/A) in T-\d+$/.test(example ?? ''))).toBe(true);
  });

  it('counts every mark they named, and a column of marks alone says nothing of an empty cell', () => {
    const tables = written(['-', '\u2014']);
    const result = run(named('N/A', '-'), tables);
    expect(reasonsOf(result)).toEqual(
      new Map([
        ['parts_cost is empty', empty.length],
        ['parts_cost says a dash ("\u2014"), which is not counted as 0', 1],
      ]),
    );
    const flags = result.outcome?.details.flags ?? [];
    expect(flags).toContain(
      `${notApplicable.length - 2} of ${bike.tickets.length} rows have "N/A" in parts cost, which counts as 0, as you said.`,
    );
    expect(flags).toContain(
      `1 of ${bike.tickets.length} rows has a dash ("-") in parts cost, which counts as 0, as you said.`,
    );
    expect(result.notes).toEqual(
      expect.arrayContaining(flags.filter((flag) => /counts as 0/.test(flag))),
    );
  });

  it('works with an empty cell counted as zero too, and leaves out only the mark nobody named', () => {
    const none = run({ ...emptyToo, ...named('N/A') });
    expect(none.problems).toEqual([]);
    expect(none.outcome?.details.excluded).toEqual([]);
    expect(none.candidates).toHaveLength(160);
    const dash = run({ ...emptyToo, ...named('N/A') }, written(['-']));
    // The reason names the dash, not "N/A or a dash": N/A is what the person said counts.
    expect(reasonsOf(dash)).toEqual(
      new Map([['parts_cost says a dash ("-"), which is not counted as 0', 1]]),
    );
    // An empty cell and a mark are counted apart, each with its own rows.
    expect(none.outcome?.details.flags).toEqual(
      expect.arrayContaining([
        `${empty.length} of ${bike.tickets.length} rows have an empty parts cost, which counts as 0, as you said.`,
        `${notApplicable.length} of ${bike.tickets.length} rows have "N/A" in parts cost, which counts as 0, as you said.`,
      ]),
    );
  });

  it('leaves every rule that names no mark exactly as it was, whatever else it says', () => {
    const plain = run({});
    expect(reasonsOf(plain)).toEqual(new Map([['parts_cost is empty or N/A', 42]]));
    const zero = run(emptyToo);
    expect(reasonsOf(zero)).toEqual(
      new Map([['parts_cost says N/A or a dash, which is not the same as empty', 23]]),
    );
  });

  it('is a different rule from the one that names no mark, and from one that names another', () => {
    const plain = ruleVersion(bikeRule());
    const na = ruleVersion(bikeRule(named('N/A')));
    const dash = ruleVersion(bikeRule(named('-')));
    expect(new Set([plain, na, dash]).size).toBe(3);
    expect(ruleVersion(bikeRule({ ...emptyToo, ...named('N/A') }))).not.toBe(na);
    expect(run(named('N/A')).outcome?.details.version).toBe(ruleVersion(run(named('N/A')).spec));
    // The same questions asked with and without it are two rules: one question must not be
    // asked twice, and these are two answers.
    const asked = (extra: Partial<RuleSpec>) =>
      run(extra).candidates.map((candidate) => candidate.identity);
    const before = new Set(asked({}));
    expect(asked(named('N/A')).filter((identity) => before.has(identity))).toEqual([]);
  });

  it('writes the column as its table does, whatever the rule called it', () => {
    const result = run({
      placeholderMeansZero: [{ column: ' PARTS_COST ', from: 'row', tokens: ['N/A'] }],
    });
    expect(result.problems).toEqual([]);
    expect(result.spec).toHaveProperty('placeholderMeansZero', [
      { column: 'parts_cost', from: 'row', tokens: ['N/A'] },
    ]);
  });

  it('carries no field for it when the list came out empty, so the version is the plain one', () => {
    const odd = { ...bikeRule(), placeholderMeansZero: [] } as RuleSpec;
    const result = runRule(odd, bikeTables(bike));
    expect(result.spec).not.toHaveProperty('placeholderMeansZero');
    expect(result.outcome?.details.version).toBe(ruleVersion(bikeRule()));
  });
});

describe('what is refused when a rule names a mark', () => {
  const refused = (extra: Partial<RuleSpec>) => run(extra).problems;

  it('refuses a number, which is no mark, and a word that is neither N/A nor a dash', () => {
    expect(refused(named('0'))).toEqual([
      '"0" is a number. Only a mark that stands where a number should be, such as N/A or a dash, can be said to count as zero.',
    ]);
    expect(refused(named('12.50'))[0]).toContain('is a number');
    expect(refused(named('maybe'))).toEqual([
      '"maybe" is not a mark that stands where a number should be, such as N/A or a dash.',
    ]);
    expect(refused(named('$'))[0]).toContain('is not a mark');
    expect(refused(named(' '))[0]).toContain('is not a mark');
  });

  it('refuses a mark named twice, however it is written', () => {
    expect(refused(named('N/A', 'n/a'))).toEqual(['"n/a" is listed twice for parts_cost.']);
    expect(refused(named('-', '-'))).toEqual(['"-" is listed twice for parts_cost.']);
    expect(
      refused({
        placeholderMeansZero: [
          { column: 'parts_cost', from: 'row', tokens: ['N/A'] },
          { column: 'Parts_Cost', from: 'row', tokens: ['-'] },
        ],
      }),
    ).toEqual(['parts_cost is listed twice among the columns a mark counts as zero in.']);
  });

  it('refuses a column the rule does not add up, and one the table lacks', () => {
    const unread = run({
      placeholderMeansZero: [{ column: 'status', from: 'row', tokens: ['N/A'] }],
    });
    expect(unread.candidates).toEqual([]);
    expect(unread.problems).toEqual([
      'status is said to count as zero when it holds a mark, but the rule does not read it.',
    ]);
    const lacking = run({
      placeholderMeansZero: [{ column: 'discount', from: 'row', tokens: ['N/A'] }],
    });
    expect(lacking.problems[0]).toContain('The column "discount" isn\'t a column of tickets.csv.');
    // A column the rule reads only to tell a category is not one it adds up.
    const category = run({
      placeholderMeansZero: [{ column: 'member', from: 'lookup', tokens: ['N/A'] }],
    });
    expect(category.problems).toEqual([
      'member is said to count as zero when it holds a mark, but the rule does not read it.',
    ]);
  });

  it('refuses a column that holds words, whatever marks it is said to count', () => {
    const words: RuleNode = {
      op: 'round',
      arg: { op: 'add', args: [col('labor_hours'), col('status')] },
      increment: '1',
      mode: 'up',
    };
    const result = runRule(
      bikeRule({
        expression: words,
        categories: [],
        lookup: undefined,
        ...{ placeholderMeansZero: [{ column: 'status', from: 'row', tokens: ['N/A'] }] },
      }),
      bikeTables(bike),
    );
    expect(result.problems.join(' ')).toContain('status in tickets.csv holds words or dates');
  });

  it('tells the teacher no mark when no row can be worked out, and the person each one', () => {
    // Half the tickets have a dash for their parts cost, and the person named only N/A. The other
    // half have no labor hours. No row can be worked out.
    const tables = editedBikeTables(bike, (csv) => {
      for (let at = 1; at < csv.tickets.length; at += 1) {
        if (at % 2 === 0) (csv.tickets[at] as string[])[PARTS] = '-';
        else (csv.tickets[at] as string[])[PARTS - 1] = '';
      }
    });
    const result = run(named('N/A'), tables);
    expect(result.outcome).toBeNull();
    const told = result.problems.find((problem) => problem.startsWith('No row of tickets.csv'));
    expect(told).toContain('because parts_cost is empty or N/A');
    expect(told).toContain('because labor_hours is empty or N/A');
    expect(told).not.toContain('dash');
    expect(told).not.toContain('counted');
    const person = result.inFull?.get(told ?? '');
    expect(person).toContain('because parts_cost says a dash ("-"), which is not counted as 0');
    expect(person).toContain('because labor_hours is empty or N/A');
  });
});

describe('a mark in a column of the table a rule looks up', () => {
  const fees = (extra: Partial<RuleSpec>): RuleSpec => ({
    template: 'rule',
    table: 'tickets.csv',
    keyColumn: 'ticket_id',
    request: 'What is the bill for {key}?',
    answerName: 'bill',
    lookup: { table: 'customers.csv', keyColumn: 'customer_id', matchColumn: 'customer_id' },
    categories: [],
    expression: {
      op: 'round',
      increment: '0.5',
      mode: 'up',
      arg: { op: 'add', args: [col('labor_hours'), col('fee', 'lookup')] },
    },
    sources: [{ file: 'description', passage: 'Hours plus the customer fee.' }],
    ...extra,
  });
  const tables = () =>
    editedBikeTables(bike, (csv) => {
      (csv.customers[0] as string[]).push('fee');
      for (const [at, row] of csv.customers.slice(1).entries()) {
        row.push(at % 4 === 0 ? 'N/A' : String(at % 5));
      }
    });

  it('counts the mark as zero in that table, and says which file the column is in', () => {
    const spec = fees({
      placeholderMeansZero: [{ column: 'fee', from: 'lookup', tokens: ['N/A'] }],
    });
    const result = runRule(spec, tables());
    expect(result.problems).toEqual([]);
    const details = result.outcome?.details;
    expect(details?.excluded).toEqual([]);
    expect(details?.flags.join(' ')).toMatch(
      /\d+ rows have "N\/A" in fee \(customers\.csv\), which counts as 0, as you said\./,
    );
    expect(details?.conventions).toContain(
      '"N/A" in fee (customers.csv) counts as 0, as you said. Anything else in it that is not a number still leaves the row out.',
    );
    // Without it the same rule leaves those customers' tickets out.
    const without = runRule(fees({}), tables());
    expect(without.outcome?.details.excluded[0]?.reason).toBe(
      'fee (customers.csv) is empty or N/A',
    );
    expect(without.candidates.length).toBeLessThan(result.candidates.length);
  });

  it('keeps a mark named for the lookup apart from a column of the same name in the cases', () => {
    const spec = fees({ placeholderMeansZero: [{ column: 'fee', from: 'row', tokens: ['N/A'] }] });
    const result = runRule(spec, tables());
    expect(result.candidates).toEqual([]);
    expect(result.problems[0]).toContain('The column "fee" isn\'t a column of tickets.csv.');
    expect(result.problems).toContain(
      'fee is said to count as zero when it holds a mark, but the rule does not read it.',
    );
  });
});

describe('the rule in words, with a mark that counts as zero', () => {
  const both = bikeRule({ ...emptyToo, ...named('N/A', '-') });

  it('says it where the person reads the rule: the sentence, the steps and how numbers are read', () => {
    const result = runRule(both, bikeTables(bike));
    const details = result.outcome?.details;
    expect(details?.statement).toMatch(
      / An empty parts cost, "N\/A" or a dash \("-"\) counts as 0, as you said\.$/,
    );
    expect(details?.conventions[0]).toBe(
      'Numbers are read as written: a currency sign, thousands separators and brackets or a minus sign for a negative are understood. A cell that is empty, N/A or not a number leaves its row out, except where you said below that it counts as 0.',
    );
    expect(details?.conventions[1]).toBe(
      'An empty parts_cost, "N/A" or a dash ("-") counts as 0, as you said. Anything else in it that is not a number still leaves the row out.',
    );
    expect(conventionsOf(both)).toEqual(details?.conventions);
    const steps = ruleSteps(both.expression, wordsOf(both));
    expect(steps.map((step) => step.note)).toEqual([
      undefined,
      undefined,
      undefined,
      'An empty parts cost, "N/A" or a dash ("-") counts as 0, as you said.',
      undefined,
    ]);
  });

  it('says a mark alone without an empty cell, and a dash by its character', () => {
    const only = bikeRule(named('\u2014'));
    expect(runRule(only, bikeTables(bike)).outcome?.details.statement).toMatch(
      / A dash \("\u2014"\) in parts cost counts as 0, as you said\.$/,
    );
    expect(conventionsOf(only)[1]).toBe(
      'A dash ("\u2014") in parts_cost counts as 0, as you said. Anything else in it that is not a number still leaves the row out.',
    );
    expect(ruleSteps(only.expression, wordsOf(only))[3]?.note).toBe(
      'A dash ("\u2014") in parts cost counts as 0, as you said.',
    );
  });

  it('says the empty cell as it always did when no mark is named', () => {
    const empties = bikeRule(emptyToo);
    expect(conventionsOf(empties)[1]).toBe(
      'An empty parts_cost counts as 0, as you said. N/A or words in it still leave the row out.',
    );
    expect(ruleSteps(empties.expression, wordsOf(empties))[3]?.note).toBe(
      'An empty parts cost counts as 0, as you said.',
    );
  });

  it('is still the same rule: the expression is not touched', () => {
    expect(both.expression).toEqual(bikeExpression());
  });
});
