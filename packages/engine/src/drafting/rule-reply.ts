import {
  RULE_LIMITS,
  RuleSpecSchema,
  type JsonSchemaObject,
  type RuleCategory,
  type RuleCondition,
  type RuleFrom,
  type RuleNode,
  type RuleRounding,
  type RuleSpec,
} from '@architect/shared';
import { z } from 'zod';
import type { Attached } from './files';
import { cleanText, foldKey } from './values';

/*
 * How the teacher hands over a rule: the part of its reply that carries one, and what becomes of
 * it. The expression comes as one uniform kind of step (an `op` and the few fields that op uses,
 * the rest empty), so the format the teacher is held to does not need a schema that refers to
 * itself. Architect turns it into the typed expression of `@architect/shared`, or says what is
 * wrong with it, and holds the passages it quotes to the policy word for word.
 */

export interface WireNode {
  op: string;
  value?: string | undefined;
  column?: string | undefined;
  from?: string | undefined;
  values?: string[] | undefined;
  mode?: string | undefined;
  args?: WireNode[] | undefined;
}

const WireNodeSchema: z.ZodType<WireNode> = z.lazy(() =>
  z.object({
    op: z.string(),
    value: z.string().optional(),
    column: z.string().optional(),
    from: z.string().optional(),
    values: z.array(z.string()).optional(),
    mode: z.string().optional(),
    args: z.array(WireNodeSchema).optional(),
  }),
);

export const RuleReplySchema = z.object({
  answerName: z.string(),
  currency: z.string(),
  lookupTable: z.string(),
  lookupKey: z.string(),
  matchColumn: z.string(),
  familyColumn: z.string(),
  categories: z.array(
    z.object({ column: z.string(), from: z.string(), values: z.array(z.string()) }),
  ),
  sources: z.array(z.object({ file: z.string(), passage: z.string() })),
  ambiguities: z.array(
    z.object({ question: z.string(), options: z.array(z.string()), changesAnswers: z.boolean() }),
  ),
  expression: WireNodeSchema,
});
export type RuleReply = z.infer<typeof RuleReplySchema>;

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

/** Levels of steps the format allows: six nested operations and a column or number below them. */
const LEVELS = RULE_LIMITS.maxDepth + 1;

const text = (description: string) => ({ type: 'string', description });
const list = (description: string, items: object = { type: 'string' }) => ({
  type: 'array',
  description,
  items,
});

