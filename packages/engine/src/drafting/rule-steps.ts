import {
  RULE_LIMITS,
  type JsonSchemaObject,
  type RuleCondition,
  type RuleFrom,
  type RuleNode,
} from '@architect/shared';
import { z } from 'zod';
import { list, objectOf, text } from './json-parts';
import { cleanText } from './values';

/*
 * How the teacher writes the expression of a rule: a list of steps that name one another by id,
 * the way a calculation is worked on paper ("hours", "labor = hours times 65", "total = labor plus
 * parts"), not a tree inside a tree. A list needs no schema that refers to itself or nests as deep
 * as the rule does, which providers that limit a schema's depth would refuse, and a step used in
 * two places is written once. Architect expands the list into the typed tree of `@architect/shared`
 * that it checks and evaluates, or says what is wrong with which step.
 */

export const WireStepSchema = z.object({
  id: z.string(),
  op: z.string(),
  // A teacher that writes 65 instead of "65" means the same number.
  value: z
    .union([z.string(), z.number()])
    .optional()
    .transform((value) => (value === undefined ? undefined : String(value))),
  column: z.string().optional(),
  from: z.string().optional(),
  values: z.array(z.string()).optional(),
  mode: z.string().optional(),
  args: z.array(z.string()).optional(),
});
export type WireStep = z.infer<typeof WireStepSchema>;

/** The operations a step may name, as the format spells them. */
const OPS = [
  'num',
  'col',
  'add',
  'sub',
  'mul',
  'div',
  'min',
  'max',
  'round',
  'if',
  'equals',
  'in',
  'gt',
  'gte',
  'lt',
  'lte',
] as const;

/** One step in the reply format. */
export function stepSchema(): JsonSchemaObject {
  return objectOf({
    id: text('A short name for this step, such as "hours" or "labor". Every step has its own.'),
    op: { type: 'string', enum: [...OPS], description: 'The operation of this step.' },
    value: text(
      'num: the number. div: the number to divide by. round: the step size. equals, gt, gte, lt, lte: what to compare with. Else empty.',
    ),
    column: text('col, equals, in: the column, spelled as the table spells it. Else empty.'),
    from: {
      type: 'string',
      enum: ['row', 'lookup', ''],
      description: 'col, equals, in: row, or lookup for the looked-up row. Else empty.',
    },
    values: list('in: every value that makes the test true. Else empty.'),
    mode: {
      type: 'string',
      enum: ['up', 'down', 'half_up', ''],
      description: 'round only. Else empty.',
    },
    args: list(
      'The ids of the steps this one is made of, in the order its operation takes them. Empty for num, col, equals and in.',
    ),
  });
}

const NUMBER = /^-?\d{1,12}(?:\.\d{1,8})?$/;

/** The most parts a rule may come to once a step is counted every time it is used. */
const MOST_EXPANDED = RULE_LIMITS.maxNodes * 4;

function fromOf(value: string | undefined): RuleFrom {
  return value === 'lookup' ? 'lookup' : 'row';
}

/**
 * The tree a list of steps comes to, from the step named by `result`, or null with every
 * problem found added to `problems`: a step that doesn't exist, two with one id, steps that use
 * each other in a circle, a step with the wrong number of steps inside it, a number that isn't
 * one, and a step nothing uses.
 */
