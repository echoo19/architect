import {
  MENTOR_PRESETS,
  type MentorConfig,
  type MentorPreset,
  type TokenPricing,
} from '@architect/shared';

/** The preset a saved mentor was made from, if it was. */
export function presetFor(mentor: MentorConfig): MentorPreset | undefined {
  if (mentor.kind !== 'model') return undefined;
  return MENTOR_PRESETS.find(
    (preset) => preset.model === mentor.model && preset.baseUrl === mentor.baseUrl,
  );
}

/** Mentor settings for a preset. The key is stored under the provider's name. */
export function mentorFromPreset(preset: MentorPreset, current: MentorConfig): MentorConfig {
  return {
    kind: 'model',
    provider: preset.provider,
    label: preset.label,
    baseUrl: preset.baseUrl,
    model: preset.model,
    reasoningEffort: current.kind === 'model' ? current.reasoningEffort : 'medium',
    secretRef: preset.provider,
  };
}

const PROVIDER_NAMES: Record<MentorPreset['provider'], string> = {
  meta: 'Meta',
  baseten: 'Baseten',
  modal: 'Modal',
};

export function providerName(provider: MentorPreset['provider']): string {
  return PROVIDER_NAMES[provider];
}

/** "$1.25 in · $4.25 out per million tokens" */
export function formatPricing(pricing: TokenPricing): string {
  const usd = (amount: number) => `$${amount.toFixed(2)}`;
  return `${usd(pricing.inputPerM)} in · ${usd(pricing.outputPerM)} out per million tokens`;
}
