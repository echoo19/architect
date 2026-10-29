import { describe, expect, it } from 'vitest';
import type { RuleOutcome } from '../src/drafting/rule/outcome';
import { chooseExamples } from '../src/drafting/rule/examples';
import { runRule } from '../src/drafting/templates/rule';
import {
  bikeRule,
  bikeShop,
  bikeTables,
  editedBikeTables,
  PARTS,
  truth,
} from './support/rule-data';

function outcomeOf(offGrid: boolean): RuleOutcome {
  const bike = bikeShop({ offGrid });
  const result = runRule(bikeRule(), bikeTables(bike));
  if (result.outcome === null) throw new Error(result.problems.join(' '));
  return result.outcome;
}

const ids = (outcome: RuleOutcome, keys: readonly string[]): Map<string, string> =>
  new Map(keys.map((key) => [key, `task-${key}`]));

describe('the examples a rule is confirmed by', () => {
  it('shows a member, a non-member and a rounding edge, each with its working', () => {
    const outcome = outcomeOf(true);
    const visible = outcome.cases.slice(0, 50);
    const { examples, uncovered } = chooseExamples(
      outcome,
      visible,
      ids(
        outcome,
        visible.map((item) => item.key),
      ),
    );
    expect(uncovered).toEqual([]);
    // The records round hours to the half hour but never need a cent rounded: that edge is shown
    // with made-up numbers, after the real examples.
    const real = examples.filter((example) => example.madeUp !== true);
    expect(real.length).toBeGreaterThanOrEqual(3);
    expect(real.length).toBeLessThanOrEqual(4);
    expect(examples.length - real.length).toBe(1);
    const covers = real.flatMap((example) => example.covers);
    expect(covers).toContain('member (customers.csv) is yes');
    expect(covers).toContain('member (customers.csv) is no');
    expect(covers).toContain('Shows how the rule rounds labor hours');
    for (const example of real) {
      expect(example.taskId).toMatch(/^task-T-\d+$/);
      expect(example.request).toMatch(/^What does ticket T-\d+ cost the customer\?$/);
      expect(example.inputs.map((input) => input.label)).toEqual([
        'labor hours',
        'parts cost',
        'member (customers.csv)',
      ]);
      expect(example.steps.at(-1)?.text).toContain(
        'rounded to the nearest cent, half a cent rounds up',
      );
      expect(example.answer).toMatch(/^\$\d+\.\d\d$/);
    }
  });

  it('works each example out right, from the truth of the records', () => {
    const bike = bikeShop({ offGrid: true });
    const result = runRule(bikeRule(), bikeTables(bike));
    const outcome = result.outcome;
    if (outcome === null) throw new Error('No outcome.');
    const members = new Map(bike.customers.map((c) => [c.id, c.member]));
    const tickets = new Map(bike.tickets.map((t) => [t.id, t]));
    const visible = outcome.cases.slice(0, 40);
    const { examples } = chooseExamples(
      outcome,
      visible,
      ids(
        outcome,
        visible.map((v) => v.key),
      ),
    );
    for (const example of examples) {
      const key = /T-\d+/.exec(example.request)?.[0] ?? '';
      const ticket = tickets.get(key);
      if (ticket === undefined) throw new Error(`No ticket ${key}`);
      const cents = truth(ticket, members.get(ticket.customerId) ?? false);
      expect(example.answer).toBe(`$${(cents / 100).toFixed(2)}`);
      const last = example.steps.at(-1);
      expect(Number(last?.value)).toBe(cents / 100);
    }
  });

  it('chooses only from the cases it is given, whatever the others would show better', () => {
    const outcome = outcomeOf(true);
    // Only non-members are practice tasks: the member side has no example, and the rest is said.
    const nonMembers = outcome.cases.filter(
      (item) => item.categories.get('lookup:member') === 'no',
    );
    expect(nonMembers.length).toBeGreaterThan(10);
    const given = nonMembers.slice(0, 20);
    const { examples, uncovered } = chooseExamples(
      outcome,
      given,
      ids(
        outcome,
        given.map((g) => g.key),
      ),
    );
    const allowed = new Set(given.map((item) => `task-${item.key}`));
    for (const example of examples) {
      if (example.taskId !== undefined) expect(allowed.has(example.taskId)).toBe(true);
      expect(example.covers).not.toContain('member (customers.csv) is yes');
    }
    expect(uncovered).toContain('No practice task shows member (customers.csv) is yes.');
  });

  it('makes up numbers to show a rounding the records never need, and says so', () => {
    const outcome = outcomeOf(false);
    const visible = outcome.cases.slice(0, 40);
    const { examples, uncovered } = chooseExamples(
      outcome,
      visible,
      ids(
        outcome,
        visible.map((item) => item.key),
      ),
    );
    const made = examples.filter((example) => example.madeUp === true);
    expect(made).toHaveLength(2);
    const [hours, cents] = made;
    expect(hours?.taskId).toBeUndefined();
    expect(hours?.request).toMatch(/^Like T-\d+, but with labor hours \d+\.\d\d?$/);
    expect(hours?.covers[0]).toBe('Shows how the rule rounds labor hours');
    expect(hours?.steps[0]?.text).toMatch(
      /^Labor hours \([\d.]+\), rounded up to a multiple of 0.5$/,
    );
    // The hours the example made up bill as the next half hour up, a whole step for a hair.
    const billed = Number(/with labor hours ([\d.]+)/.exec(hours?.request ?? '')?.[1]);
    expect(billed * 2).not.toBe(Math.round(billed * 2));
    expect(Number(hours?.steps[0]?.value)).toBe(Math.ceil(billed * 2) / 2);
    // The cent is shown at the tie that the rule rounds up.
    expect(cents?.request).toMatch(/^Like T-\d+, but with parts cost \d+\.\d\d5$/);
    expect(cents?.covers[0]).toBe('Shows how the rule rounds the total');
    const before = cents?.steps.at(-2)?.value ?? '';
    const after = cents?.steps.at(-1)?.value ?? '';
    expect(before).toMatch(/^\d+\.\d\d5$/);
    expect(Number(after)).toBeCloseTo(Number(before) + 0.005, 8);
    expect(cents?.answer).toBe(`$${after}`);
    expect(uncovered.join(' ')).not.toContain('rounded');
    // None of the real examples pretends to be an edge.
    for (const example of examples.filter((item) => item.madeUp !== true)) {
      expect(example.covers.join(' ')).not.toContain('rounding');
    }
  });

  it('shows an empty cell counted as zero, working and all, and says when no practice task has one', () => {
    const bike = bikeShop({ offGrid: true });
    const result = runRule(
      bikeRule({ emptyMeansZero: [{ column: 'parts_cost', from: 'row' }] }),
      bikeTables(bike),
    );
    const outcome = result.outcome;
    if (outcome === null) throw new Error(result.problems.join(' '));
    const zeroed = outcome.cases.filter((item) => item.zeroed.size > 0);
    expect(zeroed.length).toBeGreaterThan(5);
    const members = new Map(bike.customers.map((c) => [c.id, c.member]));
    const tickets = new Map(bike.tickets.map((t) => [t.id, t]));

    const visible = outcome.cases.slice(0, 60);
    expect(visible.some((item) => item.zeroed.size > 0)).toBe(true);
    const { examples, uncovered } = chooseExamples(
      outcome,
      visible,
      ids(
        outcome,
        visible.map((item) => item.key),
      ),
    );
    expect(uncovered).toEqual([]);
    const shown = examples.find((example) =>
      example.covers.includes('An empty parts cost counts as 0'),
    );
    if (shown === undefined) throw new Error('No example shows an empty parts cost.');
    expect(shown.inputs.find((input) => input.label === 'parts cost')?.value).toBe(
      'empty (counted as 0)',
    );
    expect(shown.steps.map((step) => step.text).join(' | ')).toContain('parts cost (empty, so 0)');
    const key = /T-\d+/.exec(shown.request)?.[0] ?? '';
    const ticket = tickets.get(key);
    if (ticket === undefined) throw new Error(`No ticket ${key}`);
    expect(shown.answer).toBe(
      `$${(truth(ticket, members.get(ticket.customerId) ?? false) / 100).toFixed(2)}`,
    );

    // Practice tasks that have every cell filled show nothing of it, and that is said.
    const filled = outcome.cases.filter((item) => item.zeroed.size === 0).slice(0, 40);
    const none = chooseExamples(
      outcome,
      filled,
      ids(
        outcome,
        filled.map((item) => item.key),
      ),
    );
    expect(none.uncovered).toContain(
      'No practice task has an empty parts cost, so none shows it counted as 0.',
    );
    expect(none.examples.flatMap((example) => example.covers).join(' ')).not.toContain(
      'counts as 0',
    );
  });

  it('never gives the same case twice, and gives at most five', () => {
    const outcome = outcomeOf(true);
    const { examples } = chooseExamples(outcome, outcome.cases, new Map());
    const keys = examples.map((example) => example.request);
    expect(new Set(keys).size).toBe(keys.length);
    expect(examples.length).toBeLessThanOrEqual(5);
    expect(examples.every((example) => example.taskId === undefined)).toBe(true);
  });
});

