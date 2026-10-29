import { z } from 'zod';

/*
 * The rule template (decision 061). Some jobs have tasks where a policy has to be applied: a price
 * worked out from hours, a discount for members, an amount rounded a certain way. The teacher
 * reads the policy and configures ONE numeric answer per row of a table as a small typed
 * expression tree; Architect validates the tree, evaluates it with exact arithmetic, writes its
 * plain-words statement and the working of each example itself, and asks the person to confirm it
 * before any training. The teacher never writes an answer or code that decides one.
 */

/** What a rule may be made of. Architect holds every rule to these before a task is made. */
export const RULE_LIMITS = {
  /** Nodes of the expression, columns and numbers included, and each condition counted as one. */
  maxNodes: 32,
  /** Operations nested inside one another; a column or a number is not an operation. */
  maxDepth: 6,
  maxConditionals: 2,
  /** Operands of a sum, a product, a smallest or a largest. */
  maxOperands: 4,
  /** Digits after the point in a number written into a rule. */
  maxPlaces: 8,
  maxCategories: 4,
  maxCategoryValues: 24,
  /** Columns whose empty cell may count as zero, when the person said so. */
  maxEmptyZero: 4,
  maxPassages: 8,
  /** The width of the longest passage kept, in characters. */
  maxPassageChars: 600,
  /** Examples shown for one rule, at most. */
  maxExamples: 5,
} as const;

/** The number a rule's version has to carry if Architect ever changes how it reads or rounds. */
export const RULE_CONVENTIONS_VERSION = 1;

/** A number written exactly: digits, maybe a minus sign and up to eight places after a point. */
const DECIMAL_TEXT = /^-?\d{1,12}(?:\.\d{1,8})?$/;
const NumberText = z
  .string()
  .regex(DECIMAL_TEXT, 'A number is written with digits and at most one point, such as 65 or 0.1.');

/** Where a column is read: the row the case is made from, or the row looked up from another table. */
export const RuleFromSchema = z.enum(['row', 'lookup']);
export type RuleFrom = z.infer<typeof RuleFromSchema>;

/**
 * How a rounding step treats what lies between two steps: `up` goes to the higher step, `down` to
 * the lower, `half_up` to the nearer one with a tie going to the higher. Negative numbers follow
 * the same words, so up is always toward the larger number.
 */
export const RuleRoundingSchema = z.enum(['up', 'down', 'half_up']);
export type RuleRounding = z.infer<typeof RuleRoundingSchema>;

/** A yes-or-no test inside `if`: a category, a set of categories, or a number against a threshold. */
export type RuleCondition =
  | { test: 'equals'; column: string; from: RuleFrom; value: string }
  | { test: 'in'; column: string; from: RuleFrom; values: string[] }
  | { test: 'gt' | 'gte' | 'lt' | 'lte'; arg: RuleNode; than: string };

export type RuleNode =
  | { op: 'num'; value: string }
  | { op: 'col'; column: string; from: RuleFrom }
  | { op: 'add' | 'mul' | 'min' | 'max'; args: RuleNode[] }
  | { op: 'sub'; args: [RuleNode, RuleNode] }
  | { op: 'div'; arg: RuleNode; by: string }
  | { op: 'round'; arg: RuleNode; increment: string; mode: RuleRounding }
  | { op: 'if'; when: RuleCondition; then: RuleNode; else: RuleNode };

const Column = z.string().min(1).max(120);

export const RuleConditionSchema: z.ZodType<RuleCondition> = z.lazy(() =>
  z.discriminatedUnion('test', [
    z.object({
      test: z.literal('equals'),
      column: Column,
      from: RuleFromSchema,
      value: z.string().min(1).max(120),
    }),
    z.object({
      test: z.literal('in'),
      column: Column,
      from: RuleFromSchema,
      values: z.array(z.string().min(1).max(120)).min(1).max(RULE_LIMITS.maxCategoryValues),
    }),
    z.object({ test: z.enum(['gt', 'gte', 'lt', 'lte']), arg: RuleNodeSchema, than: NumberText }),
  ]),
);

