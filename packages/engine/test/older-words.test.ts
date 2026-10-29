import { readFileSync } from 'node:fs';
import type { DraftRecord, RuleConfirmation, RuleDetails } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { bindingOf, reportsOf, stateOf } from '../src/drafting/confirmation';
import { plainerCover, plainerSentence, readInPlainerWords } from '../src/drafting/older-words';
import { buildTaskPlan } from '../src/drafting/plan';
import { ruleSteps } from '../src/drafting/rule/steps';
import { wordsOf } from '../src/drafting/rule/words';
import { runRule, ruleVersion } from '../src/drafting/templates/rule';
import { writeJsonFile } from '../src/loop/files';
import { draftingWorld, type DraftingWorld } from './support/drafting-world';
import { bikeRule, bikeShop, bikeTables } from './support/rule-data';

const OLD_STATEMENT =
  'Start with (labor hours rounded up to a multiple of 0.5) times 65 times 0.9 when member (customers.csv) is yes. Add parts cost. The result is rounded to the nearest cent, halves going up.';
const NEW_STATEMENT = OLD_STATEMENT.replace('halves going up', 'half a cent rounds up');
const OLD_CONVENTION =
  'All arithmetic is exact until a rounding step. Up rounds to the larger multiple, down to the smaller, and half up to the nearest with a tie going up.';
const NEW_CONVENTION =
  'All arithmetic is exact until a rounding step. Up rounds to the larger multiple, down to the smaller, and to the nearest sends exactly halfway up.';
/** A rounding no record needed, as drafts said it before 0.3.1 and as 0.3.1 said it. */
const OLD_FLAG =
  'The rounding step (to the nearest cent, halves going up) never changed a value in your records, so no task shows it at work.';
const FLAG_031 =
  'The rounding step (to the nearest cent, half a cent rounds up) never changed a value in your records, so no task shows it at work.';
const NEW_FLAG = 'None of your records needed rounding to the nearest cent, so no task tests it.';

/** What the shop's rule is told as, step by step, whenever it was drafted. */
const STEPS = [
  { text: 'Round labor hours up to a multiple of 0.5.' },
  { text: 'Multiply by 65.' },
  { text: 'When member (customers.csv) is yes, multiply by 0.9.', files: ['customers.csv'] },
  { text: 'Add parts cost.' },
  { text: 'Round the result to the nearest cent; half a cent rounds up.' },
];

/**
 * A draft record as one made before the words were plainer stored it, with its rule's real spec.
 * `edge` is how it said what an example shows: before 0.3.1 "A rounding edge", then "Shows the
 * rounding" with what is rounded in brackets.
 */
function olderDraft(
  edge: 'A rounding edge' | 'Shows the rounding' = 'A rounding edge',
): DraftRecord {
  const spec = bikeRule();
  const made = runRule(spec, bikeTables(bikeShop({ offGrid: true })));
  if (made.outcome === null) throw new Error(made.problems.join(' '));
  const flag = edge === 'A rounding edge' ? OLD_FLAG : FLAG_031;
  const statement = edge === 'A rounding edge' ? OLD_STATEMENT : NEW_STATEMENT;
  const tie = edge === 'A rounding edge' ? 'halves going up' : 'half a cent rounds up';
  const details: RuleDetails = {
    ...made.outcome.details,
    statement,
    conventions: [OLD_CONVENTION],
    flags: [flag],
    examples: [
      {
        request: 'What does ticket T-2148 cost the customer?',
        inputs: [{ label: 'labor hours', value: '2.6' }],
        steps: [
          { text: 'Labor hours (2.6), rounded up to a multiple of 0.5', value: '3' },
          { text: `416.58, rounded to the nearest cent, ${tie}`, value: '416.58' },
        ],
        answer: '416.58',
        covers: [`${edge} (labor hours)`, 'member (customers.csv) is no'],
      },
      {
        request: 'Like T-2144, but with parts cost 0.005',
        inputs: [],
        steps: [{ text: `195.005, rounded to the nearest cent, ${tie}`, value: '195.01' }],
        answer: '195.01',
        covers: [`${edge} (the result)`],
        madeUp: true,
      },
    ],
    uncovered: [],
  };
  return {
    format: 1,
    source: 'generated',
    createdAt: '2026-10-29T10:00:00.000Z',
    seed: 1,
    teacher: { label: 'Muse Spark 1.3', model: 'muse-spark-1.3' },
    cost: { calls: 3, inputTokens: 100, outputTokens: 20, usd: 0.09 },
    types: [
      {
        id: 'cost',
        rule: `Work out total for each ticket_id of tickets.csv: ${statement}`,
        spec,
        details,
      },
    ],
    unresolved: [],
    notes: [flag],
  };
}

