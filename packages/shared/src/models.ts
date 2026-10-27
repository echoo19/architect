/**
 * Model ids and endpoints used as defaults. This file mirrors docs/MODELS.md and is the only
 * place in the code that names a specific model.
 */

export interface TokenPricing {
  /** US dollars per million input tokens. */
  inputPerM: number;
  /** US dollars per million cached input tokens, when the provider discounts them. */
  cachedInputPerM?: number;
  /** US dollars per million output tokens (reasoning tokens bill as output). */
  outputPerM: number;
}

export interface MentorPreset {
  key: 'meta-spark' | 'meta-spark-contributor' | 'baseten-spark-open' | 'modal-spark-open';
  label: string;
  provider: 'meta' | 'baseten' | 'modal';
  baseUrl: string;
  model: string;
  /** null when the price isn't published for this endpoint; spend then shows tokens only. */
  pricing: TokenPricing | null;
  /** Shown next to the choice in Settings. */
  note: string;
}

export const META_API_BASE_URL = 'https://api.meta.ai/v1';
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export const DEFAULT_STUDENT = {
  runtime: 'ollama' as const,
  model: 'muse-glimmer:30b',
  label: 'Glimmer',
  family: 'Muse Glimmer',
  sizeGb: 18,
};

export const DEFAULT_MENTOR_KEY: MentorPreset['key'] = 'meta-spark';
