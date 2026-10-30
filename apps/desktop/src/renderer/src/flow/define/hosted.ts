import {
  PROVIDER_IDS,
  PROVIDERS,
  STUDENT_PRESETS,
  type StudentConfig,
  type StudentEndpoint,
  type StudentPreset,
} from '@architect/shared';
import { shortModelName } from '../../lib/names';

export function presetOf(endpoint: StudentEndpoint): StudentPreset | undefined {
  return STUDENT_PRESETS.find(
    (preset) => preset.baseUrl === endpoint.baseUrl && preset.model === endpoint.model,
  );
}

/**
 * "Together" for "Muse Glimmer on Together", the provider for another of its models, and the
 * host name for an endpoint the user added.
 */
export function providerName(endpoint: StudentEndpoint): string {
  const named = presetOf(endpoint)?.label.match(/\son\s(.+)$/)?.[1];
  if (named) return named;
  const provider = PROVIDER_IDS.find((id) => PROVIDERS[id].baseUrl === endpoint.baseUrl);
  if (provider) return PROVIDERS[provider].label;
  try {
    return new URL(endpoint.baseUrl).hostname;
  } catch {
    return endpoint.baseUrl;
  }
}

/** "a Meta key", "an OpenRouter key": the article follows the first sound of the name. */
export function aKey(provider: string): string {
  return `${/^[aeiou]/i.test(provider) ? 'an' : 'a'} ${provider} key`;
}

/** Which keys are saved, as far as the app knows yet. */
export type KeyStatus = Record<string, boolean> | 'loading' | 'error';

/** Why the hosted copy can't be used: no host chosen, keys not read yet or unreadable, no key. */
export type HostedWhy = 'no_host' | 'checking' | 'unreadable' | 'no_key';

export type HostedAvailability =
  { available: true } | { available: false; reason: string; why: HostedWhy };

/** The online copy needs an endpoint and, when it asks for one, a saved key. */
export function hostedAvailability(student: StudentConfig, keys: KeyStatus): HostedAvailability {
  const { hosted } = student;
  if (!hosted) {
    return {
      available: false,
      reason: `Pick an online service under ${shortModelName(student.label)} in Advanced settings`,
      why: 'no_host',
    };
  }
  if (!hosted.secretRef) return { available: true };
  if (keys === 'loading') {
    return { available: false, reason: 'Checking for a saved key', why: 'checking' };
  }
  if (keys === 'error') {
    return { available: false, reason: "Couldn't check for a saved key", why: 'unreadable' };
  }
  if (!keys[hosted.secretRef]) {
    return {
      available: false,
      reason: `Add ${aKey(providerName(hosted))} in Advanced settings`,
      why: 'no_key',
    };
  }
  return { available: true };
}
