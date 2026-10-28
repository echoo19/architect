import { z } from 'zod';
import { JsonValueSchema } from './json';
import { RequirementsSchema, TaskTypeInfoSchema } from './job';

export const FileEditSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('write'), path: z.string().min(1), content: z.string() }),
  z.object({ op: z.literal('delete'), path: z.string().min(1) }),
]);
export type FileEdit = z.infer<typeof FileEditSchema>;

export const PredictionSchema = z.object({
  /** Expected change in dev passes (net tasks), as a range. */
  devDeltaMin: z.number().int(),
  devDeltaMax: z.number().int(),
  rationale: z.string().min(1),
});
export type Prediction = z.infer<typeof PredictionSchema>;

/** The bounded intervention menu (spec section 7). */
export const InterventionTypeSchema = z.enum([
  /** A rule or a step-by-step procedure in AGENTS.md or a skill. */
  'procedure',
  /** Which skill, example or source loads for which request. */
  'retrieval',
  /** A small typed tool in the sandbox. */
  'helper',
  /** A LoRA adapter trained on verified lessons. */
  'weights',
  /** One question for the person, asked before any label is made. */
  'clarification',
]);
export type InterventionType = z.infer<typeof InterventionTypeSchema>;

/** A step of a trace the mentor points at: model turn `turn`, counting from 1. */
export const EvidenceSchema = z.object({
  turn: z.number().int().positive(),
  note: z.string().min(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** What the mentor expects an intervention to cost, checked against what is left. */
export const CostEstimateSchema = z.object({
  mentorUsd: z.number().nonnegative(),
  computeUsd: z.number().nonnegative(),
  minutes: z.number().nonnegative(),
});
export type CostEstimate = z.infer<typeof CostEstimateSchema>;

/**
 * One failed train attempt as the mentor wrote it up. The runner checks each against the attempt
 * and sets aside the ones that don't hold, with the reason, so one bad finding doesn't cost the
 * round.
 */
export const FindingDraftSchema = z.object({
  taskId: z.string(),
  /** The model turn the mentor suspects went wrong, counting from 1. */
  failureTurn: z.number().int(),
  evidence: z.array(z.object({ turn: z.number().int(), note: z.string() })),
  cause: z.string(),
  /** An existing category's id, or a new slug and label when none fits. */
  category: z.object({ id: z.string(), slug: z.string(), label: z.string() }),
  taskType: z.string(),
});
export type FindingDraft = z.infer<typeof FindingDraftSchema>;

/** The one intervention a round proposes, from the menu. */
export const InterventionPlanSchema = z.object({
  type: InterventionTypeSchema,
  hypothesis: z.string(),
  /** Words that load the round's verified lessons as worked examples; none adds none. */
  workedExamples: z.array(z.string().min(1)).max(8).default([]),
  /** Other train tasks of each finding's category to demonstrate from the start. */
  practicePerFinding: z.number().int().min(0).max(3).default(0),
  /** For a clarification: the one question for the person. */
  question: z.string().default(''),
  estimatedCost: CostEstimateSchema.default({ mentorUsd: 0, computeUsd: 0, minutes: 0 }),
  verificationPlan: z.string().default(''),
});
export type InterventionPlan = z.infer<typeof InterventionPlanSchema>;

const HARNESS_CHANGES = new Set<InterventionType>(['procedure', 'retrieval', 'helper']);

/** What a reply from before the menu proposes: a procedure, with nothing to teach. */
export const LEGACY_INTERVENTION: InterventionPlan = {
  type: 'procedure',
  hypothesis: '',
  workedExamples: [],
  practicePerFinding: 0,
  question: '',
  estimatedCost: { mentorUsd: 0, computeUsd: 0, minutes: 0 },
  verificationPlan: '',
};

/**
 * One round's proposal: a single diagnosis, the findings it rests on and one intervention. A
 * reply from before the menu, a diagnosis and a change set, has neither and reads as a
 * procedure with nothing to teach.
 */
export const HypothesisSchema = z
  .object({
    title: z.string().min(1).max(80),
    diagnosis: z.string().min(1),
    /** The harness change set; empty for a weights or clarification intervention. */
    edits: z.array(FileEditSchema).max(16),
    /** Train task ids whose failures this addresses. */
    causeTaskIds: z.array(z.string()).default([]),
    predicted: PredictionSchema,
    /** The mentor's own claim that the student is ready. Logged to measure overclaiming. */
    readyClaim: z.boolean().default(false),
    findings: z.array(FindingDraftSchema).optional(),
    intervention: InterventionPlanSchema.optional(),
  })
  .superRefine((hypothesis, context) => {
    const type = hypothesis.intervention?.type ?? 'procedure';
    const harness = HARNESS_CHANGES.has(type);
    if (harness && hypothesis.edits.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['edits'],
        message: `A ${type} intervention needs at least one edit.`,
      });
    }
    if (!harness && hypothesis.edits.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['edits'],
        message: `A ${type} intervention changes no harness file, so its edits must be empty.`,
      });
    }
  });
