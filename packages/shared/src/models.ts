import type { SecretRef } from './secrets';

/**
 * Model ids, endpoints and prices used as defaults. This file mirrors docs/MODELS.md and is the
 * only place in the code that names a specific model.
 */

export interface TokenPricing {
  /** US dollars per million input tokens. */
  inputPerM: number;
  /** US dollars per million cached input tokens. */
  cachedInputPerM: number;
  /** US dollars per million output tokens (reasoning tokens bill as output). */
  outputPerM: number;
}

export type MentorPresetKey =
  'meta-spark' | 'meta-spark-contributor' | 'baseten-spark-open' | 'modal-spark-open';

export interface MentorPreset {
  key: MentorPresetKey;
  label: string;
  provider: 'meta' | 'baseten' | 'modal';
  baseUrl: string;
  model: string;
  /** The stored key this endpoint uses. */
  secretRef: SecretRef;
  pricing: TokenPricing;
  /** Whether the endpoint supports `response_format: json_schema`. */
  structuredOutput: boolean;
  /** Plain-language consequence shown next to the choice. */
  note: string;
}

export interface StudentPreset {
  key: 'ollama-glimmer' | 'together-glimmer' | 'openrouter-glimmer' | 'deepinfra-glimmer';
  label: string;
  runtime: 'ollama' | 'openai_compatible';
  baseUrl: string;
  model: string;
  /** The stored key a hosted endpoint uses; none for local runtimes. */
  secretRef?: SecretRef;
  /** Null for local runtimes. */
  pricing: TokenPricing | null;
  note: string;
}

export const META_API_BASE_URL = 'https://api.meta.ai/v1';
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

const SPARK_STANDARD: TokenPricing = { inputPerM: 1.25, cachedInputPerM: 0.15, outputPerM: 4.25 };
const SPARK_CONTRIBUTOR: TokenPricing = { inputPerM: 0.1, cachedInputPerM: 0.002, outputPerM: 0.2 };

export const MENTOR_PRESETS: readonly MentorPreset[] = [
  {
    key: 'meta-spark',
    label: 'Muse Spark 1.3',
    provider: 'meta',
    baseUrl: META_API_BASE_URL,
    model: 'muse-spark-1.3',
    secretRef: 'meta',
    pricing: SPARK_STANDARD,
    structuredOutput: true,
    note: 'Meta does not train on what you send.',
  },
  {
    key: 'meta-spark-contributor',
    label: 'Muse Spark 1.3, contributor tier',
    provider: 'meta',
    baseUrl: META_API_BASE_URL,
    model: 'muse-spark-1.3-contributor',
    secretRef: 'meta',
    pricing: SPARK_CONTRIBUTOR,
    structuredOutput: true,
    note: 'A tenth of the price or less, but Meta may train on what you send. Only for data that is not sensitive or personal.',
  },
  {
    key: 'baseten-spark-open',
    label: 'Muse Spark Open on Baseten',
    provider: 'baseten',
    baseUrl: 'https://inference.baseten.co/v1',
    model: 'meta-models/muse-spark-open-1026',
    secretRef: 'baseten',
    pricing: SPARK_STANDARD,
    structuredOutput: false,
    note: 'Open weights on a GPU host you choose; nothing goes to a closed model API.',
  },
  {
    key: 'modal-spark-open',
    label: 'Muse Spark Open on Modal',
    provider: 'modal',
    baseUrl: 'https://inference.us-west.modal.direct/v1',
    model: 'meta-models/Muse-Spark-Open-816B-A42B',
    secretRef: 'modal',
    pricing: SPARK_STANDARD,
    structuredOutput: false,
    note: 'Open weights on your own Modal endpoint.',
  },
];

export const STUDENT_PRESETS: readonly StudentPreset[] = [
  {
    key: 'ollama-glimmer',
    label: 'Muse Glimmer on this computer',
    runtime: 'ollama',
    baseUrl: OLLAMA_BASE_URL,
    model: 'muse-glimmer:30b',
    pricing: null,
    note: 'Runs locally through Ollama. 18 GB download.',
  },
  {
    key: 'together-glimmer',
    label: 'Muse Glimmer on Together',
    runtime: 'openai_compatible',
    baseUrl: 'https://api.together.ai/v1',
    model: 'meta-models/Muse-Glimmer-30B',
    secretRef: 'together',
    pricing: { inputPerM: 0.35, cachedInputPerM: 0.04, outputPerM: 1.5 },
    note: 'Hosted copy for faster training. Your tasks leave this computer while training.',
  },
  {
    key: 'openrouter-glimmer',
    label: 'Muse Glimmer on OpenRouter',
    runtime: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'meta/muse-glimmer-30b',
    secretRef: 'openrouter',
    pricing: { inputPerM: 0.3, cachedInputPerM: 0.04, outputPerM: 1.2 },
    note: 'Hosted copy for faster training. Your tasks leave this computer while training.',
  },
  {
    key: 'deepinfra-glimmer',
    label: 'Muse Glimmer on DeepInfra',
    runtime: 'openai_compatible',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    model: 'meta-models/Muse-Glimmer-30B',
    secretRef: 'deepinfra',
    pricing: { inputPerM: 0.3, cachedInputPerM: 0.04, outputPerM: 1.2 },
    note: 'Hosted copy for faster training. Your tasks leave this computer while training.',
  },
];

export const DEFAULT_MENTOR_PRESET: MentorPresetKey = 'meta-spark';

export const DEFAULT_STUDENT = {
  label: 'Glimmer',
  family: 'Muse Glimmer',
  runtime: 'ollama' as const,
  baseUrl: OLLAMA_BASE_URL,
  model: 'muse-glimmer:30b',
  /** Ollama defaults to a 4k context on GPUs under 24 GiB, so always ask for this much. */
  contextLength: 16_384,
};

/** Meta's recommended sampling for Muse Glimmer; greedy decoding makes it repetitive. */
export const GLIMMER_SAMPLING = { temperature: 1, topP: 0.95, topK: 64 } as const;

export function mentorPreset(key: MentorPresetKey): MentorPreset {
  const preset = MENTOR_PRESETS.find((p) => p.key === key);
  if (!preset) throw new Error(`Unknown mentor preset: ${key}`);
  return preset;
}

export function costUsd(
  pricing: TokenPricing,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
): number {
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  return (
    (fresh * pricing.inputPerM +
      cached * pricing.cachedInputPerM +
      usage.outputTokens * pricing.outputPerM) /
    1_000_000
  );
}