function objectOf(properties: Record<string, object>): JsonSchemaObject {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

/** One step of an expression, with as many levels of steps inside it as `levels` says. */
function stepSchema(levels: number): JsonSchemaObject {
  return objectOf({
    op: { type: 'string', enum: [...OPS, ''], description: 'The operation. Empty when unused.' },
    value: text(
      'num: the number. div: the divisor. round: the step size. equals, gt, gte, lt, lte: what to compare with. Else empty.',
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
    args:
      levels > 1
        ? list(
            'The steps this one is made of, in order. Empty for num, col, equals and in.',
            stepSchema(levels - 1),
          )
        : list('Leave empty.'),
  });
}

/** The rule part of a task type in the reply format: filled for a rule, empty for the others. */
export function ruleSchema(): JsonSchemaObject {
  return objectOf({
    answerName: text('rule: the name of the number in the answer, such as "total". Else empty.'),
    currency: text(
      'rule: the ISO code of the currency when the answer is money, such as USD. Else empty.',
    ),
    lookupTable: text(
      'rule: the CSV file of the other table a row is read from, if the rule needs one. Else empty.',
    ),
    lookupKey: text('rule: the column of that table that holds the key, unique there. Else empty.'),
    matchColumn: text(
      "rule: the column of the cases' table that holds the key to find. Else empty.",
    ),
    familyColumn: text(
      'rule: the column naming the business entity whose reuse would reveal an answer, such as the customer. Empty if each row is its own.',
    ),
    categories: list(
      'rule: each column the rule tests, with every value it may have.',
      objectOf({
        column: text('The column.'),
        from: {
          type: 'string',
          enum: ['row', 'lookup'],
          description: "The cases' table, or the looked-up table.",
        },
        values: list('Every value the column may have, spelled as the table spells it.'),
      }),
    ),
    sources: list(
      'rule: passages copied word for word from the policy or from what the person wrote or answered.',
      objectOf({
        file: text('The text file\'s name, or "description", or "answers".'),
        passage: text('The words, copied exactly.'),
      }),
    ),
    ambiguities: list(
      'rule: things the policy leaves open that would change an answer. Empty if none.',
      objectOf({
        question: text('A plain question for the person.'),
        options: list('Two to four short answers.'),
        changesAnswers: {
          type: 'boolean',
          description: 'True when different answers would give different numbers.',
        },
      }),
    ),
    expression: stepSchema(LEVELS),
  });
}

const NUMBER = /^-?\d{1,12}(?:\.\d{1,8})?$/;

function fromOf(value: string | undefined): RuleFrom {
  return value === 'lookup' ? 'lookup' : 'row';
}

/** Turns what the teacher sent for a step into a typed step, or says what is wrong at `where`. */
function toNode(wire: WireNode, where: string, problems: string[]): RuleNode | null {
  const args = wire.args ?? [];
  const value = cleanText(wire.value);
  const need = (count: number | [number, number]): boolean => {
    const [least, most] = typeof count === 'number' ? [count, count] : count;
    if (args.length >= least && args.length <= most) return true;
    problems.push(
      `Step ${where} is "${wire.op}" with ${args.length} ${args.length === 1 ? 'step' : 'steps'} inside it, and it takes ${least === most ? least : `${least} to ${most}`}.`,
    );
    return false;
  };
  const inside = (): RuleNode[] | null => {
    const nodes = args.map((arg, at) => toNode(arg, `${where}.${at + 1}`, problems));
    return nodes.every((node) => node !== null) ? (nodes as RuleNode[]) : null;
  };
  switch (wire.op) {
    case 'num':
      if (!NUMBER.test(value)) {
        problems.push(
          `Step ${where} is a number, but "${value}" is not one. Write digits and at most one point, such as 65 or 0.1.`,
        );
        return null;
      }
      return { op: 'num', value };
    case 'col': {
      const column = cleanText(wire.column);
      if (column === '') {
        problems.push(`Step ${where} reads a column but names none.`);
        return null;
      }
      return { op: 'col', column, from: fromOf(wire.from) };
    }
    case 'add':
    case 'mul':
    case 'min':
    case 'max': {
      if (!need([2, RULE_LIMITS.maxOperands])) return null;
      const nodes = inside();
      return nodes === null ? null : { op: wire.op, args: nodes };
    }
    case 'sub': {
      if (!need(2)) return null;
      const nodes = inside();
      const [first, second] = nodes ?? [];
      return first === undefined || second === undefined
        ? null
        : { op: 'sub', args: [first, second] };
    }
    case 'div': {
      if (!need(1)) return null;
      const [arg] = inside() ?? [];
      if (arg === undefined) return null;
      if (!NUMBER.test(value)) {
        problems.push(
          `Step ${where} divides by "${value}", which is not a number. Divide by a number such as 12.`,
        );
        return null;
      }
      return { op: 'div', arg, by: value };
    }
    case 'round': {
      if (!need(1)) return null;
      const [arg] = inside() ?? [];
      if (arg === undefined) return null;
      if (!NUMBER.test(value)) {
        problems.push(
          `Step ${where} rounds to "${value}", which is not a number. Give the step size, such as 0.01.`,
        );
        return null;
      }
      if (wire.mode !== 'up' && wire.mode !== 'down' && wire.mode !== 'half_up') {
        problems.push(`Step ${where} is a rounding with no mode. Use up, down or half_up.`);
        return null;
      }
      return { op: 'round', arg, increment: value, mode: wire.mode as RuleRounding };
    }
    case 'if': {
      if (!need(3)) return null;
      const [test, first, second] = args;
      if (test === undefined || first === undefined || second === undefined) return null;
      const when = toCondition(test, `${where}.1`, problems);
      const then = toNode(first, `${where}.2`, problems);
      const otherwise = toNode(second, `${where}.3`, problems);
      return when === null || then === null || otherwise === null
        ? null
        : { op: 'if', when, then, else: otherwise };
    }
    case '':
      problems.push(`Step ${where} has no operation.`);
      return null;
    default:
      problems.push(
        `Step ${where} is "${wire.op}", which is not an operation. The operations are num, col, add, sub, mul, div, min, max, round and if.`,
      );
      return null;
  }
}

function toCondition(wire: WireNode, where: string, problems: string[]): RuleCondition | null {
  const column = cleanText(wire.column);
  const from = fromOf(wire.from);
  switch (wire.op) {
    case 'equals': {
      const value = cleanText(wire.value);
      if (column === '' || value === '') {
        problems.push(`Test ${where} (equals) needs a column and a value.`);
        return null;
      }
      return { test: 'equals', column, from, value };
    }
    case 'in': {
      const values = (wire.values ?? []).map(cleanText).filter((value) => value !== '');
      if (column === '' || values.length === 0) {
        problems.push(`Test ${where} (in) needs a column and the values that make it true.`);
        return null;
      }
      return { test: 'in', column, from, values: [...new Set(values)] };
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const than = cleanText(wire.value);
      const [first] = wire.args ?? [];
      if (first === undefined || !NUMBER.test(than)) {
        problems.push(
          `Test ${where} (${wire.op}) needs one step to compare and a number to compare it with.`,
        );
        return null;
      }
      const arg = toNode(first, `${where}.1`, problems);
      return arg === null ? null : { test: wire.op, arg, than };
    }
    default:
      problems.push(
        `The first step inside an if (${where}) must be a test: equals, in, gt, gte, lt or lte, not "${wire.op}". There is no "not": test for the values that count.`,
      );
      return null;
  }
}

/** What the person has said, for a passage to be found in. */
export interface Said {
  description: string;
  answers: string;
}

/** Text as it is compared for a quotation: spaces, quotes and emphasis marks set aside. */
function plain(text: string): string {
  return cleanText(text).replace(/[*`]/g, '').toLowerCase();
}

/** Where the policy and the person's words can be quoted from, by the name a passage gives. */
function quotable(attached: Attached, said: Said): Map<string, string> {
  return new Map<string, string>([
    ...attached.files
      .filter((file) => file.kind === 'text')
      .map((file) => [file.name, plain(file.text ?? '')] as const),
    ['description', plain(said.description)],
    ['answers', plain(said.answers)],
  ]);
}

/**
 * The passages a rule quotes, each found word for word where it says, or where else it is. A
 * passage that is nowhere in the policy or the person's words is a problem: the rule would rest
 * on something that was never said.
 */
export function checkSources(
  sources: RuleReply['sources'],
  attached: Attached,
  said: Said,
  who: string,
  problems: string[],
): RuleSpec['sources'] {
  const places = quotable(attached, said);
  const kept: RuleSpec['sources'] = [];
  for (const source of sources) {
    const passage = cleanText(source.passage)
      .replace(/^[-*•\s]+/u, '')
      .trim();
    if (passage === '') continue;
    if (passage.length > RULE_LIMITS.maxPassageChars) {
      problems.push(
        `${who}: a passage is longer than ${RULE_LIMITS.maxPassageChars} characters. Quote just the sentence the rule rests on.`,
      );
      continue;
    }
    const wanted = plain(passage);
    const named = [...places].find(([name]) => foldKey(name) === foldKey(source.file));
    const where = named?.[1].includes(wanted)
      ? named[0]
      : [...places].find(([, body]) => body.includes(wanted))?.[0];
    if (where === undefined) {
      problems.push(
        `${who}: the passage "${passage.length > 80 ? `${passage.slice(0, 77)}...` : passage}" is not in the policy or in what the person said, word for word. Quote it exactly, or leave that part out of the rule.`,
      );
      continue;
    }
    if (!kept.some((item) => item.file === where && item.passage === passage)) {
      kept.push({ file: where, passage });
    }
  }
  if (kept.length === 0 && sources.length === 0) {
    problems.push(
      `${who}: a rule has to quote the passages of the policy it comes from, word for word, in sources.`,
    );
  }
  return kept;
}

export interface Settled {
  spec: RuleSpec;
  /** Open questions that change an answer, which Architect puts to the person before any task. */
  blocking: { question: string; options: string[] }[];
  /** Open questions that don't change an answer, which are told as left open. */
  left: string[];
}

/** The pieces of a task type that every template names, which a rule shares. */
export interface RuleBase {
  table: string;
  keyColumn: string;
  request: string;
}

function distinct(items: readonly string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = foldKey(item);
    if (key === '' || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A rule from what the teacher sent: the typed spec, held to its schema, with the passages found
 * and the open questions sorted into those that must be answered and those that are only told.
 */
export function settleRule(
  reply: RuleReply | undefined,
  base: RuleBase,
  tableNames: readonly string[],
  context: { attached: Attached; said: Said },
  who: string,
  problems: string[],
): Settled | undefined {
  if (reply === undefined) {
    problems.push(`${who} is a rule: it needs its rule.`);
    return undefined;
  }
  const before = problems.length;
  const expression = toNode(reply.expression, '1', problems);
  const named = (file: string): string | undefined =>
    tableNames.find((name) => foldKey(name) === foldKey(file.replace(/^.*[\\/]/, '')));
  const lookupFile = cleanText(reply.lookupTable);
  const lookupTable = lookupFile === '' ? undefined : named(lookupFile);
  if (lookupFile !== '' && lookupTable === undefined) {
    problems.push(
      `${who}: the lookup names "${lookupFile}", which isn't one of the attached CSV files (${tableNames.join(', ')}).`,
    );
  }
  if (
    lookupTable !== undefined &&
    (cleanText(reply.lookupKey) === '' || cleanText(reply.matchColumn) === '')
  ) {
    problems.push(`${who}: a lookup needs lookupKey and matchColumn.`);
  }
  const sources = checkSources(reply.sources, context.attached, context.said, who, problems);
  const categories: RuleCategory[] = reply.categories
    .filter((category) => cleanText(category.column) !== '')
    .map((category) => ({
      column: cleanText(category.column),
      from: fromOf(category.from),
      values: distinct(category.values.map(cleanText)).slice(0, RULE_LIMITS.maxCategoryValues),
    }))
    .filter((category) => category.values.length > 0);

  const ambiguities = reply.ambiguities.map((item) => ({
    question: cleanText(item.question),
    options: distinct(item.options.map(cleanText)).slice(0, 4),
    changesAnswers: item.changesAnswers,
  }));
  for (const item of ambiguities) {
    if (item.question === '' || (item.changesAnswers && item.options.length < 2)) {
      problems.push(
        `${who}: an open question that changes an answer needs the question and 2 to 4 different options.`,
      );
    }
  }
  if (expression === null || problems.length > before) return undefined;

  const currency = cleanText(reply.currency).toUpperCase();
  const family = cleanText(reply.familyColumn);
  const spec = {
    template: 'rule' as const,
    table: base.table,
    keyColumn: base.keyColumn,
    request: base.request,
    answerName: cleanText(reply.answerName),
    ...(currency === '' ? {} : { currency }),
    ...(lookupTable === undefined
      ? {}
      : {
          lookup: {
            table: lookupTable,
            keyColumn: cleanText(reply.lookupKey),
            matchColumn: cleanText(reply.matchColumn),
          },
        }),
    categories,
    expression,
    sources,
    ...(family === '' ? {} : { familyColumn: family }),
  };
  const parsed = RuleSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    problems.push(
      `${who}: the rule isn't in the shape asked for${issue === undefined ? '' : ` (${issue.path.join('.')}: ${issue.message})`}.`,
    );
    return undefined;
  }
  return {
    spec: parsed.data,
    blocking: ambiguities
      .filter((item) => item.changesAnswers)
      .map(({ question, options }) => ({ question, options })),
    left: ambiguities.filter((item) => !item.changesAnswers).map((item) => item.question),
  };
}
