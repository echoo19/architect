import { z } from 'zod';
import { ToolCallSchema, ToolSpecSchema } from './chat';
import { CheckResultSchema } from './checker';
import { JsonValueSchema } from './json';
import { SplitNameSchema } from './task';

/*
 * Contracts for weight training: the verified episodes lessons hand to the dataset builder, the
 * dataset files the trainer reads, the trainer's job file and output manifest, and the durable
 * record of a training job. Files the Python trainer reads or writes use snake_case keys, like
 * the other files Architect writes for people and other tools; the job record is the engine's
 * own state and uses camelCase.
 */

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const gitCommit = z.string().regex(/^[0-9a-f]{40}$/);

/** How a lesson's target behavior was obtained (spec section 6). */
export const EpisodeKindSchema = z.enum([
  /** Resumed from a saved state between tool batches; the continuation passed the checker. */
  'replay_correction',
  /** Replay wasn't reliable, so a whole attempt was redone and verified. Never shown as a repair. */
  'full_task_demonstration',
  /** A related case with varied records or wording, its label validated independently. */
  'practice',
  /** A correction the user accepted from Teach this, verified before it joined the queue. */
  'user_correction',
]);
export type EpisodeKind = z.infer<typeof EpisodeKindSchema>;

const EpisodeAssistantSchema = z.object({
  role: z.literal('assistant'),
  content: z.string(),
  toolCalls: z.array(ToolCallSchema).optional(),
  /** The model's reasoning before this turn, when the episode kept it. */
  reasoning: z.string().optional(),
});

/** A chat message as the student saw or produced it; plain trace messages qualify as they are. */
export const EpisodeMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string() }),
  z.object({ role: z.literal('user'), content: z.string() }),
  EpisodeAssistantSchema,
  z.object({
    role: z.literal('tool'),
    toolCallId: z.string(),
    name: z.string(),
    content: z.string(),
  }),
]);
export type EpisodeMessage = z.infer<typeof EpisodeMessageSchema>;

/** Where the episode's request came from. */
export const EpisodeOriginSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('task'),
    taskId: z.string().min(1),
    split: SplitNameSchema,
  }),
  z.object({
    kind: z.literal('workspace'),
    chatId: z.string().min(1),
    messageId: z.string().min(1),
  }),
]);
export type EpisodeOrigin = z.infer<typeof EpisodeOriginSchema>;

/**
 * What the dataset builder takes: one conversation whose outcome the independent checker passed,
 * with the assistant turns that are verified targets named by index. Only those turns are ever
 * trained on; everything else in the conversation is context.
 */
export const VerifiedEpisodeSchema = z.object({
  /** Stable id: the same episode always builds the same example. */
  id: z.string().min(1),
  lessonId: z.string().min(1),
  kind: EpisodeKindSchema,
  /** The capability category the lesson teaches, from the task family. */
  category: z.string().min(1),
  origin: EpisodeOriginSchema,
  /** The whole conversation, system prompt first. */
  messages: z.array(EpisodeMessageSchema).min(2),
  /** The tools the student could call, as it saw them. */
  tools: z.array(ToolSpecSchema),
  /** Indices into `messages` of the verified assistant turns. */
  verifiedTurns: z.array(z.number().int().nonnegative()).min(1),
  /** The independent checker's verdict on the episode's outcome. */
  check: CheckResultSchema,
  /** How the chat template rendered when the student ran. */
  template: z.object({
    reasoningStrength: z.enum(['low', 'medium', 'high']),
    currentDate: z.iso.date().optional(),
  }),
  provenance: z.object({
    jobId: z.string().min(1),
    runId: z.string().optional(),
    attemptId: z.string().optional(),
    harnessVersion: z.number().int().nonnegative().optional(),
    studentModel: z.string().min(1),
    /** The model that wrote the correction, for corrections. */
    mentorModel: z.string().optional(),
    /** For a replay correction: the trace step the continuation resumed from. */
    replayFromStep: z.number().int().nonnegative().optional(),
    /** Content hashes of the inputs and starting tables the episode ran on. */
    inputHashes: z.record(z.string(), sha256Hex).optional(),
    verifiedAt: z.iso.datetime(),
  }),
  /** Whether the episode's content may leave this computer for remote training. */
  sharing: z.object({ remoteTraining: z.boolean() }),
});
export type VerifiedEpisode = z.infer<typeof VerifiedEpisodeSchema>;

/* The dataset: `dataset.json` beside a JSON Lines file of examples. */

export const DATASET_FORMAT = 'architect.chat-dataset/1';
export const DATASET_EXAMPLE_FORMAT = 'architect.chat-example/1';

