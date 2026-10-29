import { RULE_LIMITS, RuleNodeSchema, type RuleNode } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  checkExpression,
  depthOf,
  evaluate,
  refKey,
  sizeOf,
  type CaseInputs,
} from '../src/drafting/rule/expression';
import * as q from '../src/drafting/rule/rational';
import { roundingText, statementOf, stepsOf } from '../src/drafting/rule/words';
import { bikeExpression, col, num } from './support/rule-data';

const exact = (text: string): q.Q => {
  const value = q.fromText(text);
  if (value === null) throw new Error(`Not a number: ${text}`);
  return value;
};

/** Inputs from plain tables of numbers and words. */
function inputs(
  numbers: Record<string, string>,
  categories: Record<string, string> = {},
): CaseInputs {
  return {
    number: (ref) => exact(numbers[refKey(ref)] ?? '0'),
    category: (ref) => categories[refKey(ref)] ?? '',
  };
}

const text = (value: q.Q): string => q.toText(value, 8).text;

describe('exact arithmetic', () => {
  it('adds tenths without the error a floating-point number makes', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    const sum = q.add(exact('0.1'), exact('0.2'));
    expect(q.equal(sum, exact('0.3'))).toBe(true);
    expect(text(sum)).toBe('0.3');
    expect(text(q.mul(exact('1.1'), exact('1.1')))).toBe('1.21');
    expect(text(q.sub(exact('0.3'), exact('0.1')))).toBe('0.2');
  });

  it('divides by a literal without losing the remainder until a rounding says so', () => {
    const third = q.div(exact('1'), exact('3'));
    expect(q.equal(q.mul(third, exact('3')), exact('1'))).toBe(true);
    expect(q.toText(third, 6)).toEqual({ text: '0.333333', exact: false });
    expect(q.toText(exact('12.5'), 6)).toEqual({ text: '12.5', exact: true });
    expect(text(q.roundTo(third, exact('0.01'), 'half_up'))).toBe('0.33');
  });

  it('reads and writes numbers with no digit lost', () => {
    expect(q.fromText('.5')).toBeNull();
    expect(q.fromText('1e3')).toBeNull();
    expect(text(exact('-12.345'))).toBe('-12.345');
    expect(text(exact('0.00000001'))).toBe('0.00000001');
    expect(text(exact('123456789012.12345678'))).toBe('123456789012.12345678');
    expect(q.toText(exact('-0.001'), 2).text).toBe('0');
  });
});

describe('rounding to an increment', () => {
  const rounded = (value: string, step: string, mode: 'up' | 'down' | 'half_up'): string =>
    text(q.roundTo(exact(value), exact(step), mode));

  it('rounds up to the next multiple, and leaves a multiple alone', () => {
    expect(rounded('2.1', '0.5', 'up')).toBe('2.5');
    expect(rounded('2.5', '0.5', 'up')).toBe('2.5');
    expect(rounded('2.51', '0.5', 'up')).toBe('3');
    expect(rounded('0.001', '0.01', 'up')).toBe('0.01');
    expect(rounded('7', '5', 'up')).toBe('10');
  });

  it('rounds down to the multiple below, and leaves a multiple alone', () => {
    expect(rounded('2.49', '0.5', 'down')).toBe('2');
    expect(rounded('2.5', '0.5', 'down')).toBe('2.5');
    expect(rounded('0.019', '0.01', 'down')).toBe('0.01');
    expect(rounded('7', '5', 'down')).toBe('5');
  });

  it('rounds to the nearest multiple with a tie going up', () => {
    expect(rounded('2.24', '0.5', 'half_up')).toBe('2');
    expect(rounded('2.25', '0.5', 'half_up')).toBe('2.5');
    expect(rounded('2.26', '0.5', 'half_up')).toBe('2.5');
    expect(rounded('27.625', '0.01', 'half_up')).toBe('27.63');
    expect(rounded('27.624', '0.01', 'half_up')).toBe('27.62');
    expect(rounded('12.5', '1', 'half_up')).toBe('13');
  });

  it('keeps the words the same for a number below zero: up is toward the larger', () => {
    expect(rounded('-2.1', '0.5', 'up')).toBe('-2');
    expect(rounded('-2.1', '0.5', 'down')).toBe('-2.5');
    expect(rounded('-2.25', '0.5', 'half_up')).toBe('-2');
    expect(rounded('-2.26', '0.5', 'half_up')).toBe('-2.5');
  });

  it('says in plain words what a rounding step does', () => {
    expect(roundingText('up', '0.5', undefined)).toBe('up to a multiple of 0.5');
    expect(roundingText('down', '0.50', undefined)).toBe('down to a multiple of 0.5');
    expect(roundingText('half_up', '0.01', 'USD')).toBe(
      'to the nearest cent, half a cent rounds up',
    );
    expect(roundingText('up', '0.01', 'USD')).toBe('up to a whole cent');
    expect(roundingText('half_up', '1', undefined)).toBe(
      'to the nearest whole number, exactly halfway rounds up',
    );
    expect(roundingText('half_up', '0.05', 'USD')).toBe(
      'to the nearest multiple of 0.05, exactly halfway rounds up',
    );
  });
});

