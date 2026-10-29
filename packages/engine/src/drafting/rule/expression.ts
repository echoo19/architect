import {
  RULE_LIMITS,
  type RuleCategory,
  type RuleCondition,
  type RuleFrom,
  type RuleNode,
} from '@architect/shared';
import { foldKey } from '../values';
import * as q from './rational';

/*
 * The expression a rule is made of: what it may contain, how it is checked before a task is made
 * from it, and how it is evaluated. Evaluation is exact (rational arithmetic) and total: every
 * input is read before it starts, so an expression that got this far cannot fail half way.
 */

/** A column of the case's row or of the row looked up from another table. */
export interface ColumnRef {
  column: string;
  from: RuleFrom;
}

export const refKey = (ref: ColumnRef): string => `${ref.from}:${ref.column.toLowerCase()}`;

/** What a case provides to an expression. The category is folded, as `foldKey` folds it. */
export interface CaseInputs {
  number(ref: ColumnRef): q.Q;
  category(ref: ColumnRef): string;
  /** Whether the number was an empty cell that the person said counts as zero. */
  zeroed?(ref: ColumnRef): boolean;
}

/** The nodes of an expression, each before the ones inside it. */
export function nodesOf(node: RuleNode): RuleNode[] {
  switch (node.op) {
    case 'num':
    case 'col':
      return [node];
    case 'add':
    case 'sub':
    case 'mul':
    case 'min':
    case 'max':
      return [node, ...node.args.flatMap(nodesOf)];
    case 'div':
    case 'round':
      return [node, ...nodesOf(node.arg)];
    case 'if':
      return [
        node,
        ...(node.when.test === 'gt' ||
        node.when.test === 'gte' ||
        node.when.test === 'lt' ||
        node.when.test === 'lte'
          ? nodesOf(node.when.arg)
          : []),
        ...nodesOf(node.then),
        ...nodesOf(node.else),
      ];
  }
}

/** The numeric columns an expression reads, without repeats, in the order they first appear. */
export function numberRefs(node: RuleNode): ColumnRef[] {
  const seen = new Map<string, ColumnRef>();
  for (const inner of nodesOf(node)) {
    if (inner.op === 'col') seen.set(refKey(inner), { column: inner.column, from: inner.from });
  }
  return [...seen.values()];
}

/** The category columns an expression tests, without repeats. */
export function categoryRefs(node: RuleNode): ColumnRef[] {
  const seen = new Map<string, ColumnRef>();
  for (const inner of nodesOf(node)) {
    if (inner.op === 'if' && (inner.when.test === 'equals' || inner.when.test === 'in')) {
      seen.set(refKey(inner.when), { column: inner.when.column, from: inner.when.from });
    }
  }
  return [...seen.values()];
}

/** The conditions of an expression, in the order their `if` nodes appear. */
export function conditionalsOf(node: RuleNode): Extract<RuleNode, { op: 'if' }>[] {
  return nodesOf(node).filter(
    (inner): inner is Extract<RuleNode, { op: 'if' }> => inner.op === 'if',
  );
}

function conditionDepth(when: RuleCondition): number {
  return when.test === 'equals' || when.test === 'in' ? 1 : 1 + depthOf(when.arg);
}

/** How many operations are nested inside one another; a column or a number is none. */
export function depthOf(node: RuleNode): number {
  switch (node.op) {
    case 'num':
    case 'col':
      return 0;
    case 'add':
    case 'sub':
    case 'mul':
    case 'min':
    case 'max':
      return 1 + Math.max(...node.args.map(depthOf));
    case 'div':
    case 'round':
      return 1 + depthOf(node.arg);
    case 'if':
      return 1 + Math.max(conditionDepth(node.when), depthOf(node.then), depthOf(node.else));
  }
}

/** Nodes of the expression, a condition counting as one with whatever it compares inside it. */
export function sizeOf(node: RuleNode): number {
  return nodesOf(node).length + conditionalsOf(node).length;
}

/** The text of a number literal as Architect writes it: no leading or trailing zeros. */
export function literalText(text: string): string {
  return q.toText(q.fromText(text) ?? q.ZERO).text;
}

/**
 * What is wrong with an expression apart from the tables it will meet: too big, too deep, too
 * many conditions, a division by zero, a rounding to nothing, no rounding at the end, a column
 * tested without its values being stated, or a test for a value the statement does not list.
 */