export type Hypothesis = z.infer<typeof HypothesisSchema>;

/** The hypothesis's intervention; a reply from before the menu proposed a procedure. */
export function interventionOf(hypothesis: Hypothesis): InterventionPlan {
  return hypothesis.intervention ?? LEGACY_INTERVENTION;
}

export const TypeScoreSchema = z.object({
  type: z.string(),
  pass: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type TypeScore = z.infer<typeof TypeScoreSchema>;

/**
 * What the mentor learns about an earlier hypothesis: for one dev measured, the decision and the
 * overall dev change; for one rejected before dev saw it, why, so the next reply can fix it.
 */
export const MentorLineageItemSchema = z.discriminatedUnion('decision', [
  z.object({
    round: z.number().int().positive(),
    title: z.string(),
    diagnosis: z.string(),
    files: z.array(z.string()),
    decision: z.enum(['kept', 'reverted']),
    /** Net dev passes on the first measurement, in the units of the mentor's prediction. */
    devDelta: z.number().int(),
    /** When the change was measured again on new seeds: net dev passes over both measurements. */
    confirmedDelta: z.number().int().optional(),
  }),
  z.object({
    round: z.number().int().positive(),
    /** Absent when the reply held no usable hypothesis. */
    title: z.string().optional(),
    files: z.array(z.string()),
    decision: z.literal('rejected'),
    /** One line, e.g. `tools/grep.json: "grep" is a built-in tool name. Pick a different name.` */
    reason: z.string(),
  }),
]);
export type MentorLineageItem = z.infer<typeof MentorLineageItemSchema>;

/**
 * Everything the mentor is allowed to see in a round. The runner builds it from an allowlist;
 * nothing from the test split, and no dev task content, ever appears here.
 */
export const MentorViewSchema = z.object({
  job: z.object({
    name: z.string(),
    description: z.string(),
    taskTypes: z.array(TaskTypeInfoSchema),
    requirements: RequirementsSchema,
    dataFiles: z.array(
      z.object({
        name: z.string(),
        kind: z.enum(['table', 'text']),
        access: z.enum(['read', 'write']),
        columns: z.array(z.string()).optional(),
        rowCount: z.number().int().optional(),
        sampleRows: z.array(z.record(z.string(), JsonValueSchema)).optional(),
        text: z.string().optional(),
      }),
    ),
  }),
  harnessFiles: z.record(z.string(), z.string()),
  round: z.number().int().positive(),
  budgetLeft: z.object({
    rounds: z.number().int().nonnegative(),
    usd: z.number().nonnegative(),
    minutes: z.number().nonnegative(),
  }),
  train: z.object({
    results: z.array(
      z.object({
        taskId: z.string(),
        taskType: z.string(),
        prompt: z.string(),
        expected: JsonValueSchema,
        pass: z.boolean(),
        reason: z.string(),
        /** Compact text rendering of the attempt: model turns, tool calls, truncated results. */
        trace: z.string(),
      }),
    ),
    perType: z.array(TypeScoreSchema),
  }),
  /** Overall dev score only: per-type dev counts would be an extra channel for tuning to dev. */
  dev: z.object({
    pass: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  lineage: z.array(MentorLineageItemSchema),
  /**
   * For a mentor choosing from the intervention menu: what it may choose this round and why the
   * rest are off it, the job's failure vocabulary with what each category has been taught, and
   * the person's answers to earlier questions. Train-only; nothing here comes from dev or test.
   */
  mentoring: z
    .object({
      allowed: z.array(InterventionTypeSchema),
      refused: z.record(z.string(), z.string()),
      categories: z.array(
        z.object({
          id: z.string(),
          slug: z.string(),
          label: z.string(),
          taskType: z.string(),
          verifiedLessons: z.number().int().nonnegative(),
          stopped: z.boolean(),
        }),
      ),
      answers: z.array(z.object({ question: z.string(), answer: z.string() })),
      /**
       * In a run that improves an agent: the lessons the person queued with Teach this, each as
       * the mentor proposed it from their correction of one reply (decision 041).
       */
      lessons: z
        .array(
          z.object({
            kind: z.string(),
            lesson: z.string(),
            wrong: z.string(),
            wanted: z.string().optional(),
            instruction: z.string().optional(),
            taskType: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});
export type MentorView = z.infer<typeof MentorViewSchema>;