const DatasetToolCallSchema = z.strictObject({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.strictObject({
    name: z.string().min(1),
    /** An object, never a JSON string: chat templates render the arguments from it. */
    arguments: z.record(z.string(), JsonValueSchema),
  }),
});

/** One message in the Hugging Face chat format, plus whether it is a training target. */
export const DatasetMessageSchema = z.discriminatedUnion('role', [
  z.strictObject({ role: z.literal('system'), content: z.string(), train: z.literal(false) }),
  z.strictObject({ role: z.literal('user'), content: z.string(), train: z.literal(false) }),
  z.strictObject({
    role: z.literal('assistant'),
    content: z.string(),
    reasoning_content: z.string().optional(),
    tool_calls: z.array(DatasetToolCallSchema).optional(),
    train: z.boolean(),
  }),
  z.strictObject({
    role: z.literal('tool'),
    tool_call_id: z.string().min(1),
    name: z.string().min(1),
    content: z.string(),
    train: z.literal(false),
  }),
]);
export type DatasetMessage = z.infer<typeof DatasetMessageSchema>;

export const DatasetToolSchema = z.strictObject({
  type: z.literal('function'),
  function: z.strictObject({
    name: z.string().min(1),
    description: z.string(),
    parameters: z.record(z.string(), z.unknown()),
  }),
});
export type DatasetTool = z.infer<typeof DatasetToolSchema>;

/** One line of the examples file. */
export const DatasetExampleSchema = z.strictObject({
  format: z.literal(DATASET_EXAMPLE_FORMAT),
  id: z.string().min(1),
  episode_id: z.string().min(1),
  lesson_id: z.string().min(1),
  kind: EpisodeKindSchema,
  category: z.string().min(1),
  messages: z.array(DatasetMessageSchema).min(2),
  tools: z.array(DatasetToolSchema),
  chat_template_kwargs: z.strictObject({
    reasoning_strength: z.enum(['low', 'medium', 'high']),
    current_date: z.iso.date().optional(),
  }),
  provenance: z.strictObject({
    job_id: z.string().min(1),
    origin: z.string().min(1),
    run_id: z.string().optional(),
    attempt_id: z.string().optional(),
    harness_version: z.number().int().nonnegative().optional(),
    student_model: z.string().min(1),
    mentor_model: z.string().optional(),
    replay_from_step: z.number().int().nonnegative().optional(),
    input_hashes: z.record(z.string(), sha256Hex).optional(),
    verified_at: z.iso.datetime(),
    check_reason: z.string().min(1),
  }),
});
export type DatasetExample = z.infer<typeof DatasetExampleSchema>;

export const DatasetManifestSchema = z.strictObject({
  format: z.literal(DATASET_FORMAT),
  created_at: z.iso.datetime(),
  examples_file: z.literal('examples.jsonl'),
  examples_sha256: sha256Hex,
  example_count: z.number().int().positive(),
  /** Assistant turns flagged as training targets, over all examples. */
  trained_turns: z.number().int().positive(),
  categories: z.record(z.string(), z.number().int().positive()),
  kinds: z.record(z.string(), z.number().int().positive()),
  /** Every example may be sent to remote compute for training. */
  remote_training_allowed: z.boolean(),
  /** Episodes the builder left out, and why. */
  excluded: z.array(z.strictObject({ episode_id: z.string(), reason: z.string() })),
});
export type DatasetManifest = z.infer<typeof DatasetManifestSchema>;

/* The trainer: its pinned recipe, the job file the app writes and the manifest the job returns. */

export const TRAINER_RECIPE_FORMAT = 'architect.trainer-recipe/1';
export const TRAINER_JOB_FORMAT = 'architect.trainer-job/1';
export const TRAINER_OUTPUT_FORMAT = 'architect.trainer-output/1';

const LoraSettingsSchema = z.strictObject({
  r: z.number().int().min(1).max(256),
  alpha: z.number().positive(),
  dropout: z.number().min(0).max(0.5),
  /** A regular expression over module names that PEFT matches in full. */
  target_modules: z.string().min(1),
  /** llama.cpp scales an adapter by alpha / r, so rank-stabilized scaling would not match it. */
  use_rslora: z.literal(false),
  /** llama.cpp has no DoRA, so the adapter must be plain LoRA. */
  use_dora: z.literal(false),
});

const TrainingSettingsSchema = z.strictObject({
  epochs: z.number().positive().max(20),
  learning_rate: z.number().positive().max(0.01),
  lr_scheduler: z.enum(['constant', 'linear', 'cosine']),
  warmup_steps: z.number().int().nonnegative(),
  per_device_batch_size: z.number().int().positive(),
  gradient_accumulation_steps: z.number().int().positive(),
  /** Longer examples are dropped and listed, never cut, so no target loses its end. */
  max_seq_len: z.number().int().min(512).max(131_072),
  seed: z.number().int().nonnegative(),
  optimizer: z.string().min(1),
  gradient_checkpointing: z.boolean(),
});

