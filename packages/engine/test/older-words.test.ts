import { readFileSync } from 'node:fs';
import type { DraftRecord, RuleConfirmation, RuleDetails } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { bindingOf, reportsOf, stateOf } from '../src/drafting/confirmation';
import { plainerCover, plainerSentence, readInPlainerWords } from '../src/drafting/older-words';
import { buildTaskPlan } from '../src/drafting/plan';
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
const OLD_FLAG =
  'The rounding step (to the nearest cent, halves going up) never changed a value in your records, so no task shows it at work.';

/** A draft record as one made before the words were plainer stored it, with its rule's real spec. */
function olderDraft(): DraftRecord {
  const spec = bikeRule();
  const made = runRule(spec, bikeTables(bikeShop({ offGrid: true })));
  if (made.outcome === null) throw new Error(made.problems.join(' '));
  const details: RuleDetails = {
    ...made.outcome.details,
    statement: OLD_STATEMENT,
    conventions: [OLD_CONVENTION],
    flags: [OLD_FLAG],
    examples: [
      {
        request: 'What does ticket T-2148 cost the customer?',
        inputs: [{ label: 'labor hours', value: '2.6' }],
        steps: [
          { text: 'Labor hours (2.6), rounded up to a multiple of 0.5', value: '3' },
          { text: '416.58, rounded to the nearest cent, halves going up', value: '416.58' },
        ],
        answer: '416.58',
        covers: ['A rounding edge (labor hours)', 'member (customers.csv) is no'],
      },
      {
        request: 'Like T-2144, but with parts cost 0.005',
        inputs: [],
        steps: [{ text: '195.005, rounded to the nearest cent, halves going up', value: '195.01' }],
        answer: '195.01',
        covers: ['A rounding edge (the result)'],
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
        rule: `Work out total for each ticket_id of tickets.csv: ${OLD_STATEMENT}`,
        spec,
        details,
      },
    ],
    unresolved: [],
    notes: [OLD_FLAG],
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
    expect(plainerCover('A rounding edge (labor hours)')).toBe('Shows the rounding (labor hours)');
    expect(plainerCover('A rounding edge')).toBe('Shows the rounding');
    expect(plainerCover('member (customers.csv) is yes')).toBe('member (customers.csv) is yes');
  });

  it('reads a draft made before in the plainer words, in everything a person is shown', () => {
    const read = readInPlainerWords(olderDraft());
    const [type] = read.types;
    expect(type?.details?.statement).toBe(NEW_STATEMENT);
    expect(type?.details?.conventions).toEqual([NEW_CONVENTION]);
    expect(type?.rule).toBe(`Work out total for each ticket_id of tickets.csv: ${NEW_STATEMENT}`);
    expect(type?.details?.flags).toEqual([
      OLD_FLAG.replace('halves going up', 'half a cent rounds up'),
    ]);
    expect(read.notes).toEqual(type?.details?.flags);
    const [first, made] = type?.details?.examples ?? [];
    expect(first?.covers).toEqual([
      'Shows the rounding (labor hours)',
      'member (customers.csv) is no',
    ]);
    expect(first?.steps[1]?.text).toBe(
      '416.58, rounded to the nearest cent, half a cent rounds up',
    );
    expect(made?.covers).toEqual(['Shows the rounding (the result)']);
    expect(made?.madeUp).toBe(true);
    // What the person confirms and the numbers are as they were.
    expect(type?.details?.passages).toEqual(olderDraft().types[0]?.details?.passages);
    expect(type?.details?.version).toBe(olderDraft().types[0]?.details?.version);
    expect(first?.steps[1]?.value).toBe('416.58');
    // And a draft made now, in the words of now, reads as it is.
    expect(readInPlainerWords(read)).toEqual(read);
  });

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
    expect(plan.notes[0]).toContain('half a cent rounds up');
    const [report] = reportsOf(read, new Map([['cost', 'Ticket totals']]), {
      format: 1,
      confirmedAt: '2026-10-29T12:00:00.000Z',
      rules: [],
      files: [],
    });
    expect(report?.statement).toBe(NEW_STATEMENT);
    expect(report?.flags[0]).toContain('half a cent rounds up');
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

    const read = await world.jobs.drafting('job_1');
    expect(read?.types[0]?.details?.statement).toBe(NEW_STATEMENT);
    expect(read?.notes[0]).toContain('half a cent rounds up');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});
