import { z } from 'zod';
import type { ConnectionTest } from './adapters';
import { GraduateManifestSchema } from './graduate';
import type {
  AppInfo,
  AppSettings,
  DraftTurn,
  FileDiff,
  GraduateSettings,
  GraduateSummary,
  JobSummary,
  OllamaStatus,
  PullProgress,
  RunDetail,
} from './ipc';
import { JobSchema, MentorConfigSchema, PermissionModeSchema, StudentEndpointSchema } from './job';
import { LineageEntrySchema } from './lineage';
import { RoundSchema, RunSchema } from './run';
import { AttemptSchema } from './trace';

/*
 * Schemas for the IPC types declared as interfaces in ipc.ts. Each one is checked against its
 * interface with `satisfies`, so the two can't drift apart silently.
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

export const GraduateSettingsSchema = z.object({
  writeMode: PermissionModeSchema,
}) satisfies z.ZodType<GraduateSettings>;

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

export const FileDiffSchema = z.object({
  path: z.string(),
  status: z.enum(['added', 'modified', 'deleted']),
  patch: z.string(),
}) satisfies z.ZodType<FileDiff>;

export const DraftTurnSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
  options: z.array(z.string()),
  draft: JobSchema.optional(),
}) satisfies z.ZodType<DraftTurn>;

export const OllamaStatusSchema = z.object({
  running: z.boolean(),
  version: z.string().optional(),
  models: z.array(z.object({ name: z.string(), sizeBytes: z.number(), digest: z.string() })),
}) satisfies z.ZodType<OllamaStatus>;

export const PullProgressSchema = z.object({
  model: z.string(),
  status: z.string(),
  completedBytes: z.number().nonnegative().optional(),
  totalBytes: z.number().nonnegative().optional(),
  done: z.boolean(),
  error: z.string().optional(),
}) satisfies z.ZodType<PullProgress>;

export const SecretStatusSchema = z.record(z.string(), z.boolean());

export const ConnectionTestSchema = z.union([
  z.object({ ok: z.literal(true), latencyMs: z.number().nonnegative(), detail: z.string() }),
  z.object({ ok: z.literal(false), error: z.string(), hint: z.string().optional() }),
]) satisfies z.ZodType<ConnectionTest>;
