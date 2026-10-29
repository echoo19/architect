import type { RuleCondition, RuleNode } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { evaluate, refKey, type CaseInputs } from '../src/drafting/rule/expression';
import * as q from '../src/drafting/rule/rational';
import { linksOf, ruleSteps, type Doing, type Link } from '../src/drafting/rule/steps';
import type { WordsContext } from '../src/drafting/rule/words';
import { foldKey } from '../src/drafting/values';
import { seededRandom } from '../src/splits/random';
import { bikeExpression, col, num } from './support/rule-data';

/** The words of the sample job: a USD price with a member discount looked up in customers.csv. */
const SHOP = {
  lookupTable: 'customers.csv',
  currency: 'USD',
  categories: [{ column: 'member', from: 'lookup' as const, values: ['yes', 'no'] }],
};
const ZERO_PARTS = { ...SHOP, emptyMeansZero: [{ column: 'parts_cost', from: 'row' as const }] };

const member: RuleCondition = { test: 'equals', column: 'member', from: 'lookup', value: 'yes' };

const rounded = (arg: RuleNode, increment = '0.01', mode: 'up' | 'down' | 'half_up' = 'half_up') =>
  ({ op: 'round', arg, increment, mode }) satisfies RuleNode;

const whenMember = (then: RuleNode, otherwise: RuleNode): RuleNode => ({
  op: 'if',
  when: member,
  then,
  else: otherwise,
});

const textOf = (node: RuleNode, words: WordsContext = SHOP): string[] =>
  ruleSteps(node, words).map((step) => step.text);

