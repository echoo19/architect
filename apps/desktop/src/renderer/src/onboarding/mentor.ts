import { MENTOR_PRESETS, type MentorConfig, type MentorPreset } from '@architect/shared';

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

/** What choosing a mentor means for your data, in the words this app uses everywhere. */
const MENTOR_NOTES: Record<MentorPreset['key'], string> = {
  'meta-spark': "Meta doesn't train on what you send.",
  'meta-spark-contributor':
    'Meta may train on what you send, so use it only for data that is not sensitive or personal.',
  'baseten-spark-open': 'Served by Baseten, so what you send goes to Baseten, not to Meta.',
  'modal-spark-open': 'Runs on your own Modal endpoint, so what you send stays with Modal.',
};

export function mentorNote(preset: MentorPreset): string {
  return MENTOR_NOTES[preset.key];
}

/** Who a mentor's key comes from: "Meta", "Baseten", or the endpoint's host for any other. */
export function mentorProvider(mentor: Extract<MentorConfig, { kind: 'model' }>): string {
  if (mentor.provider !== 'other') return providerName(mentor.provider);
  try {
    return new URL(mentor.baseUrl).hostname;
  } catch {
    return mentor.label;
  }
}

/** Where a provider's keys are made, for people who don't have one yet. */
export const KEY_PAGES: Record<MentorPreset['provider'], { url: string; where: string }> = {
  meta: { url: 'https://dev.meta.ai', where: 'under API keys' },
  baseten: { url: 'https://www.baseten.co', where: 'in your account settings' },
  modal: { url: 'https://modal.com', where: 'in your workspace settings' },
};