export const RuleNodeSchema: z.ZodType<RuleNode> = z.lazy(() =>
  z.discriminatedUnion('op', [
    z.object({ op: z.literal('num'), value: NumberText }),
    z.object({ op: z.literal('col'), column: Column, from: RuleFromSchema }),
    z.object({
      op: z.enum(['add', 'mul', 'min', 'max']),
      args: z.array(RuleNodeSchema).min(2).max(RULE_LIMITS.maxOperands),
    }),
    z.object({ op: z.literal('sub'), args: z.tuple([RuleNodeSchema, RuleNodeSchema]) }),
    z.object({ op: z.literal('div'), arg: RuleNodeSchema, by: NumberText }),
    z.object({
      op: z.literal('round'),
      arg: RuleNodeSchema,
      increment: NumberText,
      mode: RuleRoundingSchema,
    }),
    z.object({
      op: z.literal('if'),
      when: RuleConditionSchema,
      then: RuleNodeSchema,
      else: RuleNodeSchema,
    }),
  ]),
);

/** A passage of the person's own words that a rule rests on. */
export const RulePassageSchema = z.object({
  /** A text file as attached, or `description` or `answers` for what the person typed. */
  file: z.string().min(1).max(160),
  passage: z.string().min(1).max(RULE_LIMITS.maxPassageChars),
});
export type RulePassage = z.infer<typeof RulePassageSchema>;

/** The values a column may have, stated in full, so a value nobody listed is an error not a guess. */
export const RuleCategorySchema = z.object({
  column: Column,
  from: RuleFromSchema,
  values: z.array(z.string().min(1).max(120)).min(1).max(RULE_LIMITS.maxCategoryValues),
});
export type RuleCategory = z.infer<typeof RuleCategorySchema>;

/** The other table a rule reads one row of, found by a key that is unique there. */
export const RuleLookupSchema = z.object({
  table: z.string().min(1),
  /** The column of that table holding the key. */
  keyColumn: Column,
  /** The column of the cases' table holding the key to find. */
  matchColumn: Column,
});
export type RuleLookup = z.infer<typeof RuleLookupSchema>;

/**
 * What the person said an empty cell of a numeric column should mean when the policy doesn't say:
 * it counts as zero, or its row is left out. Only the person's own answer to a question Architect
 * put to them sets it, never the teacher.
 */
export const BlankAnswerSchema = z.object({
  column: Column,
  from: RuleFromSchema,
  means: z.enum(['zero', 'leave_out']),
});
export type BlankAnswer = z.infer<typeof BlankAnswerSchema>;

/** The two answers to a question about an empty cell, which are all a rule can do with one. */
export const BLANK_ANSWERS = {
  zero: 'Count it as zero',
  leave_out: 'Leave those rows out',
} as const;

/**
 * One numeric answer per row of a table, as an expression. The rule's text comes from the policy
 * and the person's confirmed answers only, which `sources` quotes.
 */
export const RuleSpecSchema = z.object({
  template: z.literal('rule'),
  /** The table whose rows are the cases. */
  table: z.string().min(1),
  /** The column that identifies a case; the request names it as `{key}`. */
  keyColumn: Column,
  request: z.string().min(1),
  /** The name of the number in the answer, such as `total`. */
  answerName: z.string().min(1).max(60),
  /** The ISO code of the currency the amounts are in, when the answer is money. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  lookup: RuleLookupSchema.optional(),
  categories: z.array(RuleCategorySchema).max(RULE_LIMITS.maxCategories),
  expression: RuleNodeSchema,
  /**
   * The numeric columns whose empty cell counts as zero, because the person answered that it
   * should. Absent for every other column: an empty cell leaves its row out, N/A and words too.
   */
  emptyMeansZero: z
    .array(z.object({ column: Column, from: RuleFromSchema }))
    .max(RULE_LIMITS.maxEmptyZero)
    .optional(),
  sources: z.array(RulePassageSchema).min(1).max(RULE_LIMITS.maxPassages),
  /**
   * The column naming the business entity whose reuse would reveal an answer, such as the
   * customer. Cases of the same entity are kept in one set. The case's own key when absent.
   */
  familyColumn: Column.optional(),
});
export type RuleSpec = z.infer<typeof RuleSpecSchema>;

/** The working of one example: what was read, each step and what it came to. */
export const RuleExampleSchema = z.object({
  /** The practice or starting task it is. Absent for a made-up illustration. */
  taskId: z.string().min(1).optional(),
  request: z.string().min(1),
  /** The values read from the records, each with its name there. */
  inputs: z.array(z.object({ label: z.string(), value: z.string() })),
  steps: z.array(z.object({ text: z.string(), value: z.string() })),
  answer: z.string(),
  /** What the example shows: "member is yes", "member is no", "A rounding edge". */
  covers: z.array(z.string()),
  /** True for numbers Architect made up to show a rounding the records never need. */
  madeUp: z.boolean().optional(),
});
export type RuleExample = z.infer<typeof RuleExampleSchema>;

