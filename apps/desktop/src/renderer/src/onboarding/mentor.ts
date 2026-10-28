import {
  isLoopbackUrl,
  MENTOR_PRESETS,
  PROVIDERS,
  type MentorConfig,
  type MentorPreset,
  type ProviderId,
} from '@architect/shared';

/** A mentor that is a model, which is every mentor this version can run. */
export type ModelMentor = Extract<MentorConfig, { kind: 'model' }>;

/** The four ways to a mentor that first-run setup offers. */
export type MentorRoute = 'meta' | 'openrouter' | 'key' | 'local';

/** Which way a saved mentor came in: a server on this computer counts as local. */
export function routeOf(mentor: MentorConfig): MentorRoute {
  if (mentor.kind !== 'model' || mentor.provider === 'meta') return 'meta';
  if (mentor.provider === 'openrouter') return 'openrouter';
  if (PROVIDERS[mentor.provider].local || isLoopbackUrl(mentor.baseUrl)) return 'local';
  return 'key';
}

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
    secretRef: preset.secretRef,
  };
}

export function providerName(provider: ProviderId): string {
  return PROVIDERS[provider].label;
}

/** What choosing a mentor means for your data, in the words this app uses everywhere. */
const MENTOR_NOTES: Partial<Record<MentorPreset['key'], string>> = {
  'meta-spark': "Meta doesn't train on what you send.",
  'baseten-spark-open':
    'Baseten runs it for you, so what you send goes to Baseten and never to Meta.',
  'modal-spark-open':
    'You create the endpoint in your own Modal account first; what you send stays with Modal.',
};

/** The preset's own note unless this app says it more plainly; most presets need none. */
export function mentorNote(preset: MentorPreset): string | undefined {
  return MENTOR_NOTES[preset.key] ?? preset.note;
}

/** Who a mentor's key comes from: "Meta", "OpenAI", or the endpoint's host for any other. */
export function mentorProvider(mentor: ModelMentor): string {
  if (mentor.provider !== 'other') return providerName(mentor.provider);
  try {
    return new URL(mentor.baseUrl).hostname;
  } catch {
    return mentor.label;
  }
}
