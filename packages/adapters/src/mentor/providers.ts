import { MENTOR_PRESETS, type MentorConfig, type TokenPricing } from '@architect/shared';
import type { SystemRole } from '../openai/messages';

export type ModelMentorConfig = MentorConfig & { kind: 'model' };

/** How a provider wants its chat requests worded. */
export interface ProviderTraits {
  /** Who is answering, as a person would name it. */
  service: string;
  /** Meta ranks `developer` above `system`; the others only know `system`. */
  systemRole: SystemRole;
  /** The field that caps output. Reasoning tokens count against it. */
  tokenLimitField: 'max_completion_tokens' | 'max_tokens';
  /** `prompt_cache_key` is documented only for Meta. */
  sendsCacheKey: boolean;
  /** Modal keeps one conversation on one container when every request carries the same key. */
  sendsAffinityKey: boolean;
}

export function providerTraits(config: ModelMentorConfig): ProviderTraits {
  switch (config.provider) {
    case 'meta':
      return {
        service: 'Meta',
        systemRole: 'developer',
        tokenLimitField: 'max_completion_tokens',
        sendsCacheKey: true,
        sendsAffinityKey: false,
      };
    case 'baseten':
      return {
        service: 'Baseten',
        systemRole: 'system',
        tokenLimitField: 'max_tokens',
        sendsCacheKey: false,
        sendsAffinityKey: false,
      };
    case 'modal':
      return {
        service: 'Modal',
        systemRole: 'system',
        tokenLimitField: 'max_tokens',
        sendsCacheKey: false,
        sendsAffinityKey: true,
      };
    case 'other':
      return {
        service: new URL(config.baseUrl).host,
        systemRole: 'system',
        tokenLimitField: 'max_tokens',
        sendsCacheKey: false,
        sendsAffinityKey: false,
      };
  }
}

/** The preset's price when the config names the same provider and model; the tier is in the model id. */
export function presetPricing(config: ModelMentorConfig): TokenPricing | undefined {
  return MENTOR_PRESETS.find(
    (preset) => preset.provider === config.provider && preset.model === config.model,
  )?.pricing;
}

/** Structured output is a property of the provider. An unknown provider gets the safe fallback. */
export function supportsStructuredOutput(config: ModelMentorConfig): boolean {
  return (
    MENTOR_PRESETS.find((preset) => preset.provider === config.provider)?.structuredOutput ?? false
  );
}
