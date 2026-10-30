import { z } from 'zod';
import { EvaluationStatusSchema } from './package';
import { RowDiffSchema } from './workspace';

/**
 * The `architect` command's JSON contract (docs/CLI.md): what `run --input` reads, what `run
 * --output` writes, and what each exit code means. The keys are snake_case, like every other
 * file Architect writes. Formats carry a version; a new one gets a new number.
 */
export const RUN_REQUEST_FORMAT = 'architect.run-request/1';
export const RUN_RESULT_FORMAT = 'architect.run-result/1';

/** How a command ended, each with its own exit code. */
export const CLI_EXIT_CODES = {
  /** It did what was asked. */
  succeeded: 0,
  /** Something failed while running: the model runtime, a file, the network, a bug. */
  runtime_error: 1,
  /** The command line or the request was malformed or named something that isn't there. */
  invalid_input: 2,
  /** A requirement or permission isn't met: an approval, a folder, a grant, a token. */
  not_permitted: 3,
  /** The agent ran and didn't do the task: it refused, or stopped without an answer. */
  task_failed: 4,
  /** Ctrl+C or a stop signal ended it. */
  cancelled: 130,
} as const;

export const CliOutcomeSchema = z.enum([
  'succeeded',
  'runtime_error',
  'invalid_input',
  'not_permitted',
  'task_failed',
  'cancelled',
]);
export type CliOutcome = z.infer<typeof CliOutcomeSchema>;

/** A file in the agent's folders, by its logical path: `data/orders.csv` or `output/report.md`. */
export const InputReferenceSchema = z
  .string()
  .max(300)
  .regex(/^(data|output)\/[^\\]+$/, 'is not a path in data/ or output/');

/** `architect run <agent> --input request.json`: one task, checked before anything runs. */
export const RunRequestSchema = z
  .object({
    format: z.literal(RUN_REQUEST_FORMAT),
    /** What to do, in the words a person would use in the workspace. */
    task: z
      .string()
      .max(20_000)
      .refine((task) => task.trim() !== '', 'is empty'),
    /** Files the task is about. Each must be one the agent's contract names and may open here. */
    inputs: z.array(InputReferenceSchema).max(50).default([]),
    /** Run only if this is the agent's active version. */
    version: z.number().int().positive().optional(),
  })
  .strict();
export type RunRequest = z.input<typeof RunRequestSchema>;

export const RunStepSchema = z.object({
  /** The tool, or the skill it read. */
  tool: z.string(),
  /** What it acted on, e.g. `data/invoices.csv`. */
  detail: z.string(),
  status: z.enum(['done', 'error', 'running']),
  /** What it found or did, e.g. `4 lines` or `1 row added`. */
  summary: z.string().optional(),
  ms: z.number().int().nonnegative().optional(),
});
export type RunStep = z.infer<typeof RunStepSchema>;

/** A write that needed approval and couldn't get it in a run nobody could answer. */
export const RunApprovalSchema = z.object({
  tool: z.string(),
  file: z.string(),
  summary: z.string(),
  diff: RowDiffSchema.optional(),
  patch: z.string().optional(),
});

/** `architect run <agent> --output result.json`: what happened, always valid JSON. */
export const RunResultSchema = z.object({
  format: z.literal(RUN_RESULT_FORMAT),
  status: CliOutcomeSchema,
  exit_code: z.number().int(),
  /** The agent's answer; null when it gave none. */
  answer: z.string().nullable(),
  /** The agent and version that answered, and how this computer runs it. */
  agent: z
    .object({
      id: z.string(),
      name: z.string(),
      version: z.number().int().positive(),
      /** sha256 of the version's `graduate.json`. */
      digest: z.string(),
      harness_hash: z.string(),
      contract_version: z.number().int().positive(),
      /** The author's evaluation status of this version. */
      evaluation: EvaluationStatusSchema,
      model: z.object({
        label: z.string(),
        runtime: z.string(),
        name: z.string(),
        base_url: z.string(),
      }),
    })
    .nullable(),
  /** The request's input references, as checked. */
  inputs: z.array(z.string()),
  steps: z.array(RunStepSchema),
  /** Files the run changed, by logical path. */
  artifacts: z.array(z.object({ path: z.string(), tool: z.string(), summary: z.string() })),
  approval: RunApprovalSchema.nullable(),
  refusal: z.object({ task_type: z.string(), reason: z.string() }).nullable(),
  error: z
    .object({ code: z.string(), message: z.string(), hint: z.string().optional() })
    .nullable(),
  /** The chat the run was saved in, with `--save`. */
  chat_id: z.string().optional(),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime(),
  duration_ms: z.number().int().nonnegative(),
  /** What ran it. */
  architect: z.object({ cli_version: z.string(), request_format: z.string() }),
});
export type RunResult = z.infer<typeof RunResultSchema>;

/**
 * `architect serve`: one request to POST /v1/chat/completions, as an OpenAI-compatible client
 * sends it. Fields the agent doesn't use (sampling settings, a client's own tools) pass through
 * unread: the agent's harness decides how it answers.
 */
export const ChatCompletionRequestSchema = z.looseObject({
  model: z.string().min(1),
  messages: z
    .array(
      z.looseObject({
        role: z.enum(['system', 'developer', 'user', 'assistant', 'tool']),
        content: z
          .union([
            z.string(),
            z.array(z.looseObject({ type: z.string(), text: z.string().optional() })),
          ])
          .nullable()
          .optional(),
      }),
    )
    .min(1)
    .max(200),
  stream: z.boolean().nullable().optional(),
});
export type ChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

/** What a served reply says about itself, beside the OpenAI fields: `architect` in the response. */
export const ServedReplySchema = z.object({
  /** The version that answered, by its number and harness hash. */
  version: z.number().int().positive(),
  harnessHash: z.string(),
  /** Whether that version answers by agreement under an issued certificate (decision 077). */
  certified: z.boolean(),
  /** For a certified reply: how many of its attempts agreed, of how many, and how many must. */
  agreement: z
    .object({
      agreed: z.number().int().nonnegative(),
      attempts: z.number().int().positive(),
      required: z.number().int().positive(),
    })
    .nullable(),
  /** Too few attempts agreed, so the reply hands the request to a person instead of answering. */
  handedOff: z.boolean(),
  steps: z.array(RunStepSchema),
  /** A change to a file the agent wanted to make. Nothing was written: approvals stay in the app. */
  proposedChange: RunApprovalSchema.nullable(),
  /** The request was outside the agent's job. */
  refusal: z.object({ taskType: z.string(), reason: z.string() }).nullable(),
});
export type ServedReply = z.infer<typeof ServedReplySchema>;

/** The response to a chat completion request that the agent answered. */
export const ChatCompletionSchema = z.object({
  id: z.string(),
  object: z.literal('chat.completion'),
  created: z.number().int(),
  model: z.string(),
  choices: z.array(
    z.object({
      index: z.number().int(),
      message: z.object({ role: z.literal('assistant'), content: z.string() }),
      finish_reason: z.enum(['stop', 'length']),
    }),
  ),
  architect: ServedReplySchema,
});
export type ChatCompletion = z.infer<typeof ChatCompletionSchema>;
