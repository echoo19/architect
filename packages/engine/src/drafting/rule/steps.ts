import type { RuleNode, RuleStep } from '@architect/shared';
import { inWords } from '../templates/common';
import { numberRefs, refKey, type ColumnRef } from './expression';
import * as q from './rational';
import {
  bracketed,
  conditionText,
  nameOf,
  phrase,
  roundingParts,
  type WordsContext,
} from './words';

/*
 * A rule as numbered steps in plain words, from the expression alone. The expression is read as a
 * chain: what the amount starts as, then each thing done to it in turn, which is how a person
 * works a price out on paper. Where a test splits the chain, the part the two sides share is said
 * once and only what differs is said under the test; where nothing is shared, or what differs is
 * not a thing done to the amount, the test is said as a plain sentence about each side. Nothing
 * here guesses: a part it can't say as a step is said in the same words the sentence form uses.
 */

type IfNode = Extract<RuleNode, { op: 'if' }>;
type RoundNode = Extract<RuleNode, { op: 'round' }>;
type Arithmetic = 'add' | 'sub' | 'mul' | 'div';

/** Something done to an amount that already exists. */
export type Doing =
  /** Something added to it, taken from it, or multiplied or divided into it. */
  | { kind: 'do'; op: Arithmetic; operand: RuleNode }
  /** It is held to the smaller or the larger of itself and others. */
  | { kind: 'best'; op: 'min' | 'max'; others: RuleNode[] }
  | { kind: 'round'; node: RoundNode };

/** One thing in the chain a rule comes to. */
export type Link =
  | Doing
  /** The amount begins as a column or a number. */
  | { kind: 'start'; node: RuleNode }
  /** The amount begins as one of two things, by a test, with nothing in common to start from. */
  | { kind: 'pick'; node: IfNode }
  /**
   * A test decides what is done next to the amount: `then` when the test as the person reads it
   * (`when`) holds, `otherwise` when it does not. The test is the node's, or its opposite when
   * `negate` is set, which is how a side that does nothing is left out.
   */
  | {
      kind: 'when';
      node: IfNode;
      negate: boolean;
      when: string;
      then: Doing[];
      otherwise: Doing[];
    };

const same = (a: Link, b: Link): boolean => JSON.stringify(a) === JSON.stringify(b);

function allDoing(links: readonly Link[]): links is Doing[] {
  return links.every((link) => link.kind === 'do' || link.kind === 'best' || link.kind === 'round');
}

/** What an operation leaves alone: multiplying or dividing by one, adding or taking away zero. */
function leavesAlone(op: Arithmetic, operand: RuleNode): boolean {
  if (operand.op !== 'num') return false;
  const value = q.fromText(operand.value);
  if (value === null) return false;
  return op === 'mul' || op === 'div' ? q.equal(value, q.ONE) : q.isZero(value);
}

/**
 * A test over what is done when it holds (`first`) and what is done when it does not (`second`).
 * The side that does something is the one the test is said for, so a side that does nothing
 * needs the test said the other way round, and some tests can't be (a column tested for every
 * value it may have). Null then, and when neither side does anything.
 */
function splitBy(
  node: IfNode,
  first: Doing[],
  second: Doing[],
  ctx: WordsContext,
): Extract<Link, { kind: 'when' }> | null {
  if (first.length > 0) {
    const when = conditionText(node.when, ctx, true) ?? 'the test holds';
    return { kind: 'when', node, negate: false, when, then: first, otherwise: second };
  }
  const unless = conditionText(node.when, ctx, false);
  return second.length === 0 || unless === null
    ? null
    : { kind: 'when', node, negate: true, when: unless, then: second, otherwise: [] };
}

/** An arithmetic operation with its operand; a test as the operand is spread over its two sides. */
function arithmetic(op: Arithmetic, operand: RuleNode, ctx: WordsContext): Link[] {
  if (operand.op === 'if' && operand.then.op !== 'if' && operand.else.op !== 'if') {
    const side = (value: RuleNode): Doing[] =>
      leavesAlone(op, value) ? [] : [{ kind: 'do', op, operand: value }];
    const first = side(operand.then);
    const second = side(operand.else);
    if (first.length === 0 && second.length === 0) return [];
    const split = splitBy(operand, first, second, ctx);
    if (split !== null) return [split];
  }
  return [{ kind: 'do', op, operand }];
}

