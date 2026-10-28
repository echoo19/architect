import { z } from 'zod';
import { ScoreSchema } from './lineage';
import { TypeScoreSchema } from './mentor';
import { RunStatusSchema } from './run';

/**
 * Teach this and Improve agent (spec section 8, decision 042). A person corrects one reply in
 * the workspace; the mentor reads that exchange, once they agree, and proposes a lesson; the
 * person queues it or discards it. A queued lesson becomes a candidate version, never the
 * active one: at once as an instruction, or through an improvement run.
 */

/** What a correction asks of the agent, as the mentor reads it. */
export const CorrectionKindSchema = z.enum([
  /** An explicit preference or procedure: a standing instruction says it. */
  'procedure',
  /** A missing fact or source: where the right information is. */
  'source',
  /** A weakness despite clear instructions: practice, perhaps training. */
  'weakness',
  /** The request could mean more than one thing. */
  'ambiguous',
  /** The correction can't be checked against the exchange, or contradicts it. */
  'invalid',
]);
export type CorrectionKind = z.infer<typeof CorrectionKindSchema>;

/** The kinds a standing instruction can carry, so one can be applied without any training. */
export const INSTRUCTION_KINDS: readonly CorrectionKind[] = ['procedure', 'source'];
/** The kinds that may join the teaching queue. */
export const TEACHABLE_KINDS: readonly CorrectionKind[] = ['procedure', 'source', 'weakness'];

/** What the person writes on Teach this about one reply. */
export const CorrectionRequestSchema = z
  .object({
    /** What was wrong with the reply. */
    wrong: z.string().trim().min(1).max(4000),
    /** The behavior or the corrected result they wanted. */
    wanted: z.string().trim().min(1).max(8000).optional(),
    /** Where the right answer can be checked, such as a file or a rule. */
    evidence: z.string().trim().min(1).max(4000).optional(),
    /**
     * The person agreed to send this one exchange, and what they wrote, to the mentor. Nothing
     * leaves this computer without it.
     */
    consent: z.boolean(),
  })
  .strict();
export type CorrectionRequest = z.infer<typeof CorrectionRequestSchema>;

/** The lesson the mentor proposes, shown to the person before anything is queued. */
export const CorrectionProposalSchema = z.object({
  kind: CorrectionKindSchema,
  /** The lesson in a sentence or two, as the queue shows it. */
  lesson: z.string().min(1).max(1000),
  /** Why the mentor read it so. */
  reason: z.string().min(1).max(1000),
  /** For a procedure or a source: the standing instruction it would add. */
  instruction: z.string().min(1).max(2000).optional(),
  /** For an ambiguous request: what the person could say to settle it. */
  question: z.string().min(1).max(1000).optional(),
  /** The job's task type the exchange belongs to, when it is one. */
  taskType: z.string().min(1).optional(),
});
export type CorrectionProposal = z.infer<typeof CorrectionProposalSchema>;

export const CorrectionStatusSchema = z.enum([
  /** Proposed, waiting for the person to queue or discard it. */
  'proposed',
  /** In the teaching queue. */
  'queued',
  /** Applied as an instruction: its candidate version exists. */
  'applied',
  /** Taken by an improvement run that made a candidate version. */
  'used',
  'discarded',
]);
export type CorrectionStatus = z.infer<typeof CorrectionStatusSchema>;

export const CorrectionSchema = z.object({
  id: z.string().regex(/^cor_[a-z0-9]+$/),
  graduateId: z.string().min(1),
  /** The version that wrote the corrected reply. */
  version: z.number().int().positive(),
  chatId: z.string().min(1),
  messageId: z.string().min(1),
  wrong: z.string().min(1),
  wanted: z.string().min(1).optional(),
  evidence: z.string().min(1).optional(),
  proposal: CorrectionProposalSchema,
  status: CorrectionStatusSchema,
  /** The mentor model that read the exchange. */
  mentorModel: z.string(),
  /** What reading it cost, against the cap shown on Teach this. */
  costUsd: z.number().nonnegative(),
  /** When the exchange went to the mentor, with the person's consent. */
  sharedAt: z.iso.datetime(),
  /** The candidate version it went into. */
  candidateVersion: z.number().int().positive().optional(),
  /** The improvement run that has taken it, or took it. */
  runId: z.string().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Correction = z.infer<typeof CorrectionSchema>;

/** The budget Improve agent shows before it starts, and keeps to. */
export const ImproveOptionsSchema = z
  .object({
    maxRounds: z.number().int().min(1).max(10),
    maxMentorUsd: z.number().positive().max(100),
  })
  .strict();
export type ImproveOptions = z.infer<typeof ImproveOptionsSchema>;

/** A run that improves an agent from its queued lessons, starting from one of its versions. */
export const RunImprovementSchema = z.object({
  graduateId: z.string().min(1),
  /** The version it starts from: the active one when it began. */
  version: z.number().int().positive(),
  corrections: z.array(z.string()).min(1),
});
export type RunImprovement = z.infer<typeof RunImprovementSchema>;

export const ImprovementStartSchema = z.object({
  runId: z.string(),
  /** False when another run holds the student: this one waits and starts on its own. */
  started: z.boolean(),
  /** What happens now, in a sentence the person reads. */
  note: z.string(),
});
export type ImprovementStart = z.infer<typeof ImprovementStartSchema>;

/** What an improvement changed and what it didn't, on dev, against the version it started from. */
export const ImprovementSchema = z.object({
  runId: z.string(),
  graduateId: z.string(),
  fromVersion: z.number().int().positive(),
  status: RunStatusSchema,
  corrections: z.array(z.string()),
  budget: ImproveOptionsSchema,
  spentUsd: z.number().nonnegative(),
  dev: z.object({ before: ScoreSchema.nullable(), after: ScoreSchema.nullable() }),
  perType: z.array(
    z.object({ type: z.string(), before: TypeScoreSchema, after: TypeScoreSchema.nullable() }),
  ),
  candidateVersion: z.number().int().positive().optional(),
  promotion: z.object({ allowed: z.boolean(), reason: z.string() }),
});
export type Improvement = z.infer<typeof ImprovementSchema>;