describe('the examples of a rule that counts a mark as zero', () => {
  const bike = bikeShop({ offGrid: true });
  const members = new Map(bike.customers.map((c) => [c.id, c.member]));
  const tickets = new Map(bike.tickets.map((t) => [t.id, t]));
  /** Tickets whose export wrote N/A, which the tests below write another way. */
  const notApplicable = bike.tickets.filter(
    (ticket, at) => ticket.partsCents === null && at % 2 === 0,
  );
  const at = (ticket: (typeof bike.tickets)[number]) => bike.tickets.indexOf(ticket) + 1;

  function outcomeFor(
    tokens: string[],
    extra: Partial<Parameters<typeof bikeRule>[0]> = {},
    tables = bikeTables(bike),
  ): RuleOutcome {
    const result = runRule(
      bikeRule({ placeholderMeansZero: [{ column: 'parts_cost', from: 'row', tokens }], ...extra }),
      tables,
    );
    if (result.outcome === null) throw new Error(result.problems.join(' '));
    return result.outcome;
  }

  it('shows the mark as the file wrote it, counted as 0, with its working and the right answer', () => {
    const outcome = outcomeFor(['N/A']);
    const visible = outcome.cases.slice(0, 60);
    expect(visible.some((item) => item.zeroed.size > 0)).toBe(true);
    const { examples, uncovered } = chooseExamples(
      outcome,
      visible,
      ids(
        outcome,
        visible.map((item) => item.key),
      ),
    );
    expect(uncovered).toEqual([]);
    const shown = examples.find((example) =>
      example.covers.includes('"N/A" in parts cost counts as 0'),
    );
    if (shown === undefined) throw new Error('No example shows an N/A.');
    expect(shown.inputs.find((input) => input.label === 'parts cost')?.value).toBe(
      'N/A (counted as 0)',
    );
    expect(shown.steps.map((step) => step.text).join(' | ')).toContain('parts cost (N/A, so 0)');
    const key = /T-\d+/.exec(shown.request)?.[0] ?? '';
    const ticket = tickets.get(key);
    if (ticket === undefined) throw new Error(`No ticket ${key}`);
    expect(shown.answer).toBe(
      `$${(truth(ticket, members.get(ticket.customerId) ?? false) / 100).toFixed(2)}`,
    );
  });

  it('shows a dash by the character the file used, and an empty cell beside it as its own thing', () => {
    // Five tickets the export wrote N/A for are written with a dash, and the dash is named too.
    const dashed = new Set(notApplicable.slice(0, 5).map((ticket) => ticket.id));
    const tables = editedBikeTables(bike, (csv) => {
      for (const ticket of notApplicable.slice(0, 5)) {
        (csv.tickets[at(ticket)] as string[])[PARTS] = '\u2014';
      }
    });
    const outcome = outcomeFor(
      ['\u2014'],
      { emptyMeansZero: [{ column: 'parts_cost', from: 'row' }] },
      tables,
    );
    const given = outcome.cases.filter(
      (item) => dashed.has(item.key) || item.zeroed.get('row:parts_cost') === '',
    );
    expect(given.some((item) => dashed.has(item.key))).toBe(true);
    expect(given.some((item) => item.zeroed.get('row:parts_cost') === '')).toBe(true);
    const { examples } = chooseExamples(
      outcome,
      given,
      ids(
        outcome,
        given.map((item) => item.key),
      ),
    );
    const covers = examples.flatMap((example) => example.covers);
    expect(covers).toContain('An empty parts cost counts as 0');
    expect(covers).toContain('A dash ("\u2014") in parts cost counts as 0');
    const dash = examples.find((example) =>
      example.covers.includes('A dash ("\u2014") in parts cost counts as 0'),
    );
    expect(dash?.inputs.find((input) => input.label === 'parts cost')?.value).toBe(
      '\u2014 (counted as 0)',
    );
    expect(dash?.steps.map((step) => step.text).join(' | ')).toContain('parts cost (\u2014, so 0)');
  });

  it('says when no practice task has the mark, and shows none of it', () => {
    const outcome = outcomeFor(['N/A']);
    const filled = outcome.cases.filter((item) => item.zeroed.size === 0).slice(0, 40);
    const none = chooseExamples(
      outcome,
      filled,
      ids(
        outcome,
        filled.map((item) => item.key),
      ),
    );
    expect(none.uncovered).toContain(
      'No practice task has "N/A" in parts cost, so none shows it counted as 0.',
    );
    expect(none.examples.flatMap((example) => example.covers).join(' ')).not.toContain(
      'counts as 0',
    );
  });

  it('does not take a task that shows an empty cell for one that shows the mark', () => {
    const outcome = outcomeFor(['N/A'], {
      emptyMeansZero: [{ column: 'parts_cost', from: 'row' }],
    });
    const emptied = outcome.cases.filter((item) => item.zeroed.get('row:parts_cost') === '');
    expect(emptied.length).toBeGreaterThan(5);
    const none = chooseExamples(
      outcome,
      emptied.slice(0, 30),
      ids(
        outcome,
        emptied.map((item) => item.key),
      ),
    );
    expect(none.uncovered).toEqual([
      'No practice task has "N/A" in parts cost, so none shows it counted as 0.',
    ]);
  });
});