export function checkExpression(
  root: RuleNode,
  context: { categories: readonly RuleCategory[]; lookup: boolean },
  problems: string[],
): void {
  const size = sizeOf(root);
  if (size > RULE_LIMITS.maxNodes) {
    problems.push(
      `The rule has ${size} parts, and the most Architect takes is ${RULE_LIMITS.maxNodes}. Say the same with fewer.`,
    );
  }
  const depth = depthOf(root);
  if (depth > RULE_LIMITS.maxDepth) {
    problems.push(
      `The rule nests ${depth} operations inside one another, and the most is ${RULE_LIMITS.maxDepth}. Flatten it, for example with a product of several factors instead of products inside products.`,
    );
  }
  const conditionals = conditionalsOf(root).length;
  if (conditionals > RULE_LIMITS.maxConditionals) {
    problems.push(
      `The rule has ${conditionals} conditions (if), and the most is ${RULE_LIMITS.maxConditionals}.`,
    );
  }
  if (root.op !== 'round') {
    problems.push(
      'The last step of a rule must be a rounding to the precision of the answer, such as to the cent, so that every answer is written the same way.',
    );
  }
  for (const node of nodesOf(root)) {
    if (node.op === 'div' && q.isZero(q.fromText(node.by) ?? q.ZERO)) {
      problems.push('A division by zero can have no answer.');
    }
    if (node.op === 'round') {
      const increment = q.fromText(node.increment);
      if (increment === null || q.compare(increment, q.ZERO) <= 0) {
        problems.push(`A rounding step must be above zero, not ${node.increment}.`);
      }
    }
  }

  const declared = new Map(
    context.categories.map((category) => [refKey(category), new Set(category.values.map(foldKey))]),
  );
  const usesLookup = [...numberRefs(root), ...categoryRefs(root)].some(
    (ref) => ref.from === 'lookup',
  );
  if (usesLookup && !context.lookup) {
    problems.push('The rule reads a column from another table, but names no lookup into one.');
  }
  if (!usesLookup && context.lookup) {
    problems.push('The rule names a lookup into another table but reads nothing from it.');
  }
  for (const { when } of conditionalsOf(root)) {
    if (when.test !== 'equals' && when.test !== 'in') continue;
    const values = declared.get(refKey(when));
    if (values === undefined) {
      problems.push(
        `The rule tests ${when.column}, but does not state every value ${when.column} may have. List them in categories, so a value nobody expected is an error, not a guess.`,
      );
      continue;
    }
    const tested = when.test === 'equals' ? [when.value] : when.values;
    for (const value of tested) {
      if (!values.has(foldKey(value))) {
        problems.push(
          `The rule tests for "${value}" in ${when.column}, which is not one of its values.`,
        );
      }
    }
  }
}

/** Every operand's value, and the one a smallest or a largest chose. */
export interface Run {
  node: RuleNode;
  value: q.Q;
  /** The operands, in order. For an `if`: the first side, then the second. */
  children: Run[];
  /** For an `if`: whether the test held, the value of each side, and a threshold's own working. */
  choice?: { held: boolean; first: q.Q; second: q.Q; compared?: Run };
  /** For a smallest or a largest: the operand chosen (the first of equals) and whether alone. */
  winner?: { index: number; alone: boolean };
  /** For a rounding: the value before it. */
  before?: q.Q;
  /** For a column: its cell was empty and counted as zero, as the person said it should. */
  zeroed?: boolean;
}

/**
 * Ways to work an expression out differently, to see what a part of it does to the answer: an
 * `if` taken one way whatever its test says, and a smallest or largest worked out without one of
 * its operands.
 */
export interface Overrides {
  choice?: ReadonlyMap<RuleNode, boolean>;
  without?: ReadonlyMap<RuleNode, number>;
}

function holds(
  when: RuleCondition,
  inputs: CaseInputs,
  overrides: Overrides | undefined,
): { held: boolean; compared?: Run } {
  if (when.test === 'equals') {
    return { held: inputs.category(when) === foldKey(when.value) };
  }
  if (when.test === 'in') {
    const folded = inputs.category(when);
    return { held: when.values.some((value) => foldKey(value) === folded) };
  }
  const compared = evaluate(when.arg, inputs, overrides);
  const order = q.compare(compared.value, q.fromText(when.than) ?? q.ZERO);
  const held =
    when.test === 'gt'
      ? order > 0
      : when.test === 'gte'
        ? order >= 0
        : when.test === 'lt'
          ? order < 0
          : order <= 0;
  return { held, compared };
}

