import { MAX_FILTER_VALUES, type JsonSchemaObject, type TaskSpec } from '@architect/shared';
import { z } from 'zod';
import type { Attached } from './files';
import { list, objectOf, text } from './json-parts';
import {
  RuleReplySchema,
  ruleSchema,
  settleRule,
  type BlankAsked,
  type MarkAsked,
  type Said,
  type Settled,
} from './rule-reply';
import { cleanText, foldKey } from './values';

/*
 * What the teacher sends back in the drafting conversation: one JSON object that either asks a
 * question or drafts the job. It follows the style of the other mentor replies: every key is
 * required, and what an action doesn't use is left empty, which suits constrained decoding.
 */

/** The option the app adds to every question, which asks the teacher to draft with what it has. */
export const DRAFT_NOW = 'Draft it now';

/** Questions the teacher may ask in all, after which it must draft. */
export const MAX_QUESTIONS = 3;

const FilterReplySchema = z.object({
  column: z.string(),
  // `not_equals` is read so that it can be refused with the reason, never to be used.
  op: z.enum(['equals', 'in', 'not_equals', 'empty', 'not_empty', '']),
  value: z.string(),
  values: z.array(z.string()).optional(),
  varies: z.boolean(),
});

const TypeReplySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  template: z.enum(['lookup', 'filtered_list', 'group_total', 'rule', '']),
  table: z.string(),
  keyColumn: z.string(),
  columns: z.array(z.string()),
  filters: z.array(FilterReplySchema),
  groupColumn: z.string(),
  measure: z.enum(['sum', 'count', '']),
  valueColumn: z.string(),
  dateColumn: z.string(),
  dateOrder: z.enum(['month_first', 'day_first', '']),
  unit: z.enum(['as_written', 'cents', '']),
  request: z.string(),
  rule: RuleReplySchema.optional(),
});

const FileReplySchema = z.object({
  name: z.string(),
  description: z.string(),
  access: z.enum(['read', 'write']),
});

const JobReplySchema = z.object({
  name: z.string(),
  summary: z.string(),
  description: z.string(),
  does: z.array(z.string()),
  doesNot: z.array(z.string()),
  businessDate: z.string(),
  passRate: z.number(),
  files: z.array(FileReplySchema),
  unresolved: z.array(z.string()),
  taskTypes: z.array(TypeReplySchema),
});

export const ReplySchema = z.object({
  action: z.enum(['ask', 'draft']),
  message: z.string(),
  options: z.array(z.string()),
  job: JobReplySchema,
});
export type Reply = z.infer<typeof ReplySchema>;

/** The reply format, as a JSON Schema. A reply that must draft cannot ask. */
export function replyJsonSchema(mustDraft: boolean): JsonSchemaObject {
  const filter = objectOf({
    column: text('The column, spelled as the table spells it.'),
    op: { type: 'string', enum: ['equals', 'in', 'empty', 'not_empty', ''] },
    value: text('What equals compares with. Empty for the others and when varies is true.'),
    values: list(
      'in: every value that makes a row count, spelled as the table spells it. Else empty.',
    ),
    varies: {
      type: 'boolean',
      description: 'True when the filter takes each value of its column in turn.',
    },
  });
  const taskType = objectOf({
    id: text('A short id: lowercase letters, digits and underscores, starting with a letter.'),
    label: text('A short plain name, such as "Customer emails".'),
    description: text('One plain sentence on what this kind of request is.'),
    template: { type: 'string', enum: ['lookup', 'filtered_list', 'group_total', 'rule', ''] },
    table: text('The CSV file the requests are made from, by its name.'),
    keyColumn: text(
      'lookup and rule: the column that identifies a row. filtered_list: the column listed. Else empty.',
    ),
    columns: list('lookup: the one to three columns asked for. Else empty.'),
    filters: list('filtered_list: the conditions. Else empty.', filter),
    groupColumn: text('group_total: the column whose values are the groups. Else empty.'),
    measure: { type: 'string', enum: ['sum', 'count', ''] },
    valueColumn: text(
      'group_total: the column added up (or counted when it has a value). Else empty.',
    ),
    dateColumn: text('group_total: a date column to total within ranges of dates. Empty for none.'),
    dateOrder: {
      type: 'string',
      enum: ['month_first', 'day_first', ''],
      description:
        'lookup and group_total: how a date like 03/04/2026 reads, only if the person said. Else empty.',
    },
    unit: { type: 'string', enum: ['as_written', 'cents', ''] },
    request: text(
      'The question, with {key}, {column name}, {group}, {from} and {to} where values go.',
    ),
    rule: ruleSchema(),
  });
  return objectOf({
    action: { type: 'string', enum: mustDraft ? ['draft'] : ['ask', 'draft'] },
    message: text('When asking: the question, in plain words. When drafting: empty.'),
    options: list('When asking: 2 to 4 short answers. When drafting: empty.'),
    job: objectOf({
      name: text(
        'The agent\'s name, at most 60 characters, in sentence case such as "Repair ticket pricing helper". Empty when asking.',
      ),
      summary: text('One plain sentence on what the agent does. Empty when asking.'),
      description: text('A few sentences on the job, for the agent itself. Empty when asking.'),
      does: list('What the agent does, as short plain statements. Empty when asking.'),
      doesNot: list('What the agent does not do. Empty when asking.'),
      businessDate: text('YYYY-MM-DD the records are current as of, only if stated. Else empty.'),
      passRate: {
        type: 'number',
        description: 'Share of final-test tasks to get right, 0.5 to 1. Zero when asking.',
      },
      files: list(
        'Every attached file, described.',
        objectOf({
          name: text("The file's name as attached."),
          description: text('One line on what the file holds.'),
          access: { type: 'string', enum: ['read', 'write'] },
        }),
      ),
      unresolved: list('Rules the files and answers did not settle, one short sentence each.'),
      taskTypes: list('One to three kinds of request Architect makes from the tables.', taskType),
    }),
  });
}

