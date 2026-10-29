import {
  RULE_LIMITS,
  RuleSpecSchema,
  type JsonSchemaObject,
  type RuleCategory,
  type RuleFrom,
  type RuleSpec,
} from '@architect/shared';
import { z } from 'zod';
import type { Attached } from './files';
import { list, objectOf, text } from './json-parts';
import { expandSteps, stepSchema, WireStepSchema } from './rule-steps';
import { cleanText, foldKey } from './values';

/*
 * How the teacher hands over a rule: the part of its reply that carries one, and what becomes of
 * it. The expression comes as steps that name one another by id (`rule-steps`), which Architect
 * turns into the typed expression of `@architect/shared` or sends back with what is wrong, and
 * the passages the rule quotes are held to the policy word for word.
 */

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
  steps: z.array(WireStepSchema),
  result: z.string(),
});
export type RuleReply = z.infer<typeof RuleReplySchema>;

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
    steps: list(
      'rule: the steps the answer is worked out in, each naming the steps it is made of by id. Empty when the task type is not a rule.',
      stepSchema(),
    ),
    result: text('rule: the id of the last step, the rounding that gives the answer. Else empty.'),
  });
}

function fromOf(value: string | undefined): RuleFrom {
  return value === 'lookup' ? 'lookup' : 'row';
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
  const expressionProblems: string[] = [];
  const expression = expandSteps(reply.steps, reply.result, expressionProblems);
  problems.push(...expressionProblems.map((problem) => `${who}: ${problem}`));
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
