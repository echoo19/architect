import { z } from 'zod';

/*
 * Before a field job trains, the teacher studies the train organizations' own material and writes
 * a short brief of what it understood; the person confirms it before anything is taught (decision
 * 069). Every claim carries the passages it rests on, each found word for word in the file it
 * names, or it is marked as the teacher's own.
 */

/** How much a brief may hold, so it stays a short page. */
export const STUDY_LIMITS = {
  maxItems: 12,
  maxQuotes: 4,
  maxSteps: 8,
  maxPassageChars: 400,
  maxTextChars: 400,
} as const;

/** A passage of one organization's file, found there word for word. */
export const StudyQuoteSchema = z.object({
  /** The organization's id. */
  org: z.string().min(1),
  /** The file's name in the organization's `data/` folder. */
  file: z.string().min(1),
  passage: z.string().min(1),
});
export type StudyQuote = z.infer<typeof StudyQuoteSchema>;

/** Something the teacher read in the material, with the passages that show it. */
export const StudyClaimSchema = z.object({
  text: z.string().min(1),
  quotes: z.array(StudyQuoteSchema),
  /** No passage was found for it: it is the teacher's own reading, and says so. */
  own: z.boolean(),
});
export type StudyClaim = z.infer<typeof StudyClaimSchema>;

/** One skill the job asks for, as one of its task types. */
export const StudySkillSchema = StudyClaimSchema.extend({
  taskType: z.string().min(1),
  label: z.string().min(1),
  /** The files the skill reads, by their name in each organization's folder. */
  needs: z.array(z.string().min(1)),
  /** Shared steps, the same for every organization: which file to read, never what it says. */
  steps: z.array(z.string().min(1)),
});
export type StudySkill = z.infer<typeof StudySkillSchema>;

export const StudyBriefSchema = z.object({
  /** The organizations studied: the train ones only. */
  organizations: z.array(z.object({ id: z.string(), name: z.string() })),
  skills: z.array(StudySkillSchema),
  /** How the skills connect, such as a tutoring turn that diagnoses, then hints, then assigns. */
  connections: z.array(StudyClaimSchema),
  rules: z.array(StudyClaimSchema),
  /** Where the organizations differ, such as how many practice questions each assigns. */
  differences: z.array(StudyClaimSchema),
  questions: z.array(z.string().min(1)),
  outOfScope: z.array(z.string().min(1)),
  /** Passages the teacher gave that are not in the file it named, and were taken out. */
  dropped: z.number().int().min(0),
});
export type StudyBrief = z.infer<typeof StudyBriefSchema>;

/** What studying left beside the job (`study.json`). */
export const StudyRecordSchema = z.object({
  format: z.literal(1),
  createdAt: z.iso.datetime(),
  teacher: z.object({ label: z.string(), model: z.string() }),
  cost: z.object({
    calls: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    usd: z.number().min(0),
  }),
  /** Each file studied, by organization, with the hash of its bytes. */
  files: z.array(z.object({ org: z.string(), name: z.string(), sha256: z.string() })),
  brief: StudyBriefSchema,
  confirmedAt: z.iso.datetime().optional(),
});
export type StudyRecord = z.infer<typeof StudyRecordSchema>;

/**
 * Where a field job's study stands. `unstudied`: nothing is studied yet. `needed`: a brief waits
 * for the person. `changed`: the material is not what was studied, so it is studied again.
 * `token` names the brief and the material as the screen shows them, and confirming sends it back.
 */
export const StudyStateSchema = z.object({
  state: z.enum(['unstudied', 'needed', 'confirmed', 'changed']),
  token: z.string(),
  brief: StudyBriefSchema.optional(),
  confirmedAt: z.iso.datetime().optional(),
  problem: z.string().optional(),
});
export type StudyState = z.infer<typeof StudyStateSchema>;