const QuantizationSchema = z.strictObject({
  load_in_4bit: z.literal(true),
  quant_type: z.enum(['nf4', 'fp4']),
  double_quant: z.boolean(),
  compute_dtype: z.enum(['bfloat16', 'float16']),
});

const ConverterSchema = z.strictObject({
  repo: z.url(),
  commit: gitCommit,
  /** The llama.cpp build number of that commit, for people reading the record. */
  build: z.number().int().positive(),
  outtype: z.enum(['f32', 'f16', 'bf16', 'q8_0']),
});

/** `trainer/recipe.json`: everything pinned about how an adapter is trained and converted. */
export const TrainerRecipeSchema = z.strictObject({
  format: z.literal(TRAINER_RECIPE_FORMAT),
  name: z.string().min(1),
  version: z.number().int().positive(),
  /** A container image pinned by digest. */
  image: z.string().regex(/^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/),
  /** Installed before the job downloads its inputs. */
  bootstrap_packages: z.array(z.string().regex(/^[A-Za-z0-9_.-]+==[\w.+-]+$/)).min(1),
  /** Installed for training, each pinned to one version. */
  python_packages: z.array(z.string().regex(/^[A-Za-z0-9_.-]+==[\w.+-]+$/)).min(1),
  quantization: QuantizationSchema,
  lora: LoraSettingsSchema,
  training: TrainingSettingsSchema,
  converter: ConverterSchema,
  hardware: z.strictObject({
    flavor: z.string().min(1),
    min_gpu_memory_gb: z.number().positive(),
  }),
  /** Files in the trainer folder the job runs; uploaded with its inputs. */
  files: z.array(z.string().regex(/^[\w.-]+$/)).min(1),
  /** The script the job starts. */
  entry: z.string().regex(/^[\w.-]+\.py$/),
});
export type TrainerRecipe = z.infer<typeof TrainerRecipeSchema>;

/** `job.json`: one training job, as the trainer reads it. */
export const TrainerJobSchema = z.strictObject({
  format: z.literal(TRAINER_JOB_FORMAT),
  job_id: z.string().min(1),
  base_model: z.strictObject({ repo: z.string().min(1), revision: gitCommit }),
  dataset: z.strictObject({
    manifest: z.literal('dataset.json'),
    examples: z.literal('examples.jsonl'),
    sha256: sha256Hex,
    example_count: z.number().int().positive(),
  }),
  recipe: z.strictObject({
    name: z.string().min(1),
    version: z.number().int().positive(),
    sha256: sha256Hex,
  }),
  python_packages: z.array(z.string()).min(1),
  quantization: QuantizationSchema,
  lora: LoraSettingsSchema,
  training: TrainingSettingsSchema,
  converter: ConverterSchema,
  /** The job stops itself before this, leaving time to convert and upload. */
  max_seconds: z.number().int().positive(),
  /** Where the job uploads its outputs; null keeps them on the machine that ran it. */
  output: z.strictObject({
    repo: z.string().min(1).nullable(),
    path_in_repo: z.literal('outputs'),
  }),
});
export type TrainerJob = z.infer<typeof TrainerJobSchema>;

export const TrainerOutputFileSchema = z.strictObject({
  /** Relative to the outputs folder, with forward slashes. */
  path: z.string().regex(/^(?!\/)(?!.*\.\.)[\w./-]+$/),
  sha256: sha256Hex,
  bytes: z.number().int().nonnegative(),
  kind: z.enum(['peft_config', 'peft_weights', 'gguf_lora', 'log']),
});
export type TrainerOutputFile = z.infer<typeof TrainerOutputFileSchema>;