/** A test: what its two sides share is said once, and what they differ in under the test. */
function conditional(node: IfNode, ctx: WordsContext): Link[] {
  const then = linksOf(node.then, ctx);
  const otherwise = linksOf(node.else, ctx);
  const apart = then.findIndex((link, at) => {
    const other = otherwise[at];
    return other === undefined || !same(link, other);
  });
  const shared = apart === -1 ? then.length : apart;
  const first = then.slice(shared);
  const second = otherwise.slice(shared);
  if (shared === 0 || !allDoing(first) || !allDoing(second)) return [{ kind: 'pick', node }];
  if (first.length === 0 && second.length === 0) return then.slice(0, shared);
  const split = splitBy(node, first, second, ctx);
  return split === null ? [{ kind: 'pick', node }] : [...then.slice(0, shared), split];
}

/** The chain a rule comes to, from the amount it begins as to the last thing done to it. */
export function linksOf(node: RuleNode, ctx: WordsContext): Link[] {
  switch (node.op) {
    case 'num':
    case 'col':
      return [{ kind: 'start', node }];
    case 'add':
    case 'mul': {
      const op = node.op === 'add' ? 'add' : 'mul';
      const [first, ...rest] = node.args;
      return [
        ...(first === undefined ? [] : linksOf(first, ctx)),
        ...rest.flatMap((operand) => arithmetic(op, operand, ctx)),
      ];
    }
    case 'sub':
      return [...linksOf(node.args[0], ctx), ...arithmetic('sub', node.args[1], ctx)];
    case 'div':
      return [
        ...linksOf(node.arg, ctx),
        { kind: 'do', op: 'div', operand: { op: 'num', value: node.by } },
      ];
    case 'min':
    case 'max': {
      const [first, ...others] = node.args;
      return [
        ...(first === undefined ? [] : linksOf(first, ctx)),
        { kind: 'best', op: node.op, others },
      ];
    }
    case 'round':
      return [...linksOf(node.arg, ctx), { kind: 'round', node }];
    case 'if':
      return conditional(node, ctx);
  }
}

/** The parts of the rule a link names in its words, to find what each step reads. */
function namedBy(link: Link): RuleNode[] {
  switch (link.kind) {
    case 'start':
    case 'pick':
      return [link.node];
    case 'do':
      return [link.operand];
    case 'best':
      return link.others;
    case 'round':
      return [];
    case 'when':
      return [
        ...(link.node.when.test === 'equals' || link.node.when.test === 'in'
          ? []
          : [link.node.when.arg]),
        ...link.then.flatMap(namedBy),
        ...link.otherwise.flatMap(namedBy),
      ];
  }
}

/** How a rounding is said: "up to a multiple of 0.5", "to the nearest cent; half a cent rounds up". */
function roundedHow(node: RoundNode, ctx: WordsContext): string {
  const { how, tie } = roundingParts(node.mode, node.increment, ctx.currency);
  return tie === null ? how : `${how}; ${tie}`;
}

/** An operand after "add", "multiply by" and the like: bare when it is a product, else in brackets. */
function operandOf(node: RuleNode, ctx: WordsContext): string {
  return bracketed(node, ctx, 1);
}

const larger = (op: 'min' | 'max'): string => (op === 'min' ? 'smaller' : 'larger');

const VERBS: Record<Arithmetic, string> = {
  add: 'add',
  sub: 'subtract',
  mul: 'multiply by',
  div: 'divide by',
};

/** What a link does to the amount so far, as the middle of a sentence: "multiply by 0.9". */
function doing(link: Doing, ctx: WordsContext): string {
  switch (link.kind) {
    case 'do':
      return `${VERBS[link.op]} ${operandOf(link.operand, ctx)}`;
    case 'best':
      return `take the ${larger(link.op)} of ${inWords([
        'the result',
        ...link.others.map((other) => operandOf(other, ctx)),
      ])}`;
    case 'round':
      return `round the result ${roundedHow(link.node, ctx)}`;
  }
}

