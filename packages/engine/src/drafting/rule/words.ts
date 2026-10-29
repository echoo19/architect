import type { RuleCategory, RuleCondition, RuleNode, RuleRounding } from '@architect/shared';
import { foldKey } from '../values';
import { inWords } from '../templates/common';
import { literalText, type ColumnRef, type Run } from './expression';
import * as q from './rational';

/*
 * A rule in plain words, derived from the expression and nothing else: the sentence that states
 * it, the name of each side of a condition, and the working of one case step by step. The teacher
 * wrote the expression; Architect writes what it says.
 */

export interface WordsContext {
  /** The table a lookup reads, named in brackets after a column that comes from it. */
  lookupTable?: string;
  currency?: string;
  categories: readonly RuleCategory[];
  /** The columns whose empty cell counts as zero, because the person said it should. */
  emptyMeansZero?: readonly ColumnRef[];
}

const CURRENCY_SIGNS: Readonly<Record<string, string>> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  INR: '₹',
};

/** An amount as it is written to a person: a sign when Architect knows one, else the code. */
export function money(text: string, currency: string | undefined): string {
  if (currency === undefined) return text;
  const negative = text.startsWith('-');
  const digits = negative ? text.slice(1) : text;
  const sign = CURRENCY_SIGNS[currency];
  return `${negative ? '-' : ''}${sign === undefined ? `${currency} ${digits}` : `${sign}${digits}`}`;
}

/** A column in a sentence: its name with spaces, and the table it comes from if not the cases'. */
export function nameOf(ref: ColumnRef, ctx: WordsContext): string {
  const words = ref.column.replace(/[_-]+/g, ' ').trim();
  return ref.from === 'lookup' && ctx.lookupTable !== undefined
    ? `${words} (${ctx.lookupTable})`
    : words;
}

/** The text of a number the way a person writes it. */
export function numberText(value: q.Q): string {
  const { text, exact } = q.toText(value, 8);
  return exact ? text : `about ${text}`;
}

/** A rounding step in words: "up to a multiple of 0.5", "to the nearest cent, halves going up". */
export function roundingText(
  mode: RuleRounding,
  increment: string,
  currency: string | undefined,
): string {
  const step = literalText(increment);
  const cent = currency !== undefined && step === '0.01';
  if (mode === 'half_up') {
    const unit = step === '1' ? 'whole number' : cent ? 'cent' : `multiple of ${step}`;
    return `to the nearest ${unit}, halves going up`;
  }
  const unit = step === '1' ? 'a whole number' : cent ? 'a whole cent' : `a multiple of ${step}`;
  return `${mode} to ${unit}`;
}

const COMPARES = {
  gt: 'more than',
  gte: 'at least',
  lt: 'less than',
  lte: 'at most',
} as const;

const OPPOSITE = { gt: 'lte', gte: 'lt', lt: 'gte', lte: 'gt' } as const;

function declaredValues(when: { column: string; from: string }, ctx: WordsContext): string[] {
  const found = ctx.categories.find(
    (category) => category.from === when.from && foldKey(category.column) === foldKey(when.column),
  );
  return found?.values ?? [];
}

/**
 * A condition in words, as it reads when it holds (`held`) and when it does not: for "member is
 * yes" that is "member is no", the values the column may have apart from the ones tested. Null
 * for the side of a test that no value can make true.
 */
export function conditionText(when: RuleCondition, ctx: WordsContext, held = true): string | null {
  if (when.test === 'equals' || when.test === 'in') {
    const name = nameOf(when, ctx);
    const tested = when.test === 'equals' ? [when.value] : when.values;
    if (held) return `${name} is ${inWords(tested, 'or')}`;
    const kept = new Set(tested.map(foldKey));
    const others = declaredValues(when, ctx).filter((value) => !kept.has(foldKey(value)));
    return others.length === 0 ? null : `${name} is ${inWords(others, 'or')}`;
  }
  const test = held ? when.test : OPPOSITE[when.test];
  return `${phrase(when.arg, ctx).text} is ${COMPARES[test]} ${literalText(when.than)}`;
}

