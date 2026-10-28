import { z } from 'zod';
import { isLoopbackUrl } from './net';
import type { NamedSecretRef } from './secrets';

/**
 * Providers, model ids, endpoints and prices used as defaults. This file mirrors docs/MODELS.md
 * and is the only place in the code that names a specific model.
 */

export interface PriceRates {
  /** US dollars per million input tokens. */
  inputPerM: number;
  /** US dollars per million cached input tokens. */
  cachedInputPerM: number;
  /** US dollars per million output tokens (reasoning tokens bill as output). */
  outputPerM: number;
}

export interface TokenPricing extends PriceRates {
  /**
   * Higher rates for a long prompt. A call whose input passes `aboveInputTokens` is billed at
   * these rates for all of its tokens, the way OpenAI, Anthropic and Google bill long prompts.
   */
  longContext?: PriceRates & { aboveInputTokens: number };
}

const rate = z.number().min(0).max(10_000);

const PriceRatesSchema = z.object({
  inputPerM: rate,
  cachedInputPerM: rate,
  outputPerM: rate,
});

export const TokenPricingSchema = PriceRatesSchema.extend({
  longContext: PriceRatesSchema.extend({
    aboveInputTokens: z.number().int().positive(),
  }).optional(),
}) satisfies z.ZodType<TokenPricing>;

/** Who serves a model. `other` is any OpenAI-compatible endpoint at an address the user enters. */
export const PROVIDER_IDS = [
  'meta',
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'groq',
  'together',
  'deepinfra',
  'fireworks',
  'baseten',
  'modal',
  'ollama',
  'lmstudio',
  'other',
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  label: string;
  /** Where its API answers. Empty for `other`, whose address the user enters. */
  baseUrl: string;
  /** The stored key it uses. Local runtimes need none; an added endpoint's key is bound to its host. */
  secretRef?: NamedSecretRef;
  /** Runs on this computer: no key, no bill, and nothing leaves the machine. */
  local: boolean;
  /** Where people make a key, or download the runtime. */
  page?: string;
}

export const META_API_BASE_URL = 'https://api.meta.ai/v1';
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const LMSTUDIO_BASE_URL = 'http://127.0.0.1:1234/v1';
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const PROVIDERS: Readonly<Record<ProviderId, ProviderInfo>> = {
  meta: {
    label: 'Meta',
    baseUrl: META_API_BASE_URL,
    secretRef: 'meta',
    local: false,
    page: 'https://dev.meta.ai',
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    secretRef: 'openai',
    local: false,
    page: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    secretRef: 'anthropic',
    local: false,
    page: 'https://platform.claude.com/settings/keys',
  },
  gemini: {
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    secretRef: 'gemini',
    local: false,
    page: 'https://aistudio.google.com/apikey',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: OPENROUTER_BASE_URL,
    secretRef: 'openrouter',
    local: false,
    page: 'https://openrouter.ai/settings/keys',
  },
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    secretRef: 'groq',
    local: false,
    page: 'https://console.groq.com/keys',
  },
  together: {
    label: 'Together',
    baseUrl: 'https://api.together.ai/v1',
    secretRef: 'together',
    local: false,
    page: 'https://api.together.ai/settings/api-keys',
  },
  deepinfra: {
    label: 'DeepInfra',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    secretRef: 'deepinfra',
    local: false,
    page: 'https://deepinfra.com/dash/api_keys',
  },
  fireworks: {
    label: 'Fireworks',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    secretRef: 'fireworks',
    local: false,
    page: 'https://app.fireworks.ai/settings/users/api-keys',
  },
  baseten: {
    label: 'Baseten',
    baseUrl: 'https://inference.baseten.co/v1',
    secretRef: 'baseten',
    local: false,
    page: 'https://app.baseten.co/settings/api_keys',
  },
  modal: {
    label: 'Modal',
    baseUrl: 'https://inference.us-west.modal.direct/v1',
    secretRef: 'modal',
    local: false,
    page: 'https://modal.com',
  },
  ollama: {
    label: 'Ollama',
    baseUrl: OLLAMA_BASE_URL,
    local: true,
    page: 'https://ollama.com/download',
  },
  lmstudio: {
    label: 'LM Studio',
    baseUrl: LMSTUDIO_BASE_URL,
    local: true,
    page: 'https://lmstudio.ai',
  },
  other: { label: 'Other', baseUrl: '', local: false },
};

