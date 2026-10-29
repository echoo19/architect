import type { RuleNode, RuleRounding, RuleStep } from '@architect/shared';
import { inWords } from '../templates/common';
import { numberRefs, refKey, type ColumnRef } from './expression';
import * as q from './rational';
import {
  bracketed,
  conditionText,
  phrase,
  roundingParts,
  zeroNote,
  zeroRefs,
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
type Arithmetic = 'add' | 'sub' | 'mul' | 'div';

/** Something done to an amount that already exists. */
export type Doing =
  /** Something added to it, taken from it, or multiplied or divided into it. */
  | { kind: 'do'; op: Arithmetic; operand: RuleNode }
  /** It is held to the smaller or the larger of itself and others. */
  | { kind: 'best'; op: 'min' | 'max'; others: RuleNode[] }
  /** It is rounded. The rounding is told apart from what it rounds, so two of them can be alike. */
  | { kind: 'round'; increment: string; mode: RuleRounding };

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

/**
 * A test: what its two sides start with and what they end with is said once, before and after the
 * test, and only what differs in between is said under it.
 */
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
  // What both sides end with, such as a rounding written on each, is done once after the test.
  let tail = 0;
  while (tail < first.length && tail < second.length) {
    const one = first[first.length - 1 - tail];
    const other = second[second.length - 1 - tail];
    if (one === undefined || other === undefined || !same(one, other)) break;
    tail += 1;
  }
  const ends = first.slice(first.length - tail);
  const firstOnly = first.slice(0, first.length - tail);
  const secondOnly = second.slice(0, second.length - tail);
  const start = then.slice(0, shared);
  if (firstOnly.length === 0 && secondOnly.length === 0) return [...start, ...ends];
  const split = splitBy(node, firstOnly, secondOnly, ctx);
  return split === null ? [{ kind: 'pick', node }] : [...start, split, ...ends];
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
      return [
        ...linksOf(node.arg, ctx),
        { kind: 'round', increment: node.increment, mode: node.mode },
      ];
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
function roundedHow(
  rounding: { increment: string; mode: RuleRounding },
  ctx: WordsContext,
): string {
  const { how, tie } = roundingParts(rounding.mode, rounding.increment, ctx.currency);
  return tie === null ? how : `${how}; ${tie}`;
}

/** An operand after "add", "multiply by" and the like: bare when it is a product, else in brackets. */
function operandOf(node: RuleNode, ctx: WordsContext): string {
  return bracketed(node, ctx, 1);
}

const comparative = (op: 'min' | 'max'): string => (op === 'min' ? 'smaller' : 'larger');

const VERBS: Record<Arithmetic, string> = {
  add: 'add',
  sub: 'subtract',
  mul: 'multiply by',
  div: 'divide by',
};

/** The smallest factor that reads as a discount, which is half off. Under it a factor is a share. */
const SMALLEST_DISCOUNT_FACTOR = q.fraction(1n, 2n);

/**
 * How much a factor takes off, when it is a discount as a person gives one: from one half up to
 * but not including one, with a percentage off of at most one decimal place. 0.9 is 10% off, 0.85
 * is 15% and 0.875 is 12.5%. Null for any other factor, which is said as the multiplication it
 * is: 1.1 is no discount, 0.8333 is no clean percentage, and 0.05 is as likely a fee of 5% as it
 * is 95% off. Only the words differ; what the rule works out is the same.
 */
function percentOff(operand: RuleNode): string | null {
  if (operand.op !== 'num') return null;
  const factor = q.fromText(operand.value);
  if (
    factor === null ||
    q.compare(factor, SMALLEST_DISCOUNT_FACTOR) < 0 ||
    q.compare(factor, q.ONE) >= 0
  ) {
    return null;
  }
  const off = q.mul(q.sub(q.ONE, factor), q.fraction(100n));
  return q.mul(off, q.fraction(10n)).d === 1n ? q.toText(off).text : null;
}

/** What a link does to the amount so far, as the middle of a sentence: "multiply by 65". */
function doing(link: Doing, ctx: WordsContext): string {
  switch (link.kind) {
    case 'do': {
      const off = link.op === 'mul' ? percentOff(link.operand) : null;
      return off === null
        ? `${VERBS[link.op]} ${operandOf(link.operand, ctx)}`
        : `take ${off}% off`;
    }
    case 'best':
      return `take the ${comparative(link.op)} of ${inWords([
        'the result',
        ...link.others.map((other) => operandOf(other, ctx)),
      ])}`;
    case 'round':
      return `round the result ${roundedHow(link, ctx)}`;
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
  if (next.kind === 'round') return `Round ${what} ${roundedHow(next, ctx)}.`;
  if (next.kind === 'do' && (next.op === 'mul' || next.op === 'div')) {
    const off = next.op === 'mul' ? percentOff(next.operand) : null;
    if (off !== null) return `Take ${off}% off ${what}.`;
    const verb = next.op === 'mul' ? 'Multiply' : 'Divide';
    return `${verb} ${what} by ${operandOf(next.operand, ctx)}.`;
  }
  if (next.kind === 'best') {
    const others = next.others.map((other) => operandOf(other, ctx));
    return `Take the ${comparative(next.op)} of ${inWords([what, ...others])}.`;
  }
  return null;
}

/** Whether any of these parts reads a column. */
function reads(nodes: readonly RuleNode[], ref: ColumnRef): boolean {
  return nodes.some((node) => numberRefs(node).some((found) => refKey(found) === refKey(ref)));
}

/**
 * The rule as numbered steps. Each is a sentence about the amount the steps above it came to. A
 * step that reads a column the person said something counts as zero in (an empty cell, or a mark
 * such as N/A) says so beside it, in the first step that reads the column, and a step that names a
 * file in brackets lists it, so a screen can set it quietly. The same words as the rule in one
 * sentence, a step at a time.
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
    const notes = zeroRefs(ctx).flatMap((ref) => {
      const said = zeroNote(ref, ctx);
      if (said === null || noted.has(refKey(ref)) || !reads(named, ref)) return [];
      noted.add(refKey(ref));
      return [said];
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