/**
 * One side of a condition, or one operand of a smallest or largest, in words: "member
 * (customers.csv) is yes", "parts cost is the larger one". `side` is `first` or `second` for an
 * `if` (the test holding, or not) and the operand's number for the other two.
 */
export function sideLabel(node: RuleNode, side: string, ctx: WordsContext): string {
  if (node.op === 'if') {
    return side === 'first'
      ? (conditionText(node.when, ctx, true) ?? 'the test holds')
      : (conditionText(node.when, ctx, false) ?? 'otherwise');
  }
  if (node.op === 'min' || node.op === 'max') {
    const arg = node.args[Number(side)];
    return arg === undefined
      ? 'one of them'
      : `${phrase(arg, ctx).text} is the ${node.op === 'min' ? 'smaller' : 'larger'} one`;
  }
  return side;
}

/** A piece of a sentence and how tightly it binds: 0 a lone name or number, 3 a whole phrase. */
interface Phrase {
  text: string;
  level: 0 | 1 | 2 | 3;
}

const CONNECTORS = { add: ' plus ', sub: ' less ', mul: ' times ' } as const;

function same(a: RuleNode, b: RuleNode): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function within(rendered: Phrase, highest: 0 | 1 | 2): string {
  return rendered.level > highest ? `(${rendered.text})` : rendered.text;
}

/** What `longer` does to `base` beyond it, when `longer` is `base` with something more done. */
type More = { op: 'add' | 'sub' | 'mul'; rest: RuleNode[] } | { op: 'div'; by: string };

function moreOf(longer: RuleNode, base: RuleNode): More | null {
  if (longer.op === 'div') return same(longer.arg, base) ? { op: 'div', by: longer.by } : null;
  if (longer.op !== 'add' && longer.op !== 'sub' && longer.op !== 'mul') return null;
  const args: readonly RuleNode[] = longer.args;
  const [first, ...others] = args;
  if (first !== undefined && same(first, base)) return { op: longer.op, rest: others };
  if (
    (longer.op === 'add' || longer.op === 'mul') &&
    base.op === longer.op &&
    base.args.length < args.length &&
    base.args.every((arg, at) => {
      const other = args[at];
      return other !== undefined && same(arg, other);
    })
  ) {
    return { op: longer.op, rest: args.slice(base.args.length) };
  }
  return null;
}

/**
 * An `if` whose one side is the other with something more done to it, such as the member's price
 * and the other price times 0.9, read as that other side with the something added: "labor times
 * 65 times 0.9 when member is yes". Null when neither side is the other with more done.
 */
function adjusted(node: Extract<RuleNode, { op: 'if' }>, ctx: WordsContext): Phrase | null {
  const sides = [
    { longer: node.then, base: node.else, held: true },
    { longer: node.else, base: node.then, held: false },
  ];
  for (const { longer, base, held } of sides) {
    const more = moreOf(longer, base);
    const when = conditionText(node.when, ctx, held);
    if (more === null || when === null) continue;
    const highest = more.op === 'add' || more.op === 'sub' ? 2 : 1;
    const start = within(phrase(base, ctx), highest);
    const added =
      more.op === 'div'
        ? ` divided by ${literalText(more.by)}`
        : more.rest
            .map((rest) => `${CONNECTORS[more.op]}${within(phrase(rest, ctx), highest)}`)
            .join('');
    return { text: `${start}${added} when ${when}`, level: 3 };
  }
  return null;
}

/** An expression as a phrase of a sentence. */
export function phrase(node: RuleNode, ctx: WordsContext): Phrase {
  switch (node.op) {
    case 'num':
      return { text: literalText(node.value), level: 0 };
    case 'col':
      return { text: nameOf(node, ctx), level: 0 };
    case 'add':
    case 'sub': {
      const parts = node.args.map((arg) => within(phrase(arg, ctx), 2));
      return { text: parts.join(CONNECTORS[node.op]), level: 2 };
    }
    case 'mul': {
      const parts = node.args.map((arg) => within(phrase(arg, ctx), 1));
      return { text: parts.join(CONNECTORS.mul), level: 1 };
    }
    case 'div':
      return {
        text: `${within(phrase(node.arg, ctx), 1)} divided by ${literalText(node.by)}`,
        level: 1,
      };
    case 'min':
    case 'max': {
      const parts = node.args.map((arg) => within(phrase(arg, ctx), 2));
      return {
        text: `the ${node.op === 'min' ? 'smaller' : 'larger'} of ${inWords(parts)}`,
        level: 3,
      };
    }
    case 'round':
      return {
        text: `${phrase(node.arg, ctx).text} rounded ${roundingText(node.mode, node.increment, ctx.currency)}`,
        level: 3,
      };
    case 'if': {
      const shorter = adjusted(node, ctx);
      if (shorter !== null) return shorter;
      const when = conditionText(node.when, ctx) ?? 'the test holds';
      return {
        text: `${within(phrase(node.then, ctx), 2)} when ${when}, otherwise ${within(phrase(node.else, ctx), 2)}`,
        level: 3,
      };
    }
  }
}