/**
 * Visits the steps a case's answer really came from: every operand of an operation, but of an
 * `if` only the test's own working and the side that applied.
 */
export function reached(run: Run, visit: (run: Run) => void): void {
  visit(run);
  if (run.node.op === 'if') {
    if (run.choice?.compared) reached(run.choice.compared, visit);
    const taken = run.choice?.held === true ? run.children[0] : run.children[1];
    if (taken !== undefined) reached(taken, visit);
    return;
  }
  for (const child of run.children) reached(child, visit);
}

/**
 * What a case's answer comes to when the `if` that was taken one way is taken the other. Whether
 * that differs from the answer is what the `if` does to it: a difference lost in the final
 * rounding is no difference to the person.
 */
export function answerTakingOtherSide(
  root: RuleNode,
  inputs: CaseInputs,
  node: RuleNode,
  held: boolean,
): q.Q {
  return evaluate(root, inputs, { choice: new Map([[node, !held]]) }).value;
}

/** What a case's answer comes to when one operand of a smallest or largest is left out. */
export function answerWithout(
  root: RuleNode,
  inputs: CaseInputs,
  node: RuleNode,
  operand: number,
): q.Q {
  return evaluate(root, inputs, { without: new Map([[node, operand]]) }).value;
}

/** Evaluates an expression for one case, keeping every step's value. */
export function evaluate(node: RuleNode, inputs: CaseInputs, overrides?: Overrides): Run {
  switch (node.op) {
    case 'num':
      return { node, value: q.fromText(node.value) ?? q.ZERO, children: [] };
    case 'col':
      return {
        node,
        value: inputs.number(node),
        children: [],
        ...(inputs.zeroed?.(node) === true ? { zeroed: true } : {}),
      };
    case 'add':
    case 'sub':
    case 'mul': {
      const children = node.args.map((arg) => evaluate(arg, inputs, overrides));
      const [first, ...rest] = children;
      const combine = node.op === 'add' ? q.add : node.op === 'sub' ? q.sub : q.mul;
      const value = rest.reduce(
        (total, next) => combine(total, next.value),
        first?.value ?? q.ZERO,
      );
      return { node, value, children };
    }
    case 'min':
    case 'max': {
      const children = node.args.map((arg) => evaluate(arg, inputs, overrides));
      const better = (a: q.Q, b: q.Q): boolean =>
        node.op === 'min' ? q.compare(a, b) < 0 : q.compare(a, b) > 0;
      const left = overrides?.without?.get(node);
      let index = -1;
      children.forEach((child, at) => {
        if (at === left) return;
        if (index < 0 || better(child.value, children[index]?.value ?? q.ZERO)) index = at;
      });
      const best = children[index]?.value ?? q.ZERO;
      const alone =
        children.filter((child, at) => at !== left && q.equal(child.value, best)).length === 1;
      return { node, value: best, children, winner: { index, alone } };
    }
    case 'div': {
      const inner = evaluate(node.arg, inputs, overrides);
      return { node, value: q.div(inner.value, q.fromText(node.by) ?? q.ONE), children: [inner] };
    }
    case 'round': {
      const inner = evaluate(node.arg, inputs, overrides);
      const increment = q.fromText(node.increment) ?? q.ONE;
      return {
        node,
        value: q.roundTo(inner.value, increment, node.mode),
        children: [inner],
        before: inner.value,
      };
    }
    case 'if': {
      const forced = overrides?.choice?.get(node);
      const { held, compared } =
        forced === undefined ? holds(node.when, inputs, overrides) : { held: forced };
      const first = evaluate(node.then, inputs, overrides);
      const second = evaluate(node.else, inputs, overrides);
      return {
        node,
        value: held ? first.value : second.value,
        children: [first, second],
        choice: {
          held,
          first: first.value,
          second: second.value,
          ...(compared === undefined ? {} : { compared }),
        },
      };
    }
  }
}
