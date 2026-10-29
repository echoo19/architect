import {
  passageSource,
  ruleScoreNote,
  teachingLine,
  type RuleConfirmationState,
  type RuleDetails,
  type TaskPlan,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  confirmedOn,
  confirmLine,
  leftOutLine,
  reviewIntro,
  ruleTypesOf,
  trainingWait,
  waitLine,
  type PlanQuery,
} from '../../../src/renderer/src/flow/define/rule-words';

const DETAILS: RuleDetails = {
  version: 'db5fc3156380',
  statement: 'Start with labor. Add parts cost.',
  passages: [{ file: 'policy.md', passage: 'Labor is billed at $65 an hour.' }],
  conventions: [],
  cases: { total: 180, eligible: 118 },
  excluded: [],
  branches: [],
  flags: [],
  examples: [],
  uncovered: [],
};

const COUNTS = { calibration: 1, train: 2, dev: 3, test: 4 };

function plan(confirmation: TaskPlan['confirmation'], withRule = true): TaskPlan {
  return {
    source: 'generated',
    counts: COUNTS,
    types: [
      { id: 'email', label: 'Customer emails', counts: COUNTS, examples: [] },
      {
        id: 'cost',
        label: 'Ticket totals',
        counts: COUNTS,
        examples: [],
        ...(withRule ? { details: DETAILS } : {}),
      },
    ],
    unresolved: [],
    notes: [],
    ...(confirmation === undefined ? {} : { confirmation }),
  };
}

describe('the words that put a rule in front of the person', () => {
  it('finds the types that are rules among the others', () => {
    const rules = ruleTypesOf(plan({ state: 'needed', token: 'abc' }));
    expect(rules.map((type) => type.id)).toEqual(['cost']);
    expect(rules[0]?.details.version).toBe('db5fc3156380');
    expect(ruleTypesOf(plan(undefined, false))).toEqual([]);
  });

  const read = (confirmation: TaskPlan['confirmation'], withRule = true): PlanQuery => ({
    status: 'success',
    data: plan(confirmation, withRule),
  });

  it('holds training back until the rule is confirmed over these records, and only for a job with one', () => {
    expect(trainingWait(read(undefined, false))).toBeNull();
    expect(trainingWait(read({ state: 'needed', token: 'abc' }))).toBe('confirm');
    expect(trainingWait(read({ state: 'changed', token: 'abc', problem: 'It changed.' }))).toBe(
      'describe',
    );
    expect(
      trainingWait(
        read({ state: 'confirmed', token: 'abc', confirmedAt: '2026-10-29T10:00:00.000Z' }),
      ),
    ).toBeNull();
  });

  it('holds training back until the plan is known: while it is read, and when it could not be', () => {
    // Whether there is a rule to confirm is in the plan, so a plan nobody has read is not "no rule".
    expect(trainingWait({ status: 'loading', data: undefined })).toBe('reading');
    expect(trainingWait({ status: 'error', data: undefined })).toBe('unreadable');
    // Read before and being read again, or failed after being read: the earlier answer is not trusted.
    const confirmed = plan({
      state: 'confirmed',
      token: 'abc',
      confirmedAt: '2026-10-29T10:00:00.000Z',
    });
    expect(trainingWait({ status: 'loading', data: confirmed })).toBe('reading');
    expect(trainingWait({ status: 'error', data: confirmed })).toBe('unreadable');
    expect(trainingWait({ status: 'success', data: confirmed })).toBeNull();
  });

  it('says in the footer why training waits', () => {
    expect(waitLine(null)).toBeNull();
    expect(waitLine('reading')).toBe('Checking the job');
    expect(waitLine('unreadable')).toBe("Couldn't check the job");
    expect(waitLine('confirm')).toBe('Confirm the rule first');
    expect(waitLine('describe')).toBe('Describe the job again first');
  });

  it('names a passage by whose words it is, when it is the person who wrote it', () => {
    expect(passageSource('policy.md')).toBe('policy.md');
    expect(passageSource('answers')).toBe('your answer');
    expect(passageSource('description')).toBe('your description');
  });

  it('says who read the policy and what rests on the rule, one rule or several', () => {
    expect(reviewIntro('Spark', 1)).toBe(
      'Spark turned your policy into this rule. Architect works out every expected answer from it, so what the agent is tested on is only as right as the rule.',
    );
    expect(reviewIntro('Spark', 2)).toContain('into these rules');
    expect(confirmLine(1)).toContain("Training can't start until you confirm it.");
    expect(confirmLine(2)).toContain('until you confirm them.');
  });

  it('names the day it was confirmed and the rows that could not be worked out', () => {
    const state: RuleConfirmationState = {
      state: 'confirmed',
      token: 'abc',
      confirmedAt: '2026-10-29T12:00:00.000Z',
    };
    expect(confirmedOn(state)).toBe('Oct 29');
    expect(confirmedOn({ state: 'needed', token: 'abc' })).toBeNull();
    expect(leftOutLine(DETAILS)).toBe('62 of 180 rows left out');
    expect(leftOutLine({ ...DETAILS, cases: { total: 118, eligible: 118 } })).toBeNull();
  });
});

describe('what the results say about a rule', () => {
  it('says the expected answers follow a rule the person confirmed, and are not certified', () => {
    expect(ruleScoreNote('Spark')).toBe(
      "Expected answers were calculated by Architect using Spark's interpretation of your policy, which you confirmed. This score measures agreement with that rule on held-out cases; it does not independently establish that the rule matches your business policy.",
    );
  });

  it('says whether teaching ran', () => {
    expect(teachingLine(0)).toBe(
      'Teaching did not run: the student met the target on the check tasks before any round.',
    );
    expect(teachingLine(1)).toBe('Teaching ran for 1 round.');
    expect(teachingLine(4)).toBe('Teaching ran for 4 rounds.');
  });
});
