import {
  BLANK_ANSWERS,
  RULE_LIMITS,
  RuleSpecSchema,
  type BlankAnswer,
  type JsonSchemaObject,
  type PlaceholderAnswer,
  type RuleCategory,
  type RuleFrom,
  type RuleNode,
  type RulePassage,
  type RuleSpec,
} from '@architect/shared';
import { z } from 'zod';
import type { Attached } from './files';
import { list, objectOf, text } from './json-parts';
import { numberRefs } from './rule/expression';
import { markQuestion, placeholdersIn, sameMark, type Placeholder } from './rule/placeholders';
import { expandSteps, stepSchema, WireStepSchema } from './rule-steps';
import { cellsOf, findColumn, kindOf, type Table } from './table';
import { briefly, cleanText, foldKey } from './values';

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
    z.object({
      question: z.string(),
      options: z.array(z.string()),
      changesAnswers: z.boolean(),
      // Set for a question about what an empty cell of a column should count as.
      blankColumn: z.string().optional(),
      blankFrom: z.string().optional(),
    }),
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
        options: list(
          'Two to four short answers, each one the rule can do. Empty for a question about an empty cell.',
        ),
        changesAnswers: {
          type: 'boolean',
          description: 'True when different answers would give different numbers.',
        },
        blankColumn: text(
          'Only for a question about what an empty cell of a number column should count as: that column, spelled as the table spells it. Architect then puts the two answers it can do. Never for N/A or a dash: Architect asks about those itself. Else empty.',
        ),
        blankFrom: {
          type: 'string',
          enum: ['row', 'lookup', ''],
          description: 'With blankColumn: the cases table (row) or the looked-up table (lookup).',
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

/** The column of a table that an empty cell was asked about, as the person is asked. */
export interface BlankAsked {
  table: string;
  column: string;
  from: RuleFrom;
}

/** What the person chose for an empty cell of one column of one table. */
export type TableBlank = BlankAnswer & { table: string };

/**
 * The answer the person gave about this column of this table, if they gave one. An answer about
 * a column of another table never stands in for it, however alike the two are named.
 */
function blankFor(
  blanks: readonly TableBlank[] | undefined,
  table: string,
  column: string,
): TableBlank | undefined {
  return (blanks ?? []).find(
    (answer) =>
      foldKey(answer.table) === foldKey(table) && foldKey(answer.column) === foldKey(column),
  );
}

/**
 * The mark of a column that the person is asked about: N/A, a dash. It is the file, the column and
 * the mark as the column spells it most often, which N/A and n/a share.
 */
export interface MarkAsked {
  table: string;
  column: string;
  mark: string;
}

/**
 * What the person chose for one mark of one column of one table, with the question that was put to
 * them, which the rule's passage for the answer shows beside it.
 */
export type TableMark = PlaceholderAnswer & { question: string };

/**
 * The answer the person gave about this mark in this column of this table, if they gave one. An
 * answer about another table, another column or another mark never stands in for it, however alike
 * they are named.
 */
function markFor(
  marks: readonly TableMark[] | undefined,
  table: string,
  column: string,
  mark: string,
): TableMark | undefined {
  return (marks ?? []).find(
    (answer) =>
      foldKey(answer.table) === foldKey(table) &&
      foldKey(answer.column) === foldKey(column) &&
      sameMark(answer.mark, mark),
  );
}

/** What the person has said, for a passage to be found in. */
export interface Said {
  description: string;
  answers: string;
  /** What they chose for each empty cell they were asked about, which the rule has to follow. */
  blanks?: readonly TableBlank[];
  /**
   * What they chose for each mark such as N/A or a dash they were asked about, which the rule has
   * to follow. Only the person's own answer to Architect's question is here, never the teacher's.
   */
  marks?: readonly TableMark[];
}

/** Text as it is compared for a quotation: spaces, quotes and emphasis marks set aside. */
export function plain(text: string): string {
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
  /**
   * Open questions that change an answer, which Architect puts to the person before any task. One
   * about an empty cell says which column, and has the two answers a rule can do, not the teacher's.
   */
  blocking: {
    question: string;
    options: string[];
    blank?: BlankAsked;
    /** Set for a question Architect asks about a mark itself, even when the teacher raised none. */
    mark?: MarkAsked;
  }[];
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
  if (sources.length > RULE_LIMITS.maxPassages) {
    problems.push(
      `${who}: a rule quotes at most ${RULE_LIMITS.maxPassages} passages. Quote just the sentences it rests on.`,
    );
  }
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
    blankColumn: cleanText(item.blankColumn),
    blankFrom: fromOf(item.blankFrom),
  }));
  for (const item of ambiguities) {
    // A question about an empty cell has its answers from Architect, so none are asked of the teacher.
    const needsOptions = item.changesAnswers && item.blankColumn === '';
    if (item.question === '' || (needsOptions && item.options.length < 2)) {
      problems.push(
        `${who}: an open question that changes an answer needs the question and 2 to 4 different options.`,
      );
    }
  }
  if (expression === null || problems.length > before) return undefined;

  // What the person chose for an empty cell is the rule's: the teacher only asks, and Architect
  // writes it into the rule from the person's own answer.
  const asked = blankQuestions(
    ambiguities,
    expression,
    { row: base.table, lookup: lookupTable },
    context,
    who,
    problems,
  );
  // Each column the rule adds up takes the answer given about that column of its own table.
  const emptyMeansZero = numberRefs(expression).flatMap((ref) => {
    const table = ref.from === 'lookup' ? lookupTable : base.table;
    const answer =
      table === undefined ? undefined : blankFor(context.said.blanks, table, ref.column);
    return answer?.means === 'zero' ? [{ column: ref.column, from: ref.from }] : [];
  });
  if (problems.length > before) return undefined;

  // The marks N/A and a dash are Architect's to ask about, whatever the teacher raised: it asks the
  // person for each one the rule's columns hold, and counts as zero only those they said so for.
  const marked = marksOf(expression, { row: base.table, lookup: lookupTable }, context);

  const currency = cleanText(reply.currency).toUpperCase();
  const family = cleanText(reply.familyColumn);
  // The person's answer is a passage the rule rests on, whether or not the teacher quoted it. The
  // passages Architect adds have a room of their own, so the teacher quoting a full eight leaves
  // none of them out.
  const rests = emptyMeansZero.length > 0;
  // So is each answer that a mark counts as zero, with the question it was given to: one answer
  // reads the same whichever mark it was about, so the question is what tells them apart.
  const answered: RulePassage[] = marked.zero.map((answer) => ({
    file: 'answers',
    passage: BLANK_ANSWERS.zero,
    question: briefly(answer.question, RULE_LIMITS.maxQuestionChars),
  }));
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
    ...(emptyMeansZero.length === 0 ? {} : { emptyMeansZero }),
    ...(marked.columns.length === 0 ? {} : { placeholderMeansZero: marked.columns }),
    sources: [
      ...(rests &&
      !sources.some((item) => item.file === 'answers' && item.passage === BLANK_ANSWERS.zero)
        ? [...sources, { file: 'answers', passage: BLANK_ANSWERS.zero }]
        : sources),
      ...answered,
    ],
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
    blocking: [
      ...ambiguities
        .filter((item) => item.changesAnswers && item.blankColumn === '')
        .map(({ question, options }) => ({ question, options })),
      ...asked,
      ...marked.open,
    ],
    left: ambiguities
      .filter((item) => !item.changesAnswers && item.blankColumn === '')
      .map((item) => item.question),
  };
}

