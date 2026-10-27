import {
  mentorPreset,
  STUDENT_PRESETS,
  type MentorPresetKey,
  type StudentEndpoint,
} from '@architect/shared';
import type { ModelMentorConfig } from '../../src/mentor/providers';

/** A mentor config for one of the shared presets, so tests never spell out a model id. */
export function mentorConfig(
  key: MentorPresetKey,
  overrides: Partial<ModelMentorConfig> = {},
): ModelMentorConfig {
  const preset = mentorPreset(key);
  return {
    kind: 'model',
    provider: preset.provider,
    label: preset.label,
    baseUrl: preset.baseUrl,
    model: preset.model,
    reasoningEffort: 'medium',
    secretRef: 'test-key',
    ...overrides,
  };
}

export function studentEndpoint(
  key: (typeof STUDENT_PRESETS)[number]['key'],
  overrides: Partial<StudentEndpoint> = {},
): StudentEndpoint {
  const preset = STUDENT_PRESETS.find((candidate) => candidate.key === key);
  if (!preset) throw new Error(`Unknown student preset: ${key}`);
  return {
    runtime: preset.runtime,
    baseUrl: preset.baseUrl,
    model: preset.model,
    contextLength: 16_384,
    ...overrides,
  };
}
