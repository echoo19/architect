import { z } from 'zod';
import {
  BlankAnswerSchema,
  PlaceholderAnswerSchema,
  RuleConfirmationStateSchema,
  RuleDetailsSchema,
  RuleSpecSchema,
} from './rules';
import { StudyStateSchema } from './study';

/*
 * Drafting a job from the person's own files (decision 058). The teacher decides what the job is
 * and which kind of request to make from which table; Architect makes the requests and works
 * out every expected answer itself, so the teacher never writes an answer or code that decides one.
 */

/**
 * What drafting reads and needs, in one place so the engine and the screens say the same numbers
 * (decisions 058 and 061).
 */
export const DRAFTING_LIMITS = {
  /** The fewest tasks a job can be trained on, so the fewest rows of records in all. */
  minTasks: 30,
  /** The longest text file Architect reads, in characters. It reads a text whole or not at all. */
  maxTextChars: 30_000,
  /** The most characters of text across all the text files. */
  maxTotalTextChars: 60_000,
} as const;

/** The kinds of request Architect knows how to make from a table. */
export const TASK_TEMPLATES = ['lookup', 'filtered_list', 'group_total', 'rule'] as const;
export const TaskTemplateSchema = z.enum(TASK_TEMPLATES);
export type TaskTemplate = z.infer<typeof TaskTemplateSchema>;

/**
 * A condition on one column's text, compared without regard to case, spacing or quotes. `in`
 * keeps the rows whose value is one of a set the teacher states in full. `not_equals` is what
 * older drafts used; it also admits empty and unfamiliar values, so a new draft never has one
 * (decision 061).
 */
export const FilterOpSchema = z.enum(['equals', 'in', 'not_equals', 'empty', 'not_empty']);
export type FilterOp = z.infer<typeof FilterOpSchema>;

/** The most values a membership filter may list. */
export const MAX_FILTER_VALUES = 12;

export const FilterSpecSchema = z.object({
  column: z.string().min(1),
  op: FilterOpSchema,
  /** What `equals` and `not_equals` compare with. Absent for the others and for a varying filter. */
  value: z.string().min(1).optional(),
  /** The values `in` keeps: every one the row may have to count, stated in full. */
  values: z.array(z.string().min(1)).min(1).max(MAX_FILTER_VALUES).optional(),
  /** The filter takes each of the column's values in turn, one request apiece. */
  varies: z.boolean(),
});
export type FilterSpec = z.infer<typeof FilterSpecSchema>;

/** The words of a request, with `{name}` where a value goes. */
const RequestSchema = z.string().min(1);

export const DateOrderSchema = z.enum(['month_first', 'day_first']);
export type DateOrder = z.infer<typeof DateOrderSchema>;

/** The values of one to three columns for the row with a given key. */
export const LookupSpecSchema = z.object({
  template: z.literal('lookup'),
  table: z.string().min(1),
  keyColumn: z.string().min(1),
  columns: z.array(z.string().min(1)).min(1).max(3),
  /** How `03/04/2026` reads in the date columns asked for, when the file doesn't settle it. */
  dateOrder: DateOrderSchema.optional(),
  request: RequestSchema,
});
export type LookupSpec = z.infer<typeof LookupSpecSchema>;

/** The key values of the rows that match a few conditions. */
export const FilteredListSpecSchema = z.object({
  template: z.literal('filtered_list'),
  table: z.string().min(1),
  keyColumn: z.string().min(1),
  filters: z.array(FilterSpecSchema).min(1).max(4),
  request: RequestSchema,
});
export type FilteredListSpec = z.infer<typeof FilteredListSpecSchema>;

/** The sum, or the count, of a column for one value of a grouping column, maybe within dates. */
export const GroupTotalSpecSchema = z.object({
  template: z.literal('group_total'),
  table: z.string().min(1),
  groupColumn: z.string().min(1),
  measure: z.enum(['sum', 'count']),
  /** The column added up, or counted when it has a value. Absent when every row counts. */
  valueColumn: z.string().min(1).optional(),
  /** Absent when the total covers every date. */
  dateColumn: z.string().min(1).optional(),
  /** How `03/04/2026` reads, when the file doesn't settle it. */
  dateOrder: DateOrderSchema.optional(),
  /** `cents` gives a sum in hundredths of the file's unit. */
  unit: z.enum(['as_written', 'cents']),
  request: RequestSchema,
});
export type GroupTotalSpec = z.infer<typeof GroupTotalSpecSchema>;