/**
 * The ways an empty cell, or a mark such as N/A, can be dealt with, as the person is offered them.
 * Neither is chosen for them: the first is no default, and "Draft it now" is neither.
 */
const BLANK_OPTIONS = [BLANK_ANSWERS.zero, BLANK_ANSWERS.leave_out];

/** The column of an attached table that a rule reads as a number, when it holds numbers. */
function numberColumnOf(
  name: string | undefined,
  column: string,
  attached: Attached,
): { table: string; header: string; cells: (string | null)[] } | undefined {
  const table: Table | undefined = attached.files.find((file) => file.name === name)?.table;
  const header = table === undefined ? null : findColumn(table, column);
  if (name === undefined || table === undefined || header === null) return undefined;
  const cells = cellsOf(table, header);
  return kindOf(cells) === 'number' ? { table: name, header, cells } : undefined;
}

/**
 * What the person has said of the marks in the columns a rule adds up, and what is left to ask.
 * For each such column of a table that holds marks (N/A, a dash and the like) where a number
 * should be: the marks they said count as zero, for the rule to carry, and a question for each
 * mark they have not been asked about yet. The teacher has no part in it. Asked once for each
 * table, column and mark, in the order the column holds them most to least often.
 */
function marksOf(
  expression: RuleNode,
  tables: { row: string; lookup: string | undefined },
  context: { attached: Attached; said: Said },
): {
  columns: NonNullable<RuleSpec['placeholderMeansZero']>;
  zero: TableMark[];
  open: { question: string; options: string[]; mark: MarkAsked }[];
} {
  const columns: NonNullable<RuleSpec['placeholderMeansZero']> = [];
  const zero: TableMark[] = [];
  const open: { question: string; options: string[]; mark: MarkAsked }[] = [];
  const asked = new Set<string>();
  for (const ref of numberRefs(expression)) {
    const found = numberColumnOf(
      ref.from === 'lookup' ? tables.lookup : tables.row,
      ref.column,
      context.attached,
    );
    if (found === undefined) continue;
    const held: Placeholder[] = placeholdersIn(found.cells);
    const tokens: string[] = [];
    for (const mark of held) {
      const answer = markFor(context.said.marks, found.table, found.header, mark.spelling);
      if (answer?.means === 'zero') {
        tokens.push(mark.spelling);
        if (!zero.includes(answer)) zero.push(answer);
      } else if (answer === undefined) {
        const key = JSON.stringify([foldKey(found.table), foldKey(found.header), mark.key]);
        if (asked.has(key)) continue;
        asked.add(key);
        open.push({
          question: markQuestion(found.table, found.header, mark.spelling),
          options: BLANK_OPTIONS,
          mark: { table: found.table, column: found.header, mark: mark.spelling },
        });
      }
    }
    if (tokens.length > 0) {
      columns.push({ column: ref.column, from: ref.from, tokens });
    }
  }
  return { columns, zero, open };
}

