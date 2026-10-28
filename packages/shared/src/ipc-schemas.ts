import { z } from 'zod';
import type { ConnectionTest } from './adapters';
import { GraduateManifestSchema } from './graduate';
import type {
  AddConnectionRequest,
  AddConnectionResult,
  AppInfo,
  AppSettings,
  AppSettingsPatch,
  ClarificationReply,
  CustomEndpoint,
  DraftTurn,
  FileDiff,
  GraduateSettings,
  GraduateSummary,
  HubInstallResult,
  ImportResult,
  JobSummary,
  LlamaServerStatus,
  LocalRuntime,
  LocalRuntimes,
  ModelEntry,
  ModelSource,
  OllamaStatus,
  PullProgress,
  ReferenceOptions,
  RunDetail,
  RunStartOptions,
  SignInResult,
} from './ipc';
import {
  JobSchema,
  MentorConfigSchema,
  PermissionModeSchema,
  ProviderIdSchema,
  StudentEndpointSchema,
  StudentTargetSchema,
} from './job';
import { TokenPricingSchema, type GpuInfo, type StudentBuild } from './models';
import { LineageEntrySchema } from './lineage';
import { MethodSchema, RoundSchema, RunSchema } from './run';
import { AttemptSchema } from './trace';
import { InstallationSchema, InstallStatusSchema, VersionSourceSchema } from './versions';

/*
 * Schemas for the IPC types declared as interfaces in ipc.ts. Each one is checked against its
 * interface with `satisfies`, so the two can't drift apart silently.
 */

export const ThemeSchema = z.enum(['dark', 'light', 'system']);

export const CustomEndpointSchema = z.object({
  baseUrl: z.url(),
  label: z.string().min(1).max(200),
}) satisfies z.ZodType<CustomEndpoint>;

export const AppSettingsSchema = z.object({
  theme: ThemeSchema,
  steps: z.enum(['collapsed', 'expanded']),
  comparisonMode: z.boolean(),
  quietLocalModels: z.boolean(),
  defaultMentor: MentorConfigSchema,
  defaultStudent: StudentEndpointSchema,
  customEndpoints: z.array(CustomEndpointSchema).max(50),
  onboarded: z.boolean(),
  llamaServerPath: z.string().min(1).optional(),
}) satisfies z.ZodType<AppSettings>;

/**
 * What `settings.update` accepts: any subset of fields, and nothing else. The llama-server path
 * isn't among them: Architect runs that program, so only a file the user picked may become it
 * (`connections.chooseLlamaServer`).
 */
export const AppSettingsPatchSchema = AppSettingsSchema.omit({ llamaServerPath: true })
  .partial()
  .strict() satisfies z.ZodType<AppSettingsPatch>;

export const LlamaServerStatusSchema = z.object({
  source: z.enum(['setting', 'path']).nullable(),
  path: z.string().optional(),
  build: z.number().int().nonnegative().optional(),
  ready: z.boolean(),
  problem: z.string().optional(),
  hint: z.string().optional(),
  minimumBuild: z.number().int().positive(),
}) satisfies z.ZodType<LlamaServerStatus>;

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
  activeVersion: z.number().int().positive().nullable(),
  versions: z.number().int().nonnegative(),
  status: InstallStatusSchema,
  reasons: z.array(z.string()),
}) satisfies z.ZodType<GraduateSummary>;

export const ImportResultSchema = z.object({
  graduate: GraduateSummarySchema,
  version: z.number().int().positive(),
  installation: InstallationSchema,
  alreadyInstalled: z.boolean(),
}) satisfies z.ZodType<ImportResult>;

export const HubInstallResultSchema = ImportResultSchema.extend({
  source: VersionSourceSchema,
}) satisfies z.ZodType<HubInstallResult>;

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

/** What `runs.start` accepts, and nothing else: a misspelled option must not be dropped quietly. */
export const RunStartOptionsSchema = z
  .object({
    method: MethodSchema,
    seed: z.number().int().optional(),
    lockedTestOn: StudentTargetSchema.optional(),
    interactive: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<RunStartOptions>;

export const ClarificationReplySchema = z
  .object({ text: z.string().trim().min(1).max(4000), changesCriteria: z.boolean() })
  .strict() satisfies z.ZodType<ClarificationReply>;

export const ReferenceOptionsSchema = z
  .object({ split: z.enum(['dev', 'test']), maxUsd: z.number().positive().max(1000) })
  .strict() satisfies z.ZodType<ReferenceOptions>;

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

export const ModelEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  pricing: TokenPricingSchema.optional(),
  contextLength: z.number().int().positive().optional(),
  sizeBytes: z.number().nonnegative().optional(),
  inMemory: z
    .object({ totalBytes: z.number().nonnegative(), gpuBytes: z.number().nonnegative() })
    .optional(),
}) satisfies z.ZodType<ModelEntry>;

export const GpuInfoSchema = z.object({
  name: z.string(),
  memoryBytes: z.number().nonnegative(),
  shared: z.boolean(),
}) satisfies z.ZodType<GpuInfo>;

export const StudentBuildKeySchema = z.enum(['glimmer-4bit', 'glimmer-gpu']) satisfies z.ZodType<
  StudentBuild['key']
>;

export const ModelSourceSchema = z
  .object({
    provider: ProviderIdSchema,
    baseUrl: z.url(),
    secretRef: z.string().min(1).optional(),
  })
  .strict() satisfies z.ZodType<ModelSource>;

const LocalRuntimeSchema = z.object({
  running: z.boolean(),
  version: z.string().optional(),
  baseUrl: z.string(),
  models: z.array(ModelEntrySchema),
}) satisfies z.ZodType<LocalRuntime>;

export const LocalRuntimesSchema = z.object({
  ollama: LocalRuntimeSchema,
  lmstudio: LocalRuntimeSchema,
  gpu: GpuInfoSchema.nullable(),
}) satisfies z.ZodType<LocalRuntimes>;

/** Longer than any real API key, short enough to catch a paste of the wrong thing. */
export const MAX_KEY_LENGTH = 4096;

export const AddConnectionRequestSchema = z
  .object({
    provider: ProviderIdSchema,
    baseUrl: z.url().optional(),
    key: z.string().max(MAX_KEY_LENGTH).optional(),
  })
  .strict() satisfies z.ZodType<AddConnectionRequest>;

export const AddConnectionResultSchema = z.object({
  secretRef: z.string().optional(),
  models: z.number().int().nonnegative().optional(),
}) satisfies z.ZodType<AddConnectionResult>;

export const SignInResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('signed_in') }),
  z.object({ status: z.literal('cancelled') }),
]) satisfies z.ZodType<SignInResult>;