export function providerInfo(provider: ProviderId): ProviderInfo {
  return PROVIDERS[provider];
}

export type MentorPresetKey =
  | 'meta-spark'
  | 'meta-spark-contributor'
  | 'openai-gpt-6-1-sol'
  | 'openai-gpt-6-luna'
  | 'anthropic-opus'
  | 'anthropic-sonnet'
  | 'anthropic-haiku'
  | 'gemini-pro'
  | 'gemini-flash-lite'
  | 'baseten-spark-open'
  | 'modal-spark-open';

export interface MentorPreset {
  key: MentorPresetKey;
  label: string;
  provider: ProviderId;
  baseUrl: string;
  model: string;
  /** The stored key this endpoint uses. */
  secretRef: NamedSecretRef;
  pricing: TokenPricing;
  /** Plain-language consequence shown next to the choice, when there is one worth saying. */
  note?: string;
}

export interface StudentPreset {
  key: 'ollama-glimmer' | 'together-glimmer' | 'openrouter-glimmer' | 'deepinfra-glimmer';
  label: string;
  runtime: 'ollama' | 'openai_compatible';
  baseUrl: string;
  model: string;
  /** The stored key a hosted endpoint uses; none for local runtimes. */
  secretRef?: NamedSecretRef;
  /** Null for local runtimes. */
  pricing: TokenPricing | null;
  note: string;
}

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
    note: 'A tenth of the price or less, but Meta may train on what you send. Only for data that is not sensitive or personal.',
  },
  {
    key: 'openai-gpt-6-1-sol',
    label: 'GPT-6.1 Sol',
    provider: 'openai',
    baseUrl: PROVIDERS.openai.baseUrl,
    model: 'gpt-6.1-sol',
    secretRef: 'openai',
    pricing: {
      inputPerM: 2,
      cachedInputPerM: 0.1,
      outputPerM: 10,
      longContext: {
        aboveInputTokens: 272_000,
        inputPerM: 4,
        cachedInputPerM: 0.2,
        outputPerM: 15,
      },
    },
  },
  {
    key: 'openai-gpt-6-luna',
    label: 'GPT-6 Luna',
    provider: 'openai',
    baseUrl: PROVIDERS.openai.baseUrl,
    model: 'gpt-6-luna',
    secretRef: 'openai',
    pricing: {
      inputPerM: 0.1,
      cachedInputPerM: 0.01,
      outputPerM: 0.5,
      longContext: {
        aboveInputTokens: 272_000,
        inputPerM: 0.2,
        cachedInputPerM: 0.02,
        outputPerM: 0.75,
      },
    },
  },
  {
    key: 'anthropic-opus',
    label: 'Claude Opus 5.5',
    provider: 'anthropic',
    baseUrl: PROVIDERS.anthropic.baseUrl,
    model: 'claude-opus-5-5',
    secretRef: 'anthropic',
    pricing: { inputPerM: 4, cachedInputPerM: 0.2, outputPerM: 20 },
  },
  {
    key: 'anthropic-sonnet',
    label: 'Claude Sonnet 5.5',
    provider: 'anthropic',
    baseUrl: PROVIDERS.anthropic.baseUrl,
    model: 'claude-sonnet-5-5',
    secretRef: 'anthropic',
    pricing: { inputPerM: 2, cachedInputPerM: 0.1, outputPerM: 10 },
  },
  {
    key: 'anthropic-haiku',
    label: 'Claude Haiku 5.5',
    provider: 'anthropic',
    baseUrl: PROVIDERS.anthropic.baseUrl,
    model: 'claude-haiku-5-5',
    secretRef: 'anthropic',
    pricing: {
      inputPerM: 0.1,
      cachedInputPerM: 0.01,
      outputPerM: 0.5,
      longContext: {
        aboveInputTokens: 100_000,
        inputPerM: 0.5,
        cachedInputPerM: 0.05,
        outputPerM: 2.5,
      },
    },
  },
  {
    key: 'gemini-pro',
    label: 'Gemini 3.1 Pro',
    provider: 'gemini',
    baseUrl: PROVIDERS.gemini.baseUrl,
    model: 'gemini-3.1-pro-preview',
    secretRef: 'gemini',
    pricing: {
      inputPerM: 2,
      cachedInputPerM: 0.2,
      outputPerM: 12,
      longContext: {
        aboveInputTokens: 200_000,
        inputPerM: 4,
        cachedInputPerM: 0.4,
        outputPerM: 18,
      },
    },
  },
  {
    key: 'gemini-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    provider: 'gemini',
    baseUrl: PROVIDERS.gemini.baseUrl,
    model: 'gemini-3.5-flash-lite',
    secretRef: 'gemini',
    pricing: { inputPerM: 0.3, cachedInputPerM: 0.03, outputPerM: 2.5 },
  },
  {
    key: 'baseten-spark-open',
    label: 'Muse Spark Open on Baseten',
    provider: 'baseten',
    baseUrl: PROVIDERS.baseten.baseUrl,
    model: 'meta-models/muse-spark-open-1026',
    secretRef: 'baseten',
    pricing: SPARK_STANDARD,
    note: 'Open weights on a GPU host you choose; nothing goes to a closed model API.',
  },
  {
    key: 'modal-spark-open',
    label: 'Muse Spark Open on Modal',
    provider: 'modal',
    baseUrl: PROVIDERS.modal.baseUrl,
    model: 'meta-models/Muse-Spark-Open-816B-A42B',
    secretRef: 'modal',
    pricing: SPARK_STANDARD,
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
    baseUrl: OPENROUTER_BASE_URL,
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

/** Words in a listed model id that mark it as something other than a chat model. */
const NOT_CHAT =
  /embed|tts|transcri|whisper|dall-e|image|realtime|audio|moderation|search-preview|sora|veo|imagen|lyria|aqa|robotics|speech|voice|rerank|guard|computer-use|deep-research|-live/i;

/** Whether a model from a provider's list can chat, judged by its id. Lists also hold image, speech and embedding models. */
export function looksLikeChatModel(id: string): boolean {
  return !NOT_CHAT.test(id);
}

/** Muse Glimmer reads its reasoning strength from a line in the system message. */
export function readsReasoningStrengthLine(model: string): boolean {
  return /glimmer/i.test(model);
}

/**
 * OpenAI models that take `reasoning_effort`: the o-series and GPT-5 onward, except the chat
 * snapshots. Older models reject the field.
 */
export function openAiTakesReasoningEffort(model: string): boolean {
  return /^(o\d|gpt-(?:[5-9]|\d{2,}))/i.test(model) && !/chat/i.test(model);
}

export function mentorPreset(key: MentorPresetKey): MentorPreset {
  const preset = MENTOR_PRESETS.find((p) => p.key === key);
  if (!preset) throw new Error(`Unknown mentor preset: ${key}`);
  return preset;
}

/** Nothing to pay: a model on this computer. */
export const FREE_PRICING: TokenPricing = { inputPerM: 0, cachedInputPerM: 0, outputPerM: 0 };

/** What a mentor costs: the price saved with it, else its preset's, else free when it runs here. */
export function mentorPricing(config: {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  pricing?: TokenPricing | undefined;
}): TokenPricing | undefined {
  if (config.pricing) return config.pricing;
  const preset = MENTOR_PRESETS.find(
    (candidate) => candidate.provider === config.provider && candidate.model === config.model,
  );
  if (preset) return preset.pricing;
  return isLoopbackUrl(config.baseUrl) ? FREE_PRICING : undefined;
}

/** What a student endpoint costs per call: free here, else its saved or preset price. */
export function studentPricing(endpoint: {
  baseUrl: string;
  model: string;
  pricing?: TokenPricing | undefined;
}): TokenPricing | undefined {
  if (isLoopbackUrl(endpoint.baseUrl)) return FREE_PRICING;
  if (endpoint.pricing) return endpoint.pricing;
  return (
    STUDENT_PRESETS.find(
      (preset) => preset.baseUrl === endpoint.baseUrl && preset.model === endpoint.model,
    )?.pricing ?? undefined
  );
}

/** The rates one call is billed at: the long-prompt rates once its input passes their threshold. */
export function ratesFor(pricing: TokenPricing, inputTokens: number): PriceRates {
  const long = pricing.longContext;
  return long !== undefined && inputTokens > long.aboveInputTokens ? long : pricing;
}

/** Dollars for one call's usage. Sum calls one by one: long-prompt rates apply per call. */
export function costUsd(
  pricing: TokenPricing,
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number },
): number {
  const rates = ratesFor(pricing, usage.inputTokens);
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  return (
    (fresh * rates.inputPerM +
      cached * rates.cachedInputPerM +
      usage.outputTokens * rates.outputPerM) /
    1_000_000
  );
}