describe('words a rule was told in before they were plainer', () => {
  it('says a tie the way it is said now, for each unit, and leaves everything else alone', () => {
    expect(plainerSentence('rounded to the nearest cent, halves going up.')).toBe(
      'rounded to the nearest cent, half a cent rounds up.',
    );
    expect(plainerSentence('to the nearest whole number, halves going up')).toBe(
      'to the nearest whole number, exactly halfway rounds up',
    );
    expect(plainerSentence('to the nearest multiple of 0.05, halves going up')).toBe(
      'to the nearest multiple of 0.05, exactly halfway rounds up',
    );
    // The conventions, which say it in a sentence of their own.
    expect(
      plainerSentence(
        'All arithmetic is exact until a rounding step. Up rounds to the larger multiple, down to the smaller, and half up to the nearest with a tie going up.',
      ),
    ).toBe(
      'All arithmetic is exact until a rounding step. Up rounds to the larger multiple, down to the smaller, and to the nearest sends exactly halfway up.',
    );
    // Words already plain, and a rounding that is not to the nearest, are not touched.
    const plain = 'rounded to the nearest cent, half a cent rounds up';
    expect(plainerSentence(plain)).toBe(plain);
    const up = 'labor hours rounded up to a multiple of 0.5';
    expect(plainerSentence(up)).toBe(up);
  });

  it('says what an example shows in the words of now, from either older way of saying it', () => {
    for (const before of ['A rounding edge', 'Shows the rounding']) {
      expect(plainerCover(`${before} (labor hours)`)).toBe('Shows how the rule rounds labor hours');
      expect(plainerCover(`${before} (labor hours times 65)`)).toBe(
        'Shows how the rule rounds labor hours times 65',
      );
      expect(plainerCover(before)).toBe('Shows the rounding');
      // The answer is called what the rule calls it, where the older words said "the result".
      expect(plainerCover(`${before} (the result)`)).toBe('Shows how the rule rounds the result');
      expect(plainerCover(`${before} (the result)`, 'the total')).toBe(
        'Shows how the rule rounds the total',
      );
    }
    // The words of now, and the rest of what an example covers, are not touched.
    expect(plainerCover('Shows how the rule rounds labor hours')).toBe(
      'Shows how the rule rounds labor hours',
    );
    expect(plainerCover('member (customers.csv) is yes')).toBe('member (customers.csv) is yes');
    expect(plainerCover('An empty parts cost counts as 0')).toBe('An empty parts cost counts as 0');
  });

  it('says a rounding no record needed in the words of now, for any rounding step', () => {
    expect(plainerSentence(OLD_FLAG)).toBe(NEW_FLAG);
    expect(plainerSentence(FLAG_031)).toBe(NEW_FLAG);
    expect(
      plainerSentence(
        'The rounding step (up to a multiple of 0.5) never changed a value in your records, so no task shows it at work.',
      ),
    ).toBe('None of your records needed rounding up to a multiple of 0.5, so no task tests it.');
    expect(
      plainerSentence(
        'The rounding step (to the nearest whole number, exactly halfway rounds up) never changed a value in your records, so no task shows it at work.',
      ),
    ).toBe(
      'None of your records needed rounding to the nearest whole number, so no task tests it.',
    );
    expect(
      plainerSentence(
        'The rounding step (down to a whole cent) never changed a value in your records, so no task shows it at work.',
      ),
    ).toBe('None of your records needed rounding down to a whole cent, so no task tests it.');
    expect(plainerSentence(NEW_FLAG)).toBe(NEW_FLAG);
  });

  it.each(['A rounding edge', 'Shows the rounding'] as const)(
    'reads a draft made with "%s" in the plainer words, in everything a person is shown',
    (edge) => {
      const read = readInPlainerWords(olderDraft(edge));
      const [type] = read.types;
      expect(type?.details?.statement).toBe(NEW_STATEMENT);
      expect(type?.details?.conventions).toEqual([NEW_CONVENTION]);
      expect(type?.rule).toBe(`Work out total for each ticket_id of tickets.csv: ${NEW_STATEMENT}`);
      expect(type?.details?.flags).toEqual([NEW_FLAG]);
      expect(read.notes).toEqual([NEW_FLAG]);
      const [first, made] = type?.details?.examples ?? [];
      expect(first?.covers).toEqual([
        'Shows how the rule rounds labor hours',
        'member (customers.csv) is no',
      ]);
      expect(first?.steps[1]?.text).toBe(
        '416.58, rounded to the nearest cent, half a cent rounds up',
      );
      // The rule calls its answer "total", so the rounding of the answer is the total's.
      expect(made?.covers).toEqual(['Shows how the rule rounds the total']);
      expect(made?.madeUp).toBe(true);
      // What the person confirms and the numbers are as they were.
      expect(type?.details?.passages).toEqual(olderDraft(edge).types[0]?.details?.passages);
      expect(type?.details?.version).toBe(olderDraft(edge).types[0]?.details?.version);
      expect(first?.steps[1]?.value).toBe('416.58');
      // And a draft made now, in the words of now, reads as it is.
      expect(readInPlainerWords(read)).toEqual(read);
    },
  );

  it("is not part of a rule's version, so a rule confirmed over the older words is still confirmed", async () => {
    const old = olderDraft();
    const read = readInPlainerWords(old);
    const spec = old.types[0]?.spec;
    if (spec?.template !== 'rule') throw new Error('The draft has a rule.');
    // The version hashes the rule and how Architect reads and rounds, and no sentence about it.
    expect(ruleVersion(spec)).toBe(old.types[0]?.details?.version);
    expect(read.types[0]?.details?.version).toBe(ruleVersion(spec));

    const files = ['tickets.csv', 'customers.csv'];
    const bytes = (name: string) => Promise.resolve(new TextEncoder().encode(`${name} as it was`));
    const before = await bindingOf(old, files, bytes);
    const after = await bindingOf(read, files, bytes);
    expect(after).toEqual(before);

    // The person confirmed it over the older words, with the file hashes of the day.
    const saved: RuleConfirmation = {
      format: 1,
      confirmedAt: '2026-10-29T12:00:00.000Z',
      rules: before.rules,
      files: before.files,
    };
    expect(stateOf({ ...old, files: before.files }, saved, before)).toMatchObject({
      state: 'confirmed',
    });
    expect(stateOf({ ...read, files: before.files }, saved, after)).toMatchObject({
      state: 'confirmed',
      token: before.token,
    });
  });

  it('reaches the plan and the report, which are made from what the record is read as', () => {
    const read = readInPlainerWords(olderDraft());
    const job = { taskTypes: [{ id: 'cost', label: 'Ticket totals' }] };
    const plan = buildTaskPlan({
      job: job as Parameters<typeof buildTaskPlan>[0]['job'],
      draft: read,
      visible: { calibration: [], train: [], dev: [] },
      sealed: {},
    });
    expect(plan.types[0]?.details?.statement).toBe(NEW_STATEMENT);
    expect(plan.types[0]?.rule).toContain('half a cent rounds up');
    expect(plan.notes[0]).toBe(NEW_FLAG);
    const [report] = reportsOf(read, new Map([['cost', 'Ticket totals']]), {
      format: 1,
      confirmedAt: '2026-10-29T12:00:00.000Z',
      rules: [],
      files: [],
    });
    expect(report?.statement).toBe(NEW_STATEMENT);
    expect(report?.flags).toEqual([NEW_FLAG]);
  });
});

