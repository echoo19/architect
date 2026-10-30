import {
  AppSettingsSchema,
  CustomEndpointSchema,
  DEFAULT_STUDENT,
  MentorConfigSchema,
  mentorPreset,
  StudentEndpointSchema,
  type AppSettings,
  type CustomEndpoint,
} from '@architect/shared';
import { z } from 'zod';

export function defaultSettings(): AppSettings {
  const mentor = mentorPreset('meta-spark');
  return {
    edition: 'personal',
    steps: 'collapsed',
    comparisonMode: false,
    quietLocalModels: false,
    defaultMentor: {
      kind: 'model',
      provider: mentor.provider,
      label: mentor.label,
      baseUrl: mentor.baseUrl,
      model: mentor.model,
      reasoningEffort: 'medium',
      secretRef: mentor.secretRef,
    },
    defaultStudent: {
      runtime: DEFAULT_STUDENT.runtime,
      baseUrl: DEFAULT_STUDENT.baseUrl,
      model: DEFAULT_STUDENT.model,
      contextLength: DEFAULT_STUDENT.contextLength,
    },
    customEndpoints: [],
    onboarded: false,
  };
}

/** Added endpoints one by one, so a broken entry costs only itself. */
const StoredEndpointsSchema = z
  .array(z.unknown())
  .transform((entries) =>
    entries.flatMap((entry): CustomEndpoint[] => {
      const parsed = CustomEndpointSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }),
  )
  .catch(() => []);

/**
 * Reads a settings file leniently: a field that is missing or no longer valid falls back to its
 * default instead of discarding the rest of the user's choices. Files from before endpoints could
 * be added simply have none, a file from before the Lab is the personal edition, and a choice a later version no longer offers, such as the theme
 * (Architect is always dark), is read past and left out.
 */
const StoredSettingsSchema = z.object({
  edition: AppSettingsSchema.shape.edition.catch(() => defaultSettings().edition),
  steps: AppSettingsSchema.shape.steps.catch(() => defaultSettings().steps),
  comparisonMode: z.boolean().catch(() => defaultSettings().comparisonMode),
  quietLocalModels: z.boolean().catch(() => defaultSettings().quietLocalModels),
  defaultMentor: MentorConfigSchema.catch(() => defaultSettings().defaultMentor),
  defaultStudent: StudentEndpointSchema.catch(() => defaultSettings().defaultStudent),
  customEndpoints: StoredEndpointsSchema,
  onboarded: z.boolean().catch(() => defaultSettings().onboarded),
  llamaServerPath: z.string().min(1).optional().catch(undefined),
}) satisfies z.ZodType<AppSettings>;

export function settingsFromStored(raw: unknown): AppSettings {
  return StoredSettingsSchema.parse(typeof raw === 'object' && raw !== null ? raw : {});
}

/** The list with this endpoint added, or put in place of one at the same address. */
export function withEndpoint(
  list: readonly CustomEndpoint[],
  endpoint: CustomEndpoint,
): CustomEndpoint[] {
  return [...list.filter((entry) => entry.baseUrl !== endpoint.baseUrl), endpoint];
}

/** The list without the endpoint at this address. */
export function withoutEndpoint(
  list: readonly CustomEndpoint[],
  baseUrl: string,
): CustomEndpoint[] {
  return list.filter((entry) => entry.baseUrl !== baseUrl);
}