export function expandSteps(
  steps: readonly WireStep[],
  result: string,
  problems: string[],
): RuleNode | null {
  const say = (message: string): void => {
    if (!problems.includes(message)) problems.push(message);
  };
  const byId = new Map<string, WireStep>();
  for (const step of steps) {
    const id = cleanText(step.id);
    if (id === '') {
      say('A step of the rule has no id.');
    } else if (byId.has(id)) {
      say(`Two steps of the rule are called "${id}". Every step needs its own id.`);
    } else {
      byId.set(id, step);
    }
  }
  const last = cleanText(result);
  if (byId.size === 0) {
    say('The rule has no steps.');
    return null;
  }
  if (!byId.has(last)) {
    say(
      `result names "${last}", which is not one of the steps. Name the id of the last step, the rounding that gives the answer.`,
    );
    return null;
  }

  const used = new Set<string>();
  const making: string[] = [];
  let parts = 0;
  let failed = false;
  const fail = (message: string): null => {
    failed = true;
    say(message);
    return null;
  };

  /** The step with this id, found for the step `by`, made into a tree. */
  const node = (id: string, by: string): RuleNode | null => {
    const step = byId.get(id);
    if (step === undefined) return fail(`${by} uses "${id}", which is not one of the steps.`);
    if (making.includes(id)) {
      const circle = [...making.slice(making.indexOf(id)), id].map((item) => `"${item}"`);
      return fail(`The steps ${circle.join(', then ')} use each other in a circle.`);
    }
    parts += 1;
    if (parts > MOST_EXPANDED) {
      return fail(
        `The rule uses its steps over and over: counting a step each time it is used, it has more than ${MOST_EXPANDED} parts, and the most is ${RULE_LIMITS.maxNodes}.`,
      );
    }
    used.add(id);
    making.push(id);
    const made = nodeOf(step, id);
    making.pop();
    return made;
  };

  const inside = (step: WireStep, id: string): RuleNode[] | null => {
    const nodes = (step.args ?? []).map((arg) => node(cleanText(arg), `Step "${id}"`));
    return nodes.every((item) => item !== null) ? (nodes as RuleNode[]) : null;
  };

  const need = (step: WireStep, id: string, count: number | [number, number]): boolean => {
    const [least, most] = typeof count === 'number' ? [count, count] : count;
    const given = (step.args ?? []).length;
    if (given >= least && given <= most) return true;
    say(
      `Step "${id}" is "${step.op}" with ${given} ${given === 1 ? 'step' : 'steps'} inside it, and it takes ${least === most ? least : `${least} to ${most}`}.`,
    );
    failed = true;
    return false;
  };

  const condition = (id: string, by: string): RuleCondition | null => {
    const step = byId.get(id);
    if (step === undefined) return fail(`${by} uses "${id}", which is not one of the steps.`);
    used.add(id);
    const column = cleanText(step.column);
    const from = fromOf(step.from);
    switch (step.op) {
      case 'equals': {
        const value = cleanText(step.value);
        if (column === '' || value === '') {
          return fail(`Test "${id}" (equals) needs a column and a value.`);
        }
        return { test: 'equals', column, from, value };
      }
      case 'in': {
        const values = (step.values ?? []).map(cleanText).filter((value) => value !== '');
        if (column === '' || values.length === 0) {
          return fail(`Test "${id}" (in) needs a column and the values that make it true.`);
        }
        return { test: 'in', column, from, values: [...new Set(values)] };
      }
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        const than = cleanText(step.value);
        if (!need(step, id, 1)) return null;
        if (!NUMBER.test(than)) {
          return fail(`Test "${id}" (${step.op}) needs a number to compare with, not "${than}".`);
        }
        const [first] = step.args ?? [];
        const arg = node(cleanText(first), `Test "${id}"`);
        return arg === null ? null : { test: step.op, arg, than };
      }
      default:
        return fail(
          `"${id}" is used as the test of an if, so it must be a test: equals, in, gt, gte, lt or lte, not "${step.op}". There is no "not": test for the values that count.`,
        );
    }
  };

  const nodeOf = (step: WireStep, id: string): RuleNode | null => {
    const value = cleanText(step.value);
    switch (step.op) {
      case 'num':
        if (!NUMBER.test(value)) {
          return fail(
            `Step "${id}" is a number, but "${value}" is not one. Write digits and at most one point, such as 65 or 0.1.`,
          );
        }
        return { op: 'num', value };
      case 'col': {
        const column = cleanText(step.column);
        if (column === '') return fail(`Step "${id}" reads a column but names none.`);
        return { op: 'col', column, from: fromOf(step.from) };
      }
      case 'add':
      case 'mul':
      case 'min':
      case 'max': {
        if (!need(step, id, [2, RULE_LIMITS.maxOperands])) return null;
        const nodes = inside(step, id);
        return nodes === null ? null : { op: step.op, args: nodes };
      }
      case 'sub': {
        if (!need(step, id, 2)) return null;
        const [first, second] = inside(step, id) ?? [];
        return first === undefined || second === undefined
          ? null
          : { op: 'sub', args: [first, second] };
      }
      case 'div': {
        if (!need(step, id, 1)) return null;
        const [arg] = inside(step, id) ?? [];
        if (arg === undefined) return null;
        if (!NUMBER.test(value)) {
          return fail(
            `Step "${id}" divides by "${value}", which is not a number. Divide by a number such as 12.`,
          );
        }
        return { op: 'div', arg, by: value };
      }
      case 'round': {
        if (!need(step, id, 1)) return null;
        const [arg] = inside(step, id) ?? [];
        if (arg === undefined) return null;
        if (!NUMBER.test(value)) {
          return fail(
            `Step "${id}" rounds to "${value}", which is not a number. Give the step size, such as 0.01.`,
          );
        }
        if (step.mode !== 'up' && step.mode !== 'down' && step.mode !== 'half_up') {
          return fail(`Step "${id}" is a rounding with no mode. Use up, down or half_up.`);
        }
        return { op: 'round', arg, increment: value, mode: step.mode };
      }
      case 'if': {
        if (!need(step, id, 3)) return null;
        const [test, first, second] = (step.args ?? []).map(cleanText);
        const when = condition(test ?? '', `Step "${id}"`);
        const then = node(first ?? '', `Step "${id}"`);
        const otherwise = node(second ?? '', `Step "${id}"`);
        return when === null || then === null || otherwise === null
          ? null
          : { op: 'if', when, then, else: otherwise };
      }
      case '':
        return fail(`Step "${id}" has no operation.`);
      default:
        return fail(
          `Step "${id}" is "${step.op}", which is not an operation. The operations are num, col, add, sub, mul, div, min, max, round and if.`,
        );
    }
  };

  const tree = node(last, 'result');
  if (failed) return null;
  const idle = [...byId.keys()].filter((id) => !used.has(id));
  for (const id of idle) say(`Step "${id}" is not used by the rule. Leave it out, or use it.`);
  return idle.length > 0 ? null : tree;
}