describe("a rule told as steps, the shop's rule first", () => {
  it('reads the bike shop rule as five steps, a member discount among them', () => {
    expect(ruleSteps(bikeExpression(), ZERO_PARTS)).toEqual([
      { text: 'Round labor hours up to a multiple of 0.5.' },
      { text: 'Multiply by 65.' },
      {
        text: 'When member (customers.csv) is yes, multiply by 0.9.',
        files: ['customers.csv'],
      },
      { text: 'Add parts cost.', note: 'An empty parts cost counts as 0, as you said.' },
      { text: 'Round the result to the nearest cent; half a cent rounds up.' },
    ]);
  });

  it('says only the part that differs under the test, and nothing of a side that does nothing', () => {
    // The member price is the other price with something more done to it, in either order.
    const steps = textOf(bikeExpression());
    expect(steps).toContain('When member (customers.csv) is yes, multiply by 0.9.');
    expect(steps.some((step) => step.includes('no'))).toBe(false);
    // The other way round: the discount is for those the test is not true of.
    const reversed = rounded(
      whenMember(
        { op: 'mul', args: [col('hours'), num('65')] },
        { op: 'mul', args: [col('hours'), num('65'), num('0.9')] },
      ),
    );
    expect(textOf(reversed)).toEqual([
      'Multiply hours by 65.',
      'When member (customers.csv) is no, multiply by 0.9.',
      'Round the result to the nearest cent; half a cent rounds up.',
    ]);
  });

  it('says both sides when each does something different to what they share', () => {
    const both = rounded(
      whenMember(
        { op: 'mul', args: [col('hours'), num('65'), num('0.9')] },
        { op: 'add', args: [{ op: 'mul', args: [col('hours'), num('65')] }, num('5')] },
      ),
    );
    expect(textOf(both)).toEqual([
      'Multiply hours by 65.',
      'When member (customers.csv) is yes, multiply by 0.9. Otherwise, add 5.',
      'Round the result to the nearest cent; half a cent rounds up.',
    ]);
  });

  it('says what both sides end with once, after the test, such as a rounding written on each', () => {
    const roundedUp = (arg: RuleNode): RuleNode => rounded(arg, '5', 'up');
    const hours = (...factors: string[]): RuleNode => ({
      op: 'mul',
      args: [col('hours'), ...factors.map(num)],
    });
    // The discount is all that differs; both prices go up to the next five.
    expect(
      textOf(rounded(whenMember(roundedUp(hours('65', '0.9')), roundedUp(hours('65'))))),
    ).toEqual([
      'Multiply hours by 65.',
      'When member (customers.csv) is yes, multiply by 0.9.',
      'Round the result up to a multiple of 5.',
      'Round the result to the nearest cent; half a cent rounds up.',
    ]);
    // Each side does something of its own, and the ending is the same.
    expect(textOf(rounded(whenMember(roundedUp(hours('55')), roundedUp(hours('65')))))).toEqual([
      'Start with hours.',
      'When member (customers.csv) is yes, multiply by 55. Otherwise, multiply by 65.',
      'Round the result up to a multiple of 5.',
      'Round the result to the nearest cent; half a cent rounds up.',
    ]);
    // The side that does the extra thing is the other one, and the test is said the other way.
    expect(textOf(rounded(whenMember(roundedUp(col('hours')), roundedUp(hours('2')))))).toEqual([
      'Start with hours.',
      'When member (customers.csv) is no, multiply by 2.',
      'Round the result up to a multiple of 5.',
      'Round the result to the nearest cent; half a cent rounds up.',
    ]);
  });

  it('spreads a test used as a factor over its two sides, leaving out a side that multiplies by one', () => {
    const factor = (then: string, otherwise: string) =>
      rounded({
        op: 'mul',
        args: [col('hours'), num('65'), whenMember(num(then), num(otherwise))],
      });
    expect(textOf(factor('0.9', '1'))).toEqual([
      'Multiply hours by 65.',
      'When member (customers.csv) is yes, multiply by 0.9.',
      'Round the result to the nearest cent; half a cent rounds up.',
    ]);
    expect(textOf(factor('1', '0.9'))[1]).toBe(
      'When member (customers.csv) is no, multiply by 0.9.',
    );
    expect(textOf(factor('0.9', '0.8'))[1]).toBe(
      'When member (customers.csv) is yes, multiply by 0.9. Otherwise, multiply by 0.8.',
    );
    // Adding nothing is no more a step than multiplying by one.
    const fee = rounded({
      op: 'add',
      args: [col('parts_cost'), whenMember(num('0'), num('5'))],
    });
    expect(textOf(fee)).toEqual([
      'Start with parts cost.',
      'When member (customers.csv) is no, add 5.',
      'Round the result to the nearest cent; half a cent rounds up.',
    ]);
  });

  it('says the whole test when a side that does nothing can only be told by the other way round', () => {
    // Every value of `kind` is tested for, so there is no "the other way round" to say.
    const all = {
      ...SHOP,
      categories: [{ column: 'kind', from: 'row' as const, values: ['x', 'y'] }],
    };
    const factor = rounded({
      op: 'mul',
      args: [
        col('hours'),
        {
          op: 'if',
          when: { test: 'in', column: 'kind', from: 'row', values: ['x', 'y'] },
          then: num('1'),
          else: num('0.9'),
        },
      ],
    });
    expect(textOf(factor, all)).toEqual([
      'Multiply hours by (1 when kind is x or y, otherwise 0.9).',
      'Round the result to the nearest cent; half a cent rounds up.',
    ]);
  });

  it('says a test with nothing in common as a sentence about each side', () => {
    const overtime = rounded({
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
    });
    expect(textOf(overtime)).toEqual([
      'When hours is more than 8, use 8 times rate plus (hours less 8) times rate times 1.5. Otherwise, use hours times rate.',
      'Round the result to the nearest cent; half a cent rounds up.',
    ]);
    // A test inside a side is in brackets, so "otherwise" belongs to one test only.
    const nested = rounded(
      whenMember(num('5'), {
        op: 'if',
        when: { test: 'gt', arg: col('hours'), than: '8' },
        then: num('10'),
        else: num('20'),
      }),
    );
    expect(textOf(nested)[0]).toBe(
      'When member (customers.csv) is yes, use 5. Otherwise, use (10 when hours is more than 8, otherwise 20).',
    );
  });

  it('keeps a smallest or a largest as the thing done to the amount, and a division as one', () => {
    const capped = rounded(
      { op: 'min', args: [{ op: 'div', arg: col('total'), by: '3' }, num('100')] },
      '1',
    );
    expect(textOf(capped)).toEqual([
      'Divide total by 3.',
      'Take the smaller of the result and 100.',
      'Round the result to the nearest whole number; exactly halfway rounds up.',
    ]);
    // With a plain column to begin with, the sentence says both: of what, and which is chosen.
    expect(textOf({ op: 'max', args: [col('fee'), num('10'), col('minimum')] })).toEqual([
      'Take the larger of fee, 10 and minimum.',
    ]);
  });

  it('puts a sum, a difference and a rounding inside a part of the rule in brackets', () => {
    const steps = textOf(
      rounded({
        op: 'sub',
        args: [col('total'), { op: 'add', args: [col('a'), rounded(col('b'), '5', 'up')] }],
      }),
    );
    expect(steps).toEqual([
      'Start with total.',
      'Subtract (a plus (b rounded up to a multiple of 5)).',
      'Round the result to the nearest cent; half a cent rounds up.',
    ]);
  });

  it('says each way of rounding in the words the rule in one sentence uses', () => {
    expect(textOf(rounded(col('a'), '1', 'down'))).toEqual(['Round a down to a whole number.']);
    expect(textOf(rounded(col('a'), '0.01', 'half_up'))).toEqual([
      'Round a to the nearest cent; half a cent rounds up.',
    ]);
    expect(textOf(rounded(col('a'), '0.05', 'half_up'))).toEqual([
      'Round a to the nearest multiple of 0.05; exactly halfway rounds up.',
    ]);
    expect(textOf(rounded(col('a'), '0.01', 'up'))).toEqual(['Round a up to a whole cent.']);
    expect(textOf(rounded(col('a'), '1', 'up'), { categories: [] })).toEqual([
      'Round a up to a whole number.',
    ]);
  });

  it('lists the files a step names, quietly beside the words, in a column from a lookup', () => {
    const steps = ruleSteps(
      rounded({ op: 'add', args: [col('hours'), col('rate', 'lookup')] }),
      SHOP,
    );
    expect(steps[1]).toEqual({ text: 'Add rate (customers.csv).', files: ['customers.csv'] });
    expect(steps[0]?.files).toBeUndefined();
    // A rule that reads nothing from another table lists no file.
    expect(ruleSteps(bikeExpression(), { categories: [] }).every((step) => !step.files)).toBe(true);
  });

  it('says what an empty cell counts as in the first step that reads the column, once', () => {
    const words = {
      ...SHOP,
      emptyMeansZero: [
        { column: 'parts_cost', from: 'row' as const },
        { column: 'fee', from: 'lookup' as const },
      ],
    };
    const steps = ruleSteps(
      rounded({
        op: 'add',
        args: [col('hours'), col('parts_cost'), col('fee', 'lookup'), col('parts_cost')],
      }),
      words,
    );
    expect(steps.map((step) => step.note)).toEqual([
      undefined,
      'An empty parts cost counts as 0, as you said.',
      'An empty fee (customers.csv) counts as 0, as you said.',
      undefined,
      undefined,
    ]);
    // Two columns met in one step are said together; a column only met in a test is met there.
    const together = ruleSteps(
      rounded({
        op: 'if',
        when: { test: 'gt', arg: col('parts_cost'), than: '100' },
        then: { op: 'mul', args: [col('hours'), num('2')] },
        else: { op: 'mul', args: [col('hours'), num('3')] },
      }),
      words,
    );
    expect(together.filter((step) => step.note !== undefined)).toHaveLength(1);
    // The test is the second step: the first is only what the two sides share.
    expect(together[1]?.text).toBe(
      'When parts cost is more than 100, multiply by 2. Otherwise, multiply by 3.',
    );
    expect(together[1]?.note).toBe('An empty parts cost counts as 0, as you said.');
  });

  it('never repeats the sentence form: it is the same rule, a step at a time', () => {
    const steps = ruleSteps(bikeExpression(), ZERO_PARTS)
      .map((step) => step.text)
      .join(' ');
    for (const part of ['65', '0.9', '0.5', 'parts cost', 'labor hours', 'member']) {
      expect(steps).toContain(part);
    }
    expect(steps).not.toMatch(/undefined|NaN|\[object|—|–|[‘’“”]/);
  });
});

/*
 * The chain a rule is read as must be the rule. The test below works every random rule out two
 * ways, as the expression and as its chain of links, over random inputs, and the answers must be
 * the same: a step list that read a rule wrongly would say something false to the person.
 */

const KINDS = ['x', 'y', 'z'];
const WORDS_FOR_RANDOM = {
  lookupTable: 'rates.csv',
  categories: [{ column: 'kind', from: 'row' as const, values: KINDS }],
};

function generator(seed: string) {
  const random = seededRandom(seed);
  const choose = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
  const leaf = (): RuleNode =>
    random() < 0.7
      ? col(choose(['a', 'b', 'c']), random() < 0.2 ? 'lookup' : 'row')
      : num(choose(['0', '1', '2', '0.5', '1.1', '65']));
  const condition = (depth: number): RuleCondition => {
    const kind = random();
    if (kind < 0.4) return { test: 'equals', column: 'kind', from: 'row', value: choose(KINDS) };
    if (kind < 0.6) {
      return {
        test: 'in',
        column: 'kind',
        from: 'row',
        values: KINDS.slice(0, 1 + Math.floor(random() * 2)),
      };
    }
    return {
      test: choose(['gt', 'gte', 'lt', 'lte'] as const),
      arg: node(depth - 1),
      than: choose(['0', '1', '5']),
    };
  };
  /** The same rule with one thing more done to it, so a test often has something to share. */
  const extended = (base: RuleNode): RuleNode => {
    const more = random();
    if (more < 0.35) return { op: 'mul', args: [base, num(choose(['0.9', '2', '1']))] };
    if (more < 0.6) return { op: 'add', args: [base, leaf()] };
    if (more < 0.75) return { op: 'sub', args: [base, leaf()] };
    if (more < 0.9) return { op: 'round', arg: base, increment: choose(['1', '0.5']), mode: 'up' };
    return { op: 'max', args: [base, leaf()] };
  };
  /** Something done to either side of a test alike: a rounding, or a doubling. */
  const endWith =
    (rounding: boolean) =>
    (side: RuleNode): RuleNode =>
      rounding
        ? { op: 'round', arg: side, increment: '1', mode: 'up' }
        : { op: 'mul', args: [side, num('2')] };
  function node(depth: number): RuleNode {
    if (depth <= 0 || random() < 0.2) return leaf();
    const kind = random();
    if (kind < 0.18)
      return {
        op: 'add',
        args: [node(depth - 1), node(depth - 1), ...(random() < 0.3 ? [leaf()] : [])],
      };
    if (kind < 0.36)
      return {
        op: 'mul',
        args: [node(depth - 1), node(depth - 1), ...(random() < 0.3 ? [leaf()] : [])],
      };
    if (kind < 0.46) return { op: 'sub', args: [node(depth - 1), node(depth - 1)] };
    if (kind < 0.54) return { op: 'div', arg: node(depth - 1), by: choose(['2', '3', '4']) };
    if (kind < 0.64) {
      return { op: choose(['min', 'max'] as const), args: [node(depth - 1), node(depth - 1)] };
    }
    if (kind < 0.74) {
      return {
        op: 'round',
        arg: node(depth - 1),
        increment: choose(['1', '0.5', '0.01']),
        mode: choose(['up', 'down', 'half_up'] as const),
      };
    }
    const then = node(depth - 1);
    const otherwise = random() < 0.6 ? extended(then) : node(depth - 1);
    // Both sides may end the same way, such as with a rounding written on each.
    const ending = endWith(random() < 0.5);
    const [first, second] = random() < 0.25 ? [ending(then), ending(otherwise)] : [then, otherwise];
    return random() < 0.5
      ? { op: 'if', when: condition(depth), then: first, else: second }
      : { op: 'if', when: condition(depth), then: second, else: first };
  }
  const inputs = (): CaseInputs => {
    const numbers = new Map(
      ['row', 'lookup'].flatMap((from) =>
        ['a', 'b', 'c'].map(
          (column) =>
            [
              refKey({ column, from: from as 'row' | 'lookup' }),
              q.fraction(BigInt(Math.floor(random() * 2000) - 200), 100n),
            ] as const,
        ),
      ),
    );
    const kind = choose(KINDS);
    return {
      number: (ref) => numbers.get(refKey(ref)) ?? q.ZERO,
      category: () => foldKey(kind),
    };
  };
  return { node, inputs };
}

const APPLY = { add: q.add, sub: q.sub, mul: q.mul, div: q.div } as const;

/** What the chain comes to for the inputs, a link at a time. */
function followed(links: readonly Link[], inputs: CaseInputs): q.Q {
  const worked = (doing: Doing, value: q.Q): q.Q => {
    if (doing.kind === 'do') return APPLY[doing.op](value, evaluate(doing.operand, inputs).value);
    if (doing.kind === 'round') {
      return q.roundTo(value, q.fromText(doing.increment) ?? q.ONE, doing.mode);
    }
    const all = [value, ...doing.others.map((other) => evaluate(other, inputs).value)];
    return all.reduce((best, next) => {
      const order = q.compare(next, best);
      return (doing.op === 'min' ? order < 0 : order > 0) ? next : best;
    });
  };
  let value: q.Q | null = null;
  for (const link of links) {
    if (link.kind === 'start' || link.kind === 'pick') {
      value = evaluate(link.node, inputs).value;
    } else if (value === null) {
      throw new Error('A chain begins with what the amount starts as.');
    } else if (link.kind === 'when') {
      const asked: RuleNode = { op: 'if', when: link.node.when, then: num('1'), else: num('0') };
      const held = q.equal(evaluate(asked, inputs).value, q.ONE);
      for (const doing of held !== link.negate ? link.then : link.otherwise) {
        value = worked(doing, value);
      }
    } else {
      value = worked(link, value);
    }
  }
  if (value === null) throw new Error('A rule has at least one link.');
  return value;
}

describe('the chain a rule is read as', () => {
  it('works out to what the rule works out to, for every shape a rule may have', () => {
    const { node, inputs } = generator('rule steps: chain');
    let tests = 0;
    let spread = 0;
    for (let rule = 0; rule < 1500; rule += 1) {
      const expression: RuleNode = rounded(node(4), '0.01', 'half_up');
      const links = linksOf(expression, WORDS_FOR_RANDOM);
      spread += links.filter((link) => link.kind === 'when').length;
      for (let at = 0; at < 6; at += 1) {
        const given = inputs();
        const want = evaluate(expression, given).value;
        const got = followed(links, given);
        if (!q.equal(want, got)) {
          throw new Error(
            `The chain of ${JSON.stringify(expression)} came to ${q.toText(got).text}, not ${q.toText(want).text}.`,
          );
        }
        tests += 1;
      }
    }
    expect(tests).toBe(9000);
    // The shapes that matter were met: tests spread over what they share, many times over.
    expect(spread).toBeGreaterThan(300);
  });

  it('is told in sentences that end well, whatever the rule', () => {
    const { node } = generator('rule steps: words');
    let said = 0;
    for (let rule = 0; rule < 800; rule += 1) {
      const expression = rounded(node(4), '0.01', 'half_up');
      const steps = ruleSteps(expression, WORDS_FOR_RANDOM);
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.text).toMatch(/^[A-Z].*\.$/s);
        expect(`${step.text} ${step.note ?? ''}`).not.toMatch(
          /undefined|NaN|\[object|\s\s|—|–|[‘’“”]/,
        );
        // Brackets open and close in step.
        let open = 0;
        for (const letter of step.text) {
          open += letter === '(' ? 1 : letter === ')' ? -1 : 0;
          expect(open).toBeGreaterThanOrEqual(0);
        }
        expect(open).toBe(0);
        said += 1;
      }
      // The last thing a rule does is its rounding, and the steps end with it.
      expect(steps[steps.length - 1]?.text).toMatch(/^Round /);
    }
    expect(said).toBeGreaterThan(2000);
  });

  it('begins with what the amount starts as, and ends with the rounding that gives the answer', () => {
    const { node } = generator('rule steps: ends');
    for (let rule = 0; rule < 400; rule += 1) {
      const links = linksOf(rounded(node(3)), WORDS_FOR_RANDOM);
      expect(['start', 'pick']).toContain(links[0]?.kind);
      expect(links[links.length - 1]?.kind).toBe('round');
    }
  });
});