export const RuleBranchSchema = z.object({
  /** In words: "member (customers.csv) is yes". */
  label: z.string(),
  /** Cases that take this side. */
  cases: z.number().int().nonnegative(),
  /** Of those, how many would have a different answer on the other side. */
  changes: z.number().int().nonnegative(),
});
export type RuleBranch = z.infer<typeof RuleBranchSchema>;

/** What Architect worked out about a rule: the same for the screen, the report and the record. */
export const RuleDetailsSchema = z.object({
  /** A short hash of the rule and of how Architect reads and rounds. */
  version: z.string().min(1),
  /** The rule in plain words, derived from the expression. */
  statement: z.string().min(1),
  passages: z.array(RulePassageSchema),
  /** How numbers, categories and rounding are read, in plain words. */
  conventions: z.array(z.string()),
  cases: z.object({
    total: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
  }),
  /** Why rows were left out, with how many and a row that shows it. */
  excluded: z.array(
    z.object({
      reason: z.string(),
      count: z.number().int().positive(),
      example: z.string().optional(),
    }),
  ),
  /** Each side of each condition, and each operand of a smallest or largest. */
  branches: z.array(RuleBranchSchema),
  /** Things worth knowing that don't stop the rule, such as an answer already in a column. */
  flags: z.array(z.string()),
  /** Examples from the practice and starting tasks, chosen to cover the branches and a rounding edge. */
  examples: z.array(RuleExampleSchema).max(RULE_LIMITS.maxExamples),
  /** What no practice task could show, in words. */
  uncovered: z.array(z.string()),
});
export type RuleDetails = z.infer<typeof RuleDetailsSchema>;

/** What the person confirmed, and over which records. Kept beside the job. */
export const RuleConfirmationSchema = z.object({
  format: z.literal(1),
  confirmedAt: z.iso.datetime(),
  /** Each rule as the person saw it: the task type and the version. */
  rules: z.array(z.object({ typeId: z.string().min(1), version: z.string().min(1) })).min(1),
  /** The records the rules were confirmed over: a file's name and the hash of its bytes. */
  files: z.array(z.object({ name: z.string().min(1), sha256: z.string().min(1) })),
});
export type RuleConfirmation = z.infer<typeof RuleConfirmationSchema>;

/**
 * Whether a job's rules may be trained on. `needed`: not confirmed yet. `confirmed`: the rule and
 * the records are what the person confirmed. `changed`: they are not, and the tasks were made
 * from the old ones.
 */
export const RuleConfirmationStateSchema = z.object({
  state: z.enum(['needed', 'confirmed', 'changed']),
  /** What the person is confirming. Confirming sends it back, and it must still be current. */
  token: z.string().min(1),
  confirmedAt: z.iso.datetime().optional(),
  /** For `changed`: what is different, in a sentence. */
  problem: z.string().optional(),
});
export type RuleConfirmationState = z.infer<typeof RuleConfirmationStateSchema>;

/** A rule as the report says it: everything of its details but the examples. */
export const RuleReportSchema = RuleDetailsSchema.omit({ examples: true, uncovered: true }).extend({
  typeId: z.string().min(1),
  label: z.string().min(1),
  confirmedAt: z.iso.datetime(),
  /** The rule exactly as Architect evaluates it, which the statement is written from. */
  expression: RuleNodeSchema,
});
export type RuleReport = z.infer<typeof RuleReportSchema>;

/**
 * Where a passage comes from, as a person would say it: the name of a file, or whose words they
 * are when a rule rests on what the person typed or answered.
 */
export function passageSource(file: string): string {
  return file === 'answers' ? 'your answer' : file === 'description' ? 'your description' : file;
}

/** Whether teaching ran, in a sentence, from how many rounds the run used. */
export function teachingLine(rounds: number): string {
  return rounds === 0
    ? 'Teaching did not run: the student met the target on the check tasks before any round.'
    : `Teaching ran for ${rounds} ${rounds === 1 ? 'round' : 'rounds'}.`;
}

/**
 * What the Results page says beside the score of a job with a rule, and the report says too
 * (decision 061). `teacher` is the model's name as the place it appears calls it.
 */
export function ruleScoreNote(teacher: string): string {
  return `Expected answers were calculated by Architect using ${teacher}'s interpretation of your policy, which you confirmed. This score measures agreement with that rule on held-out cases; it does not independently establish that the rule matches your business policy.`;
}