describe('evaluating an expression', () => {
  const lookup = (name: string) => ({ column: name, from: 'lookup' as const });

  it('works the bike shop rule out for a member and for a non-member, step by step', () => {
    const expression = bikeExpression();
    const base = { 'row:labor_hours': '2.2', 'row:parts_cost': '23.5' };
    const member = evaluate(expression, inputs(base, { [refKey(lookup('member'))]: 'yes' }));
    // 2.2 hours bill as 2.5; 2.5 x 65 x 0.9 = 146.25; plus 23.5 parts.
    expect(text(member.value)).toBe('169.75');
    const other = evaluate(expression, inputs(base, { [refKey(lookup('member'))]: 'no' }));
    // 2.5 x 65 = 162.5, plus 23.5.
    expect(text(other.value)).toBe('186');
  });

  it('writes the working of a case as plain steps, only down the side that applied', () => {
    const words = {
      lookupTable: 'customers.csv',
      currency: 'USD',
      categories: [{ column: 'member', from: 'lookup' as const, values: ['yes', 'no'] }],
    };
    const base = { 'row:labor_hours': '2.2', 'row:parts_cost': '23.5' };
    const member = evaluate(bikeExpression(), inputs(base, { [refKey(lookup('member'))]: 'yes' }));
    expect(stepsOf(member, words)).toEqual([
      { text: 'Labor hours (2.2), rounded up to a multiple of 0.5', value: '2.5' },
      { text: '2.5 times 65 times 0.9', value: '146.25' },
      { text: 'Member (customers.csv) is yes, so use 146.25', value: '146.25' },
      { text: '146.25 plus parts cost (23.5)', value: '169.75' },
      { text: '169.75, rounded to the nearest cent, half a cent rounds up', value: '169.75' },
    ]);
    const other = evaluate(bikeExpression(), inputs(base, { [refKey(lookup('member'))]: 'no' }));
    const steps = stepsOf(other, words);
    expect(steps.map((step) => step.text)).toContain('Member (customers.csv) is no, so use 162.5');
    expect(steps.map((step) => step.text)).not.toContain('2.5 times 65 times 0.9');
  });

  it('states the rule in words from the expression alone', () => {
    const words = {
      lookupTable: 'customers.csv',
      currency: 'USD',
      categories: [{ column: 'member', from: 'lookup' as const, values: ['yes', 'no'] }],
    };
    expect(statementOf(bikeExpression(), words)).toBe(
      'Start with (labor hours rounded up to a multiple of 0.5) times 65 times 0.9 when member (customers.csv) is yes. Add parts cost. The result is rounded to the nearest cent, half a cent rounds up.',
    );
  });

  it('compares a number with a threshold, and picks the smaller or the larger', () => {
    const overtime: RuleNode = {
      op: 'round',
      increment: '0.01',
      mode: 'half_up',
      arg: {
        op: 'if',
        when: { test: 'gt', arg: col('hours'), than: '8' },
        then: {
          op: 'add',
          args: [
            { op: 'mul', args: [num('8'), col('rate')] },
            {
              op: 'mul',
              args: [{ op: 'sub', args: [col('hours'), num('8')] }, col('rate'), num('1.5')],
            },
          ],
        },
        else: { op: 'mul', args: [col('hours'), col('rate')] },
      },
    };
    const worked = (hours: string) =>
      text(evaluate(overtime, inputs({ 'row:hours': hours, 'row:rate': '20' })).value);
    expect(worked('8')).toBe('160');
    expect(worked('8.5')).toBe('175');
    expect(worked('10')).toBe('220');
    expect(worked('3.25')).toBe('65');

    const capped: RuleNode = {
      op: 'round',
      increment: '1',
      mode: 'half_up',
      arg: { op: 'min', args: [{ op: 'div', arg: col('total'), by: '3' }, num('100')] },
    };
    const run = (total: string) => evaluate(capped, inputs({ 'row:total': total }));
    expect(text(run('100').value)).toBe('33');
    expect(text(run('400').value)).toBe('100');
    expect(run('400').children[0]?.winner).toEqual({ index: 1, alone: true });
    expect(run('300').children[0]?.winner).toEqual({ index: 0, alone: false });
  });
});