const upper = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/**
 * The rule in plain sentences, from the expression. A sum is told one part at a time, and a final
 * rounding is stated apart, so that it plainly applies to the whole.
 */
export function statementOf(root: RuleNode, ctx: WordsContext): string {
  const body = root.op === 'round' ? root.arg : root;
  const sentences: string[] = [];
  if (body.op === 'add' || body.op === 'sub') {
    const [first, ...rest] = body.args;
    if (first !== undefined) sentences.push(`Start with ${phrase(first, ctx).text}.`);
    for (const next of rest) {
      sentences.push(`${body.op === 'add' ? 'Add' : 'Take away'} ${phrase(next, ctx).text}.`);
    }
  } else {
    sentences.push(`${upper(phrase(body, ctx).text)}.`);
  }
  if (root.op === 'round') {
    sentences.push(
      `The result is rounded ${roundingText(root.mode, root.increment, ctx.currency)}.`,
    );
  }
  // What an empty cell counts as is part of the rule, and said where the person reads it.
  for (const ref of ctx.emptyMeansZero ?? []) {
    sentences.push(`An empty ${nameOf(ref, ctx)} counts as 0, as you said.`);
  }
  return sentences.join(' ');
}

/** One line of the working of a case. */
export interface Step {
  text: string;
  value: string;
}

/** How an operand shows in a step: a column with its value, a number as written, a result as is. */
function operand(run: Run, ctx: WordsContext): string {
  if (run.node.op === 'col') {
    const shown = run.zeroed === true ? 'empty, so 0' : numberText(run.value);
    return `${nameOf(run.node, ctx)} (${shown})`;
  }
  if (run.node.op === 'num') return literalText(run.node.value);
  return numberText(run.value);
}

/**
 * The working of one case: every step that led to its answer, in order, each with the value it
 * came to. Only the side of a condition that applied is worked through.
 */
export function stepsOf(run: Run, ctx: WordsContext): Step[] {
  const steps: Step[] = [];
  const visit = (current: Run): void => {
    const { node } = current;
    if (node.op === 'num' || node.op === 'col') return;
    if (node.op === 'if') {
      const held = current.choice?.held ?? true;
      if (current.choice?.compared) visit(current.choice.compared);
      const chosen = held ? current.children[0] : current.children[1];
      if (chosen !== undefined) visit(chosen);
      const sentence = conditionText(node.when, ctx, held);
      steps.push({
        text: `${sentence === null ? 'The test' : upper(sentence)}, so use ${numberText(current.value)}`,
        value: numberText(current.value),
      });
      return;
    }
    current.children.forEach(visit);
    const parts = current.children.map((child) => operand(child, ctx));
    const value = numberText(current.value);
    switch (node.op) {
      case 'add':
      case 'sub':
      case 'mul':
        steps.push({ text: upper(parts.join(CONNECTORS[node.op])), value });
        break;
      case 'div':
        steps.push({ text: upper(`${parts.join('')} divided by ${literalText(node.by)}`), value });
        break;
      case 'min':
      case 'max':
        steps.push({
          text: `The ${node.op === 'min' ? 'smaller' : 'larger'} of ${inWords(parts)}`,
          value,
        });
        break;
      case 'round':
        steps.push({
          text: `${upper(parts.join(''))}, rounded ${roundingText(node.mode, node.increment, ctx.currency)}`,
          value,
        });
        break;
    }
  };
  visit(run);
  return steps;
}
