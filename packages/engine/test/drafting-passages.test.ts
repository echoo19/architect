import {
  RULE_LIMITS,
  RulePassageSchema,
  type DraftRecord,
  type RulePassage,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { questioned, withQuestions } from '../src/drafting/passages';
import { bikeRule } from './support/rule-data';

/*
 * An answer such as "No, labor only" can't be read without the question it answered, so the
 * passages a rule rests on carry it, found in what the draft kept of the conversation.
 */

const DISCOUNT = 'Does the 10% off for members also apply to the parts?';
const EMPTY = 'What parts amount should be used when a ticket lists no parts cost?';

type Answers = NonNullable<DraftRecord['answers']>;

const answers: Answers = [
  { question: DISCOUNT, answer: 'No, labor only' },
  {
    question: EMPTY,
    answer: 'Count it as zero',
    blank: { table: 'tickets.csv', column: 'parts_cost', from: 'row', means: 'zero' },
  },
];

const policy: RulePassage = {
  file: 'policy.md',
  passage: 'Members get 10% off labor, never off parts.',
};
const labor: RulePassage = { file: 'answers', passage: 'No, labor only' };
const zero: RulePassage = { file: 'answers', passage: 'Count it as zero' };

/** The rule over the tickets, with the customers looked up. */
const spec = bikeRule();

describe('the question beside an answer a rule rests on', () => {
  it('is the question each answer was given to, and a passage of the policy has none', () => {
    expect(withQuestions([policy, labor, zero], spec, answers)).toEqual([
      policy,
      { ...labor, question: DISCOUNT },
      { ...zero, question: EMPTY },
    ]);
  });

  it('is found when the words are only part of a longer answer, however they are cased', () => {
    const longer: Answers = [{ question: DISCOUNT, answer: 'No, LABOR  only, never the parts.' }];
    expect(withQuestions([{ file: 'answers', passage: 'labor only' }], spec, longer)).toEqual([
      { file: 'answers', passage: 'labor only', question: DISCOUNT },
    ]);
  });

  it('is left out when two answers to different questions hold the same words', () => {
    const same: Answers = [
      { question: DISCOUNT, answer: 'Yes' },
      { question: 'Do members also get the discount on Sundays?', answer: 'Yes' },
    ];
    expect(withQuestions([{ file: 'answers', passage: 'Yes' }], spec, same)).toEqual([
      { file: 'answers', passage: 'Yes' },
    ]);
  });

  it('is the one question when the same question was answered twice in the same words', () => {
    const twice: Answers = [
      { question: DISCOUNT, answer: 'No, labor only' },
      { question: DISCOUNT, answer: 'No, labor only' },
    ];
    expect(withQuestions([labor], spec, twice)).toEqual([{ ...labor, question: DISCOUNT }]);
  });

  it('is the one asked about a table the rule reads, not about another with the same answer', () => {
    const both: Answers = [
      {
        question: 'What should an empty amount on an invoice count as?',
        answer: 'Count it as zero',
        blank: { table: 'invoices.csv', column: 'amount', from: 'row', means: 'zero' },
      },
      ...answers,
    ];
    expect(withQuestions([zero], spec, both)).toEqual([{ ...zero, question: EMPTY }]);
    const invoices = { ...spec, table: 'invoices.csv' };
    expect(withQuestions([zero], invoices, both)).toEqual([
      { ...zero, question: 'What should an empty amount on an invoice count as?' },
    ]);
  });

  it('is found for a draft made before an answer named its table, which could be about any', () => {
    const old: Answers = [
      {
        question: EMPTY,
        answer: 'Count it as zero',
        blank: { column: 'parts_cost', from: 'row', means: 'zero' },
      },
    ];
    expect(withQuestions([zero], spec, old)).toEqual([{ ...zero, question: EMPTY }]);
  });

  it('is cut to a short line at a word, and still fits what a passage may carry', () => {
    const long =
      'Does the ten percent off for members also apply to the parts that a ticket lists? '.repeat(
        6,
      );
    const [found] = withQuestions([labor], spec, [{ question: long, answer: labor.passage }]);
    const question = found?.question ?? '';
    expect(question.length).toBeLessThanOrEqual(RULE_LIMITS.maxQuestionChars);
    expect(question.endsWith('...')).toBe(true);
    expect(long.startsWith(question.slice(0, -3))).toBe(true);
    // Cut at a word: what is left ends where a word ends, not in the middle of one.
    expect(long.charAt(question.length - 3)).toBe(' ');
    expect(RulePassageSchema.safeParse(found).success).toBe(true);
  });

  it('is not changed where a passage has one already, or where nothing was answered', () => {
    const named = { ...labor, question: 'Asked before.' };
    expect(withQuestions([named], spec, answers)).toEqual([named]);
    expect(withQuestions([labor], spec, undefined)).toEqual([labor]);
    expect(withQuestions([labor], spec, [])).toEqual([labor]);
    expect(
      withQuestions([{ file: 'answers', passage: 'Nobody said this' }], spec, answers),
    ).toEqual([{ file: 'answers', passage: 'Nobody said this' }]);
  });

  it('reads a draft whose passages have no question, as the drafts made before it do', () => {
    expect(RulePassageSchema.safeParse(labor).success).toBe(true);
  });

  it('is put into the details of a rule type, and only a rule type has them', () => {
    const details = {
      version: 'abc',
      statement: 'Start with labor.',
      passages: [policy, labor],
      conventions: [],
      cases: { total: 10, eligible: 10 },
      excluded: [],
      branches: [],
      flags: [],
      examples: [],
      uncovered: [],
    };
    expect(questioned({ id: 'cost', spec, details }, answers)?.passages).toEqual([
      policy,
      { ...labor, question: DISCOUNT },
    ]);
    expect(questioned({ id: 'cost', details }, answers)).toBe(details);
    expect(questioned({ id: 'cost', spec }, answers)).toBeUndefined();
  });
});
