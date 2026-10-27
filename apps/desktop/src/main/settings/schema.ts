import {
  AppSettingsSchema,
  DEFAULT_STUDENT,
  MentorConfigSchema,
  mentorPreset,
  StudentEndpointSchema,
  ThemeSchema,
  type AppSettings,
} from '@architect/shared';
import { z } from 'zod';

export function defaultSettings(): AppSettings {
  const mentor = mentorPreset('meta-spark');
  return {
    theme: 'system',
    steps: 'collapsed',
    comparisonMode: false,
    defaultMentor: {
      kind: 'model',
      provider: mentor.provider,
      label: mentor.label,
      baseUrl: mentor.baseUrl,
      model: mentor.model,
      reasoningEffort: 'medium',
      secretRef: 'meta',
    },
    defaultStudent: {
      runtime: DEFAULT_STUDENT.runtime,
      baseUrl: DEFAULT_STUDENT.baseUrl,
      model: DEFAULT_STUDENT.model,
      contextLength: DEFAULT_STUDENT.contextLength,
    },
    onboarded: false,
  };
}

/**
 * Reads a settings file leniently: a field that is missing or no longer valid falls back to its
 * default instead of discarding the rest of the user's choices.
 */
const StoredSettingsSchema = z.object({
  theme: ThemeSchema.catch(() => defaultSettings().theme),
  steps: AppSettingsSchema.shape.steps.catch(() => defaultSettings().steps),
  comparisonMode: z.boolean().catch(() => defaultSettings().comparisonMode),
  defaultMentor: MentorConfigSchema.catch(() => defaultSettings().defaultMentor),
  defaultStudent: StudentEndpointSchema.catch(() => defaultSettings().defaultStudent),
  onboarded: z.boolean().catch(() => defaultSettings().onboarded),
}) satisfies z.ZodType<AppSettings>;

export function settingsFromStored(raw: unknown): AppSettings {
  return StoredSettingsSchema.parse(typeof raw === 'object' && raw !== null ? raw : {});
}