type BlankQuestion = {
  question: string;
  options: string[];
  blank: BlankAsked;
};

/**
 * The questions about an empty cell that the person has to answer. The column must be one the rule
 * adds up and must have an empty cell somewhere, or there is nothing to ask, and a column of a
 * table that the person already answered for is not asked about again. A column of another table
 * with the same name is another question.
 */
function blankQuestions(
  ambiguities: readonly {
    question: string;
    blankColumn: string;
    blankFrom: RuleFrom;
  }[],
  expression: RuleNode,
  tables: { row: string; lookup: string | undefined },
  context: { attached: Attached; said: Said },
  who: string,
  problems: string[],
): BlankQuestion[] {
  const asked: BlankQuestion[] = [];
  for (const item of ambiguities) {
    if (item.blankColumn === '') continue;
    const name = item.blankFrom === 'lookup' ? tables.lookup : tables.row;
    const table = context.attached.files.find((candidate) => candidate.name === name)?.table;
    const column = table === undefined ? null : findColumn(table, item.blankColumn);
    if (name === undefined || table === undefined || column === null) {
      problems.push(
        `${who}: the question about an empty ${item.blankColumn} names a column that isn't in the table.`,
      );
      continue;
    }
    const read = numberRefs(expression).some(
      (ref) => ref.from === item.blankFrom && foldKey(ref.column) === foldKey(column),
    );
    if (!read) {
      problems.push(
        `${who}: ${column} is not a number the rule adds up, so what an empty one counts as is not a question for it.`,
      );
      continue;
    }
    const answered = blankFor(context.said.blanks, name, column) !== undefined;
    const empty = cellsOf(table, column).some((cell) => cleanText(cell) === '');
    if (answered || !empty || item.question === '') continue;
    asked.push({
      question: item.question,
      options: BLANK_OPTIONS,
      blank: { table: name, column, from: item.blankFrom },
    });
  }
  return asked;
}