export const TaskSpecSchema = z.discriminatedUnion('template', [
  LookupSpecSchema,
  FilteredListSpecSchema,
  GroupTotalSpecSchema,
  RuleSpecSchema,
]);
export type TaskSpec = z.infer<typeof TaskSpecSchema>;

/**
 * What drafting a job left beside it, in the job's folder: where its tasks came from, what they
 * were made from, what the teacher left open and what drafting cost. A job whose tasks came
 * with it, such as the sample jobs, has none.
 */
export const DraftRecordSchema = z.object({
  format: z.literal(1),
  /** `generated`: Architect made the requests from the person's files. `attached`: they came from a tasks file. */
  source: z.enum(['generated', 'attached']),
  createdAt: z.iso.datetime(),
  /** The seed the requests were chosen with, so the same files and answers make the same tasks. */
  seed: z.number().int(),
  teacher: z.object({ label: z.string(), model: z.string() }),
  cost: z.object({
    calls: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    /** Null when the price of some call wasn't known. */
    usd: z.number().nonnegative().nullable(),
  }),
  /** The task types, each with the rule Architect understood and the specification it was made from. */
  types: z.array(
    z.object({
      id: z.string().min(1),
      rule: z.string().min(1).optional(),
      spec: TaskSpecSchema.optional(),
      /** For a rule: its statement, passages, examples and what Architect checked (decision 061). */
      details: RuleDetailsSchema.optional(),
    }),
  ),
  /** Rules the files and the person's answers didn't settle, as the teacher listed them. */
  unresolved: z.array(z.string()),
  /** What Architect assumed or left out where the files didn't say, in plain words. */
  notes: z.array(z.string()),
  /**
   * What the person answered to the questions they were asked, which the rules may rest on. An
   * answer to a question about an empty cell says which column it was about and what the person
   * chose. So does an answer to one Architect asked about a mark such as N/A or a dash.
   */
  answers: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
        blank: BlankAnswerSchema.optional(),
        placeholder: PlaceholderAnswerSchema.optional(),
      }),
    )
    .optional(),
  /** The records the tasks were made from: each file's name and the hash of its bytes. */
  files: z.array(z.object({ name: z.string().min(1), sha256: z.string().min(1) })).optional(),
});
export type DraftRecord = z.infer<typeof DraftRecordSchema>;

const count = z.number().int().nonnegative();

/** How many tasks sit in each set. */
export const SplitCountsSchema = z.object({
  calibration: count,
  train: count,
  dev: count,
  test: count,
});
export type SplitCounts = z.infer<typeof SplitCountsSchema>;

/**
 * What a job's tasks are, for the Define screen: where they came from, the rule behind each type,
 * a few examples of each with their expected answers, and how many there are. The examples come
 * from the practice and starting sets only, never from the final test.
 */
export const TaskPlanSchema = z.object({
  /** `included`: the tasks came with the job. */
  source: z.enum(['generated', 'attached', 'included']),
  counts: SplitCountsSchema,
  types: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string().optional(),
      /** What Architect understood the type to be, for tasks it made. */
      rule: z.string().optional(),
      /** For a rule type: the rule in plain words, its passages and examples with their working. */
      details: RuleDetailsSchema.optional(),
      counts: SplitCountsSchema,
      examples: z.array(z.object({ request: z.string(), answer: z.string().optional() })).max(3),
    }),
  ),
  /** Rules the files and answers didn't settle. */
  unresolved: z.array(z.string()),
  notes: z.array(z.string()),
  /** Present when the job has a rule: whether the person has confirmed it over these records. */
  confirmation: RuleConfirmationStateSchema.optional(),
  /** Present when the job lists organizations: where the study of their material stands. */
  study: StudyStateSchema.optional(),
});
export type TaskPlan = z.infer<typeof TaskPlanSchema>;