describe('a rule told as steps', () => {
  const unwritten = { taskTypes: [{ id: 'cost', label: 'Ticket totals' }] };
  const planOf = (draft: DraftRecord) =>
    buildTaskPlan({
      job: unwritten as Parameters<typeof buildTaskPlan>[0]['job'],
      draft,
      visible: { calibration: [], train: [], dev: [] },
      sealed: {},
    });
  const saved: RuleConfirmation = {
    format: 1,
    confirmedAt: '2026-10-29T12:00:00.000Z',
    rules: [],
    files: [],
  };

  it('is worked out for a draft made before it, which stored none', () => {
    for (const edge of ['A rounding edge', 'Shows the rounding'] as const) {
      const old = olderDraft(edge);
      expect(old.types[0]?.details?.steps).toBeUndefined();
      expect(planOf(readInPlainerWords(old)).types[0]?.details?.steps).toEqual(STEPS);
      const [report] = reportsOf(readInPlainerWords(old), new Map([['cost', 'Totals']]), saved);
      expect(report?.steps).toEqual(STEPS);
    }
    // And from the rule alone: the words the rule was drafted in have nothing to do with them.
    const spec = olderDraft().types[0]?.spec;
    if (spec?.template !== 'rule') throw new Error('The draft has a rule.');
    expect(ruleSteps(spec.expression, wordsOf(spec))).toEqual(STEPS);
  });

  it('is never stored with the draft, so the file a draft made before has is as it was', () => {
    const read = readInPlainerWords(olderDraft());
    expect(read.types[0]?.details?.steps).toBeUndefined();
    expect(Object.keys(read.types[0]?.details ?? {})).not.toContain('steps');
  });

  it("changes neither the rule's version nor what a person confirmed", async () => {
    const old = olderDraft();
    const spec = old.types[0]?.spec;
    if (spec?.template !== 'rule') throw new Error('The draft has a rule.');
    const files = ['tickets.csv', 'customers.csv'];
    const bytes = (name: string) => Promise.resolve(new TextEncoder().encode(`${name} as it was`));
    const before = await bindingOf(old, files, bytes);

    // The record as the plan and the report hold it, steps and all.
    const told = planOf(readInPlainerWords(old)).types[0]?.details;
    expect(told?.steps).toHaveLength(5);
    const withSteps: DraftRecord = {
      ...old,
      types: old.types.map((type) => ({ ...type, details: told })),
    };
    expect(told?.version).toBe(ruleVersion(spec));
    expect(await bindingOf(withSteps, files, bytes)).toEqual(before);

    // A rule confirmed before the steps existed is still the one confirmed.
    const confirmed: RuleConfirmation = {
      format: 1,
      confirmedAt: '2026-10-29T12:00:00.000Z',
      rules: before.rules,
      files: before.files,
    };
    expect(stateOf({ ...withSteps, files: before.files }, confirmed, before)).toMatchObject({
      state: 'confirmed',
      token: before.token,
    });
  });
});

describe('the job library', () => {
  let world: DraftingWorld | undefined;
  afterEach(() => world?.cleanup());

  it('reads an older draft in the plainer words and leaves its file as it was', async () => {
    world = draftingWorld();
    const file = world.paths.draftingFile('job_1');
    await writeJsonFile(file, olderDraft());
    const before = readFileSync(file, 'utf8');
    expect(before).toContain('halves going up');
    expect(before).toContain('A rounding edge');
    expect(before).toContain('never changed a value');

    const read = await world.jobs.drafting('job_1');
    expect(read?.types[0]?.details?.statement).toBe(NEW_STATEMENT);
    expect(read?.notes[0]).toBe(NEW_FLAG);
    expect(read?.types[0]?.details?.examples[0]?.covers[0]).toBe(
      'Shows how the rule rounds labor hours',
    );
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});
