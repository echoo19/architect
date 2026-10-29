import {
  branchLine,
  passageOrigin,
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

  it('names where a passage comes from in a line of text, with the question an answer was to', () => {
    expect(passageOrigin({ file: 'policy.md' })).toBe('policy.md');
    expect(passageOrigin({ file: 'answers' })).toBe('your answer');
    expect(passageOrigin({ file: 'answers', question: 'Does the discount apply to parts?' })).toBe(
      'your answer to "Does the discount apply to parts?"',
    );
  });

  it('says who read the policy and what rests on the rule, one rule or several', () => {
    expect(reviewIntro('Spark', 1)).toBe(
      'Spark turned your policy into this rule. Architect works out every expected answer from it, so what the agent is tested on is only as right as the rule.',
    );
    expect(reviewIntro('Spark', 2)).toContain('into these rules');
    expect(confirmLine('Spark', 1)).toContain("Training can't start until you confirm it.");
    expect(confirmLine('Spark', 2)).toContain('until you confirm them.');
  });

  it('says what changing the description keeps, and what it does not', () => {
    // Changing the description puts the words and the attached files back, and drafts again: the
    // conversation, with the answers in it, starts over.
    expect(confirmLine('Spark', 1)).toBe(
      "Check the passages, the rule and the examples against your policy. Training can't start until you confirm it. If it isn't right, change the description. Your words and files come back as you left them, and Spark may ask its questions again.",
    );
    expect(confirmLine('Spark Open', 2)).toContain('and Spark Open may ask its questions again.');
    expect(confirmLine('Spark', 2)).toContain("If they aren't right, change the description.");
    for (const count of [1, 2]) {
      expect(confirmLine('Spark', count)).not.toMatch(/describe the job again/i);
    }
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

  it('gives the reason in the same line when there is one reason, and only then', () => {
    const one = {
      ...DETAILS,
      cases: { total: 160, eligible: 134 },
      excluded: [
        { reason: 'parts_cost says N/A or a dash, which is not the same as empty', count: 26 },
      ],
    };
    expect(leftOutLine(one)).toBe(
      '26 of 160 rows left out: parts_cost says N/A or a dash, which is not the same as empty',
    );
    // Two reasons are too many for a line: the counts alone, and the reasons when it is opened.
    const two = {
      ...one,
      excluded: [
        { reason: 'parts_cost is empty or N/A', count: 20 },
        { reason: 'customer_id has no row in customers.csv', count: 6 },
      ],
    };
    expect(leftOutLine(two)).toBe('26 of 160 rows left out');
    // One row left out of one.
    expect(
      leftOutLine({
        ...DETAILS,
        cases: { total: 1, eligible: 0 },
        excluded: [{ reason: 'ticket_id is empty', count: 1 }],
      }),
    ).toBe('1 of 1 row left out: ticket_id is empty');
  });
});

describe('what the results say about a rule', () => {
  it('says the expected answers follow a rule the person confirmed, and are not certified', () => {
    expect(ruleScoreNote('Spark')).toBe(
      "Architect worked out every expected answer from the rule you confirmed, which is Spark's reading of your policy. So this score shows how often the agent agreed with that rule on tasks it had never seen. It can't show whether the rule itself is right for your business.",
    );
  });

  it('says whether teaching ran', () => {
    expect(teachingLine(0)).toBe(
      'Teaching did not run: the agent met the target on the check tasks before any round.',
    );
    expect(teachingLine(1)).toBe('Teaching ran for 1 round.');
    expect(teachingLine(4)).toBe('Teaching ran for 4 rounds.');
  });

  it('says where each side of a condition applied, and for how many rows it mattered', () => {
    const label = 'member (customers.csv) is yes';
    expect(branchLine({ label, cases: 40, changes: 40 })).toBe(
      'member (customers.csv) is yes: 40 rows, and the other side would give a different answer for all 40',
    );
    expect(branchLine({ label, cases: 1200, changes: 30 })).toBe(
      'member (customers.csv) is yes: 1,200 rows, and the other side would give a different answer for 30 of them',
    );
    expect(branchLine({ label, cases: 1, changes: 1 })).toBe(
      'member (customers.csv) is yes: 1 row, and the other side would give a different answer for it',
    );
    expect(branchLine({ label, cases: 3, changes: 0 })).toBe(
      'member (customers.csv) is yes: 3 rows, and the other side would give a different answer for none of them',
    );
    expect(branchLine({ label, cases: 0, changes: 0 })).toBe(
      'member (customers.csv) is yes: no rows',
    );
  });
});