/** One question with its options, as the teacher asked it. */
export interface Question {
  action: 'ask';
  message: string;
  options: string[];
}

/** A job as the teacher drafted it, held against the files and cleaned up. */
export interface DraftedJob {
  name: string;
  summary: string;
  description: string;
  does: string[];
  doesNot: string[];
  businessDate?: string;
  passRate: number;
  files: { name: string; description: string; access: 'read' | 'write' }[];
  unresolved: string[];
  types: {
    id: string;
    label: string;
    description: string;
    spec?: TaskSpec;
    /**
     * For a rule: what the policy leaves open that changes an answer, which must be asked. A
     * question about an empty cell says which column, since only two answers can be put to it, and
     * so does one about a mark such as N/A, which Architect asks itself, however little the
     * teacher raised.
     */
    ambiguities?: {
      question: string;
      options: string[];
      blank?: BlankAsked;
      mark?: MarkAsked;
    }[];
  }[];
}

export interface Drafted {
  action: 'draft';
  job: DraftedJob;
}

export type Understood = Question | Drafted;

export type Checked = { ok: true; reply: Understood } | { ok: false; problems: string[] };

function fit(value: string, width: number): string {
  const cleaned = cleanText(value);
  if (cleaned.length <= width) return cleaned;
  const cut = cleaned.slice(0, width);
  const space = cut.lastIndexOf(' ');
  return (space > width / 2 ? cut.slice(0, space) : cut).trim();
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

const TYPE_ID = /^[a-z][a-z0-9_]{0,39}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function titled(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return words === '' ? id : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** What a rule is held to besides its shape: the policy it quotes and where it reports back. */
interface RuleContext {
  attached: Attached;
  said: Said;
  found(settled: Settled): void;
}

/** The kind of task a reply's type asks for, as a specification, or what is missing from it. */
function specOf(
  type: z.infer<typeof TypeReplySchema>,
  tables: ReadonlySet<string>,
  tableNames: readonly string[],
  problems: string[],
  rules: RuleContext,
): TaskSpec | undefined {
  const who = `Task type "${type.id}"`;
  if (type.template === '') {
    problems.push(`${who} needs a template: lookup, filtered_list, group_total or rule.`);
    return undefined;
  }
  const table = tableNames.find(
    (name) => foldKey(name) === foldKey(type.table.replace(/^.*[\\/]/, '')),
  );
  if (table === undefined || !tables.has(table)) {
    problems.push(
      `${who} names the table "${type.table}", which isn't one of the attached CSV files (${tableNames.join(', ')}).`,
    );
    return undefined;
  }
  const request = cleanText(type.request);
  if (request === '') {
    problems.push(`${who} needs a request.`);
    return undefined;
  }
  switch (type.template) {
    case 'lookup': {
      const columns = distinct(type.columns);
      if (cleanText(type.keyColumn) === '' || columns.length < 1 || columns.length > 3) {
        problems.push(`${who} is a lookup: it needs a keyColumn and 1 to 3 columns.`);
        return undefined;
      }
      return {
        template: 'lookup',
        table,
        keyColumn: cleanText(type.keyColumn),
        columns,
        request,
        ...(type.dateOrder === '' ? {} : { dateOrder: type.dateOrder }),
      };
    }
    case 'filtered_list': {
      const filters = type.filters.filter(
        (filter) => filter.op !== '' && cleanText(filter.column) !== '',
      );
      if (cleanText(type.keyColumn) === '' || filters.length < 1 || filters.length > 4) {
        problems.push(`${who} is a filtered_list: it needs a keyColumn and 1 to 4 filters.`);
        return undefined;
      }
      for (const filter of filters) {
        if (filter.op === 'not_equals') {
          problems.push(
            `${who}: the filter on ${cleanText(filter.column)} says what a row is not. That also keeps rows where it is empty or has a value nobody expected. Use op "in" and list every value that makes a row count, as the policy or the person names them.`,
          );
        }
      }
      return {
        template: 'filtered_list',
        table,
        keyColumn: cleanText(type.keyColumn),
        request,
        filters: filters.map((filter) => {
          const value = cleanText(filter.value);
          const op = filter.op === '' ? 'equals' : filter.op;
          const values = distinct((filter.values ?? []).map(cleanText));
          return {
            column: cleanText(filter.column),
            op,
            varies: filter.varies,
            ...(value === '' || filter.varies || (op !== 'equals' && op !== 'not_equals')
              ? {}
              : { value }),
            ...(op === 'in' && !filter.varies && values.length > 0
              ? { values: values.slice(0, MAX_FILTER_VALUES) }
              : {}),
          };
        }),
      };
    }
    case 'group_total': {
      if (cleanText(type.groupColumn) === '' || type.measure === '') {
        problems.push(`${who} is a group_total: it needs a groupColumn and a measure.`);
        return undefined;
      }
      const valueColumn = cleanText(type.valueColumn);
      const dateColumn = cleanText(type.dateColumn);
      return {
        template: 'group_total',
        table,
        groupColumn: cleanText(type.groupColumn),
        measure: type.measure,
        unit: type.unit === '' ? 'as_written' : type.unit,
        request,
        ...(valueColumn === '' ? {} : { valueColumn }),
        ...(dateColumn === '' ? {} : { dateColumn }),
        ...(type.dateOrder === '' ? {} : { dateOrder: type.dateOrder }),
      };
    }
    case 'rule': {
      if (cleanText(type.keyColumn) === '') {
        problems.push(`${who} is a rule: it needs a keyColumn.`);
        return undefined;
      }
      const settled = settleRule(
        type.rule,
        { table, keyColumn: cleanText(type.keyColumn), request },
        tableNames,
        rules,
        who,
        problems,
      );
      if (settled === undefined) return undefined;
      rules.found(settled);
      return settled.spec;
    }
  }
}

/**
 * Holds a reply to the format and to the files. A question needs two to four options and is
 * refused when the teacher must draft. A draft's file names must be attached files; its task
 * types must each be a template Architect has, over a table that was attached, with what that
 * template needs. Columns, filter values and the data itself are checked when the tasks are made.
 */
export function checkReply(
  raw: unknown,
  context: { mustDraft: boolean; attached: Attached; said?: Said },
): Checked {
  const parsed = ReplySchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join('.') ?? '';
    return {
      ok: false,
      problems: [
        `The reply doesn't have the shape asked for${where === '' ? '' : ` (look at "${where}")`}: ${issue?.message ?? 'it is not valid'}.`,
      ],
    };
  }
  const reply = parsed.data;
  const problems: string[] = [];

  if (reply.action === 'ask') {
    if (context.mustDraft) problems.push('Draft the job now. Do not ask another question.');
    const message = fit(reply.message, 600);
    if (message === '') problems.push('The question is empty.');
    const options = distinct(reply.options.map((option) => fit(option, 80))).filter(
      (option) => foldKey(option) !== foldKey(DRAFT_NOW),
    );
    if (options.length < 2 || options.length > 4) {
      problems.push(
        `A question needs 2 to 4 different options, and "${DRAFT_NOW}" is added by the app. It had ${options.length}.`,
      );
    }
    return problems.length > 0
      ? { ok: false, problems }
      : { ok: true, reply: { action: 'ask', message, options } };
  }

  const { job } = reply;
  const name = fit(job.name, 60);
  const summary = fit(job.summary, 240);
  const description = fit(job.description, 2_000);
  if (name === '') problems.push('The job needs a name.');
  if (summary === '') problems.push('The job needs a one-sentence summary.');
  if (description === '') problems.push('The job needs a description.');
  const does = distinct(job.does.map((item) => fit(item, 160))).slice(0, 8);
  if (does.length === 0) problems.push('List at least one thing the agent does.');
  const doesNot = distinct(job.doesNot.map((item) => fit(item, 160))).slice(0, 8);
  const unresolved = distinct(job.unresolved.map((item) => fit(item, 200))).slice(0, 6);

  const day = cleanText(job.businessDate);
  if (day !== '' && (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)))) {
    problems.push(
      `businessDate "${day}" isn't a date like 2026-11-24. Leave it empty if it isn't stated.`,
    );
  }
  const rate = job.passRate > 1 && job.passRate <= 100 ? job.passRate / 100 : job.passRate;
  if (!(rate >= 0.5 && rate <= 1)) {
    problems.push(`passRate ${job.passRate} must be between 0.5 and 1, such as 0.9.`);
  }

  const names = context.attached.files.map((file) => file.name);
  const described = new Map<string, { description: string; access: 'read' | 'write' }>();
  for (const file of job.files) {
    const bare = file.name.replace(/^.*[\\/]/, '');
    const match = names.find((candidate) => foldKey(candidate) === foldKey(bare));
    if (match === undefined) {
      problems.push(
        `The file "${file.name}" wasn't attached. The attached files are ${names.join(', ')}.`,
      );
      continue;
    }
    described.set(match, { description: fit(file.description, 240), access: file.access });
  }

  const tables = new Set(
    context.attached.files.filter((file) => file.kind === 'table').map((file) => file.name),
  );
  const tableNames = [...tables];
  const types: DraftedJob['types'] = [];
  const left: string[] = [];
  const said = context.said ?? { description: '', answers: '' };
  if (context.attached.tasks !== null) {
    // The tasks came with the files, so the teacher only names and describes their types.
    const given = new Map(job.taskTypes.map((type) => [cleanText(type.id), type]));
    for (const { id } of context.attached.tasks.types) {
      const type = given.get(id);
      types.push({
        id,
        label: fit(type?.label ?? '', 60) || titled(id),
        description: fit(type?.description ?? '', 200),
      });
    }
  } else {
    if (job.taskTypes.length < 1 || job.taskTypes.length > 3) {
      problems.push(`Choose 1 to 3 task types. There were ${job.taskTypes.length}.`);
    }
    const seen = new Set<string>();
    for (const type of job.taskTypes.slice(0, 3)) {
      const id = cleanText(type.id);
      if (!TYPE_ID.test(id)) {
        problems.push(
          `The task type id "${id}" must be lowercase letters, digits and underscores, starting with a letter.`,
        );
        continue;
      }
      if (seen.has(id)) {
        problems.push(`The task type id "${id}" is used twice.`);
        continue;
      }
      seen.add(id);
      const label = fit(type.label, 60);
      if (label === '') problems.push(`Task type "${id}" needs a label.`);
      const rule: { settled?: Settled } = {};
      const spec = specOf(type, tables, tableNames, problems, {
        attached: context.attached,
        said,
        found: (settled) => {
          rule.settled = settled;
        },
      });
      left.push(...(rule.settled?.left ?? []));
      types.push({
        id,
        label: label || titled(id),
        description: fit(type.description, 200),
        ...(spec === undefined ? {} : { spec }),
        ...(rule.settled && rule.settled.blocking.length > 0
          ? { ambiguities: rule.settled.blocking }
          : {}),
      });
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    reply: {
      action: 'draft',
      job: {
        name,
        summary,
        description,
        does,
        doesNot,
        ...(day === '' ? {} : { businessDate: day }),
        passRate: rate,
        files: context.attached.files.map((file) => ({
          name: file.name,
          description: described.get(file.name)?.description ?? '',
          access: described.get(file.name)?.access ?? 'read',
        })),
        unresolved: distinct([...unresolved, ...left.map((item) => fit(item, 200))]).slice(0, 6),
        types,
      },
    },
  };
}
