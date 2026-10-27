import {
  AttemptSchema,
  GraduateManifestSchema,
  JobSchema,
  LineageEntrySchema,
  MentorConfigSchema,
  RoundSchema,
  RunSchema,
  StudentEndpointSchema,
  type AppInfo,
  type AppSettings,
  type GraduateSummary,
  type JobSummary,
  type OllamaStatus,
  type RunDetail,
} from '@architect/shared';
import { z } from 'zod';

/*
 * Schemas for the IPC types that @architect/shared declares only as interfaces. Each one is
 * checked against its interface with `satisfies`, so the two can't drift apart silently.
 */

export const ThemeSchema = z.enum(['dark', 'light', 'system']);

export const AppSettingsSchema = z.object({
  theme: ThemeSchema,
  steps: z.enum(['collapsed', 'expanded']),
  comparisonMode: z.boolean(),
  defaultMentor: MentorConfigSchema,
  defaultStudent: StudentEndpointSchema,
  onboarded: z.boolean(),
}) satisfies z.ZodType<AppSettings>;

/** What `settings.update` accepts: any subset of fields, and nothing else. */
export const AppSettingsPatchSchema = AppSettingsSchema.partial().strict();

export const AppInfoSchema = z.object({
  version: z.string(),
  platform: z.enum(['win32', 'darwin', 'linux']),
  dataPath: z.string(),
  totalMemoryBytes: z.number().nonnegative(),
}) satisfies z.ZodType<AppInfo>;

export const GraduateSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  manifest: GraduateManifestSchema,
  path: z.string(),
}) satisfies z.ZodType<GraduateSummary>;

export const JobSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string().optional(),
  createdAt: z.string(),
  taskCount: z.number().int().nonnegative(),
  latestRun: RunSchema.pick({
    id: true,
    status: true,
    phase: true,
    method: true,
    devCurrent: true,
    devBaseline: true,
  }).optional(),
}) satisfies z.ZodType<JobSummary>;

export const RunDetailSchema = z.object({
  run: RunSchema,
  job: JobSchema,
  rounds: z.array(RoundSchema),
  recentAttempts: z.array(AttemptSchema.extend({ prompt: z.string().optional() })),
  lineage: z.array(LineageEntrySchema),
}) satisfies z.ZodType<RunDetail>;

export const OllamaStatusSchema = z.object({
  running: z.boolean(),
  version: z.string().optional(),
  models: z.array(z.object({ name: z.string(), sizeBytes: z.number(), digest: z.string() })),
}) satisfies z.ZodType<OllamaStatus>;

export const SecretStatusSchema = z.record(z.string(), z.boolean());