describe('the limits of an expression', () => {
  const noCategories = { categories: [], lookup: false };
  const problemsOf = (
    node: RuleNode,
    context: Parameters<typeof checkExpression>[1] = noCategories,
  ): string[] => {
    const problems: string[] = [];
    checkExpression(node, context, problems);
    return problems;
  };
  const rounded = (arg: RuleNode): RuleNode => ({
    op: 'round',
    arg,
    increment: '0.01',
    mode: 'half_up',
  });

  it('counts the parts, the nesting and the conditions the way the limits say', () => {
    const bike = bikeExpression();
    // Thirteen operations, columns and numbers, and the one condition.
    expect(sizeOf(bike)).toBe(14);
    expect(depthOf(bike)).toBe(5);
    expect(
      problemsOf(bike, {
        categories: [{ column: 'member', from: 'lookup', values: ['yes', 'no'] }],
        lookup: true,
      }),
    ).toEqual([]);
    expect(sizeOf(col('a'))).toBe(1);
    expect(depthOf(col('a'))).toBe(0);
    expect(depthOf(rounded(col('a')))).toBe(1);
  });

  it('refuses an expression of more than 32 parts', () => {
    const wide = (parts: number): RuleNode => ({
      op: 'add',
      args: Array.from({ length: parts }, (_, i) => col(`c${i}`)).slice(0, 4),
    });
    let node: RuleNode = col('c');
    while (sizeOf(node) <= RULE_LIMITS.maxNodes) {
      node = { op: 'add', args: [node, wide(4)] };
      node = { op: 'round', arg: node, increment: '1', mode: 'up' };
      node = { op: 'max', args: [node, num('1')] };
    }
    const problems = problemsOf(rounded(node));
    expect(
      problems.some((p) => /The rule has \d+ parts, and the most Architect takes is 32/.test(p)),
    ).toBe(true);
  });

  it('refuses nesting deeper than six operations', () => {
    let node: RuleNode = col('a');
    for (let i = 0; i < 6; i += 1) node = { op: 'max', args: [node, num('1')] };
    expect(depthOf(node)).toBe(6);
    expect(problemsOf(rounded(node)).some((p) => p.includes('nests 7 operations'))).toBe(true);
    expect(problemsOf(rounded(node.op === 'max' ? (node.args[0] as RuleNode) : node))).toEqual([]);
  });

  it('refuses more than two conditions', () => {
    const gate = (arg: RuleNode): RuleNode => ({
      op: 'if',
      when: { test: 'gt', arg: col('a'), than: '1' },
      then: arg,
      else: num('0'),
    });
    const two = rounded(gate(gate(col('b'))));
    expect(problemsOf(two)).toEqual([]);
    const three = rounded(gate(gate(gate(col('b')))));
    expect(problemsOf(three)).toEqual(['The rule has 3 conditions (if), and the most is 2.']);
  });

  it('wants a rounding last, a step above zero, and no division by zero', () => {
    expect(problemsOf(col('a'))[0]).toContain('The last step of a rule must be a rounding');
    expect(problemsOf({ op: 'round', arg: col('a'), increment: '0', mode: 'up' })).toEqual([
      'A rounding step must be above zero, not 0.',
    ]);
    expect(problemsOf(rounded({ op: 'div', arg: col('a'), by: '0.00' }))).toEqual([
      'A division by zero can have no answer.',
    ]);
  });

  it('wants every value a tested column may have stated, and a test only for those', () => {
    const member: RuleNode = rounded({
      op: 'if',
      when: { test: 'equals', column: 'member', from: 'row', value: 'yes' },
      then: col('a'),
      else: num('0'),
    });
    expect(problemsOf(member)[0]).toContain('does not state every value member may have');
    const declared = (values: string[]) => ({
      categories: [{ column: 'member', from: 'row' as const, values }],
      lookup: false,
    });
    expect(problemsOf(member, declared(['YES', ' no ']))).toEqual([]);
    expect(problemsOf(member, declared(['no', 'maybe']))).toEqual([
      'The rule tests for "yes" in member, which is not one of its values.',
    ]);
  });

  it('wants a lookup for what it reads from another table, and a use for a lookup it names', () => {
    const fromOther = rounded(col('rate', 'lookup'));
    expect(problemsOf(fromOther)).toEqual([
      'The rule reads a column from another table, but names no lookup into one.',
    ]);
    expect(problemsOf(rounded(col('a')), { categories: [], lookup: true })).toEqual([
      'The rule names a lookup into another table but reads nothing from it.',
    ]);
  });

  it('only parses an expression that is typed: nothing but the operations it is allowed', () => {
    const ok = RuleNodeSchema.safeParse({
      op: 'round',
      arg: {
        op: 'mul',
        args: [
          { op: 'col', column: 'a', from: 'row' },
          { op: 'num', value: '1.5' },
        ],
      },
      increment: '0.01',
      mode: 'half_up',
    });
    expect(ok.success).toBe(true);
    for (const bad of [
      { op: 'call', name: 'sum', args: [] },
      { op: 'num', value: '1e3' },
      { op: 'num', value: '0.123456789' },
      { op: 'num', value: 3 },
      { op: 'add', args: [{ op: 'num', value: '1' }] },
      { op: 'sub', args: [{ op: 'num', value: '1' }] },
      { op: 'div', arg: { op: 'num', value: '1' }, by: 'x' },
      { op: 'round', arg: { op: 'num', value: '1' }, increment: '1', mode: 'banker' },
      {
        op: 'if',
        when: { test: 'not_equals', column: 'a', from: 'row', value: 'x' },
        then: { op: 'num', value: '1' },
        else: { op: 'num', value: '2' },
      },
      { op: 'col', column: 'a' },
    ]) {
      expect(RuleNodeSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