/** `outputs/manifest.json`: what a finished job produced, with hashes of every file. */
export const TrainerOutputSchema = z.strictObject({
  format: z.literal(TRAINER_OUTPUT_FORMAT),
  job_id: z.string().min(1),
  /** True only for the stand-in backend: no model was trained. */
  stand_in: z.boolean(),
  base_model: z.strictObject({ repo: z.string().min(1), revision: z.string().min(1) }),
  dataset: z.strictObject({
    sha256: sha256Hex,
    example_count: z.number().int().nonnegative(),
    trained_examples: z.number().int().nonnegative(),
    trained_tokens: z.number().int().nonnegative(),
    skipped: z.array(z.strictObject({ id: z.string(), reason: z.string() })),
  }),
  recipe: z.strictObject({
    name: z.string().min(1),
    version: z.number().int().positive(),
    sha256: sha256Hex,
  }),
  lora: z.strictObject({
    r: z.number().int().positive(),
    alpha: z.number().positive(),
    target_modules: z.string(),
  }),
  converter: z.strictObject({ commit: z.string(), outtype: z.string() }),
  versions: z.record(z.string(), z.string()),
  metrics: z.strictObject({
    steps: z.number().int().nonnegative(),
    loss_first: z.number().nullable(),
    loss_last: z.number().nullable(),
    train_seconds: z.number().nonnegative(),
    convert_seconds: z.number().nonnegative(),
    /** Training reached the job's time limit before its last epoch and kept what it had. */
    stopped_early: z.boolean(),
  }),
  files: z.array(TrainerOutputFileSchema).min(1),
});
export type TrainerOutput = z.infer<typeof TrainerOutputSchema>;

/* The durable record of one training job. */

export const TrainingBackendKindSchema = z.enum(['hf-jobs', 'stand-in']);
export type TrainingBackendKind = z.infer<typeof TrainingBackendKindSchema>;

/**
 * - submitting: written before the backend is asked, so a crash can't lose a submitted job
 * - queued, running, cancelling: the provider has it
 * - succeeded: the provider finished; artifacts not yet downloaded
 * - ready: artifacts downloaded and verified against the job's manifest
 * - failed, cancelled: ended without an adapter
 */
export const TrainingJobStateSchema = z.enum([
  'submitting',
  'queued',
  'running',
  'cancelling',
  'succeeded',
  'ready',
  'failed',
  'cancelled',
]);
export type TrainingJobState = z.infer<typeof TrainingJobStateSchema>;

export const TERMINAL_TRAINING_STATES: ReadonlySet<TrainingJobState> = new Set([
  'ready',
  'failed',
  'cancelled',
]);

export const TrainingArtifactSchema = z.object({
  kind: z.enum(['peft_config', 'peft_weights', 'gguf_lora', 'log', 'manifest']),
  /** Relative to the job's folder, with forward slashes. */
  path: z.string().min(1),
  sha256: sha256Hex,
  bytes: z.number().int().nonnegative(),
});
export type TrainingArtifact = z.infer<typeof TrainingArtifactSchema>;

export const TrainingJobRecordSchema = z.object({
  format: z.literal(1),
  id: z.string().regex(/^trn_[a-z0-9]+$/),
  /** Same dataset, base, recipe, backend and settings: same key, so a job never runs twice. */
  idempotencyKey: sha256Hex,
  /** Whose compute budget pays for it: a job or run id. */
  scope: z.string().min(1),
  backend: TrainingBackendKindSchema,
  /** False for the stand-in backend, whose adapters were never trained. */
  real: z.boolean(),
  /** What every screen and report calls this job's backend. */
  label: z.string().min(1),
  state: TrainingJobStateSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  dataset: z.object({
    sha256: sha256Hex,
    exampleCount: z.number().int().positive(),
    trainedTurns: z.number().int().positive(),
  }),
  baseModel: z.object({ repo: z.string().min(1), revision: gitCommit }),
  recipe: z.object({
    name: z.string().min(1),
    version: z.number().int().positive(),
    sha256: sha256Hex,
  }),
  /** The backend's own handle on the job, as it returned it. */
  provider: z.record(z.string(), JsonValueSchema).nullable(),
  providerUrl: z.string().nullable(),
  compute: z.object({
    flavor: z.string().min(1),
    pricePerHourUsd: z.number().nonnegative(),
    /** The longest the job may run; the provider stops it there too. */
    authorizedSeconds: z.number().int().nonnegative(),
    authorizedUsd: z.number().nonnegative(),
    startedAt: z.iso.datetime().nullable(),
    endedAt: z.iso.datetime().nullable(),
    /** From the provider's start of the job to its end as observed: an upper bound on billing. */
    seconds: z.number().nonnegative(),
    usd: z.number().nonnegative(),
  }),
  artifacts: z
    .object({
      /** The output repository's immutable revision, for a backend that has one. */
      revision: z.string().nullable(),
      files: z.array(TrainingArtifactSchema).min(1),
      /** The GGUF LoRA, relative to the job's folder. */
      ggufLora: z.string().min(1),
      /** The adapter carries the stand-in label: it was built, not trained. */
      standIn: z.boolean(),
      trainSeconds: z.number().nonnegative().nullable(),
    })
    .nullable(),
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }).nullable(),
  history: z.array(
    z.object({ at: z.iso.datetime(), state: TrainingJobStateSchema, note: z.string() }),
  ),
});
export type TrainingJobRecord = z.infer<typeof TrainingJobRecordSchema>;