const sentence = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/** A side of a test as the object of "use": a nested test is told in brackets. */
function used(node: RuleNode, ctx: WordsContext): string {
  const text = phrase(node, ctx).text;
  return node.op === 'if' ? `(${text})` : text;
}

/** The sentence a link is on its own, about the amount the steps above it came to. */
function said(link: Link, ctx: WordsContext): string {
  switch (link.kind) {
    case 'start':
      return `Start with ${phrase(link.node, ctx).text}.`;
    case 'pick': {
      const { node } = link;
      const when = conditionText(node.when, ctx, true) ?? 'the test holds';
      return `When ${when}, use ${used(node.then, ctx)}. Otherwise, use ${used(node.else, ctx)}.`;
    }
    case 'when': {
      const list = (items: readonly Doing[]): string =>
        items.map((item) => doing(item, ctx)).join(', then ');
      const first = sentence(`when ${link.when}, ${list(link.then)}`);
      return link.otherwise.length === 0
        ? first
        : `${first} ${sentence(`otherwise, ${list(link.otherwise)}`)}`;
    }
    default:
      return sentence(doing(link, ctx));
  }
}

/**
 * The sentence for a column or number the amount starts as, together with the first thing done to
 * it, when one sentence says both: "Round labor hours up to a multiple of 0.5." Null when the
 * first thing is better said on its own, such as adding to the start.
 */
function together(start: RuleNode, next: Link, ctx: WordsContext): string | null {
  const what = phrase(start, ctx).text;
  if (next.kind === 'round') return `Round ${what} ${roundedHow(next.node, ctx)}.`;
  if (next.kind === 'do' && (next.op === 'mul' || next.op === 'div')) {
    const verb = next.op === 'mul' ? 'Multiply' : 'Divide';
    return `${verb} ${what} by ${operandOf(next.operand, ctx)}.`;
  }
  if (next.kind === 'best') {
    const others = next.others.map((other) => operandOf(other, ctx));
    return `Take the ${larger(next.op)} of ${inWords([what, ...others])}.`;
  }
  return null;
}

/** Whether any of these parts reads a column. */
function reads(nodes: readonly RuleNode[], ref: ColumnRef): boolean {
  return nodes.some((node) => numberRefs(node).some((found) => refKey(found) === refKey(ref)));
}

/**
 * The rule as numbered steps. Each is a sentence about the amount the steps above it came to. A
 * step that reads a column the person said counts as zero when empty says so beside it, in the
 * first step that reads the column, and a step that names a file in brackets lists it, so a
 * screen can set it quietly. The same words as the rule in one sentence, a step at a time.
 */
export function ruleSteps(root: RuleNode, ctx: WordsContext): RuleStep[] {
  const links = linksOf(root, ctx);
  const drafted: { text: string; named: RuleNode[] }[] = [];
  let at = 0;
  while (at < links.length) {
    const link = links[at] as Link;
    const next = links[at + 1];
    const joined =
      link.kind === 'start' && next !== undefined ? together(link.node, next, ctx) : null;
    if (joined !== null && next !== undefined) {
      drafted.push({ text: joined, named: [...namedBy(link), ...namedBy(next)] });
      at += 2;
    } else {
      drafted.push({ text: said(link, ctx), named: namedBy(link) });
      at += 1;
    }
  }

  const noted = new Set<string>();
  return drafted.map(({ text, named }) => {
    const notes = (ctx.emptyMeansZero ?? []).flatMap((ref) => {
      if (noted.has(refKey(ref)) || !reads(named, ref)) return [];
      noted.add(refKey(ref));
      return [`An empty ${nameOf(ref, ctx)} counts as 0, as you said.`];
    });
    const note = notes.join(' ');
    const files =
      ctx.lookupTable !== undefined && `${text} ${note}`.includes(`(${ctx.lookupTable})`)
        ? [ctx.lookupTable]
        : [];
    return {
      text,
      ...(files.length === 0 ? {} : { files }),
      ...(note === '' ? {} : { note }),
    };
  });
}
