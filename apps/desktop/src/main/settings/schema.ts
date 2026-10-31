import {
  AppSettingsSchema,
  readClosedNetwork,
  CustomEndpointSchema,
  DEFAULT_STUDENT,
  FieldExportRecordSchema,
  MentorConfigSchema,
  mentorPreset,
  StudentEndpointSchema,
  type AppSettings,
  type CustomEndpoint,
  type FieldExportRecord,
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

/** Recorded exports one by one, likewise; a file from before they were kept has none. */
const StoredExportsSchema = z
  .array(z.unknown())
  .transform((entries) =>
    entries.flatMap((entry): FieldExportRecord[] => {
      const parsed = FieldExportRecordSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    }),
  )
  .optional()
  .catch(undefined);

/** The most exports kept: one per field, the oldest dropped first. */
export const MAX_FIELD_EXPORTS = 200;

/** The list with this export as its field's latest, newest first. */
export function withFieldExport(
  list: readonly FieldExportRecord[],
  record: FieldExportRecord,
): FieldExportRecord[] {
  return [record, ...list.filter((entry) => entry.jobId !== record.jobId)].slice(
    0,
    MAX_FIELD_EXPORTS,
  );
}

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
  fieldExports: StoredExportsSchema,
}) satisfies z.ZodType<Omit<AppSettings, 'closedNetwork' | 'closedNetworkProblem'>>;

/**
 * A settings file's settings. The closed network fails closed (decision 098): a damaged one stays on
 * with the hosts that read, and says what was wrong, instead of falling back to off.
 */
export function settingsFromStored(raw: unknown): AppSettings {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { network, problem } = readClosedNetwork(record['closedNetwork']);
  return {
    ...StoredSettingsSchema.parse(record),
    ...(network === undefined ? {} : { closedNetwork: network }),
    ...(problem === undefined ? {} : { closedNetworkProblem: problem }),
  };
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
