import {
  STUDENT_PRESETS,
  type StudentConfig,
  type StudentEndpoint,
  type StudentPreset,
} from '@architect/shared';

/** Presets that run the student on someone else's servers during training. */
export const HOSTED_PRESETS: readonly StudentPreset[] = STUDENT_PRESETS.filter(
  (preset) => preset.runtime === 'openai_compatible',
);

export function presetOf(endpoint: StudentEndpoint): StudentPreset | undefined {
  return STUDENT_PRESETS.find(
    (preset) => preset.baseUrl === endpoint.baseUrl && preset.model === endpoint.model,
  );
}

/** "Together" for "Muse Glimmer on Together"; the host name for an endpoint with no preset. */
export function providerName(endpoint: StudentEndpoint): string {
  const named = presetOf(endpoint)?.label.match(/\son\s(.+)$/)?.[1];
  if (named) return named;
  try {
    return new URL(endpoint.baseUrl).hostname;
  } catch {
    return endpoint.baseUrl;
  }
}

/** The secret store's name for a provider's key: `together` for the Together preset. */
function presetSecretRef(preset: StudentPreset): string {
  return preset.key.split('-')[0] ?? preset.key;
}

export function hostedEndpoint(preset: StudentPreset, contextLength: number): StudentEndpoint {
  return {
    runtime: preset.runtime,
    baseUrl: preset.baseUrl,
    model: preset.model,
    secretRef: presetSecretRef(preset),
    contextLength,
  };
}

/** Which keys are saved, as far as the app knows yet. */
export type KeyStatus = Record<string, boolean> | 'loading' | 'error';

export type HostedAvailability = { available: true } | { available: false; reason: string };

/** Training on a hosted copy needs an endpoint and, when it asks for one, a saved key. */
export function hostedAvailability(student: StudentConfig, keys: KeyStatus): HostedAvailability {
  const { hosted } = student;
  if (!hosted) return { available: false, reason: 'Choose a host in Advanced settings' };
  if (!hosted.secretRef) return { available: true };
  if (keys === 'loading') return { available: false, reason: 'Checking for a saved key' };
  if (keys === 'error') return { available: false, reason: "Couldn't check for a saved key" };
  if (!keys[hosted.secretRef]) {
    return { available: false, reason: `Add a ${providerName(hosted)} key in Advanced settings` };
  }
  return { available: true };
}
