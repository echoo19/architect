import {
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
  waitsForRule,
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

  it('holds training back until the rule is confirmed over these records, and only for a job with one', () => {
    expect(waitsForRule(undefined)).toBe(false);
    expect(waitsForRule(plan(undefined, false))).toBe(false);
    expect(waitsForRule(plan({ state: 'needed', token: 'abc' }))).toBe(true);
    expect(waitsForRule(plan({ state: 'changed', token: 'abc', problem: 'It changed.' }))).toBe(
      true,
    );
    expect(
      waitsForRule(
        plan({ state: 'confirmed', token: 'abc', confirmedAt: '2026-10-29T10:00:00.000Z' }),
      ),
    ).toBe(false);
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
