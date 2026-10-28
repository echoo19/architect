import {
  customSecretRef,
  GLIMMER_BUILDS,
  isLoopbackUrl,
  MENTOR_PRESETS,
  PROVIDER_IDS,
  PROVIDERS,
  STUDENT_PRESETS,
  type CustomEndpoint,
  type LocalRuntimes,
  type MentorConfig,
  type MentorPreset,
  type ModelEntry,
  type ProviderId,
  type ReasoningEffort,
  type StudentEndpoint,
} from '@architect/shared';

/** Somewhere models come from: a provider with a saved key, an added endpoint, or a runtime here. */
export interface Connection {
  /** The provider's id, `other:<address>` for an added endpoint. */
  id: string;
  provider: ProviderId;
  label: string;
  baseUrl: string;
  /** Where its key is saved, when it has one. */
  secretRef?: string;
  /** On this computer: no key, no bill. */
  local: boolean;
  /** For a runtime here: whether it answers, its version, and the models it has. */
  runtime?: { running: boolean; version?: string; models: ModelEntry[] };
  /** A provider offered by its presets before its key is saved: choosing one asks for the key. */
  offered?: boolean;
}

/** Hosted providers people connect with a key, in the order the app lists them. */
export const KEY_PROVIDERS: readonly ProviderId[] = PROVIDER_IDS.filter(
  (id) => !PROVIDERS[id].local && id !== 'other',
);

/**
 * Every connection: hosted providers whose key is saved, the endpoints the user added, and the
 * runtimes on this computer, in that order.
 */
export function connectionsFrom(
  secrets: Record<string, boolean> | undefined,
  endpoints: readonly CustomEndpoint[],
  local: LocalRuntimes | undefined,
): Connection[] {
  const hosted = KEY_PROVIDERS.flatMap((id): Connection[] => {
    const { secretRef, label, baseUrl } = PROVIDERS[id];
    return secretRef && secrets?.[secretRef] === true
      ? [{ id, provider: id, label, baseUrl, secretRef, local: false }]
      : [];
  });
  const added = endpoints.map((endpoint): Connection => {
    const ref = customSecretRef(endpoint.baseUrl);
    return {
      id: `other:${endpoint.baseUrl}`,
      provider: 'other',
      label: endpoint.label,
      baseUrl: endpoint.baseUrl,
      ...(secrets?.[ref] === true ? { secretRef: ref } : {}),
      local: isLoopbackUrl(endpoint.baseUrl),
    };
  });
  const runtimes: Connection[] = local
    ? (['ollama', 'lmstudio'] as const).map((id) => {
        const found = local[id];
        return {
          id,
          provider: id,
          label: PROVIDERS[id].label,
          baseUrl: found.baseUrl,
          local: true,
          runtime: {
            running: found.running,
            models: found.models,
            ...(found.version === undefined ? {} : { version: found.version }),
          },
        };
      })
    : [];
  return [...hosted, ...added, ...runtimes];
}

/** What each picker offers. */
export type PickerRole = 'mentor' | 'student' | 'hosted';

/** Providers whose models can be a hosted copy of an open model the agent runs here. */
const HOSTED_COPY_PROVIDERS: ReadonlySet<ProviderId> = new Set([
  'openrouter',
  'together',
  'deepinfra',
  'groq',
  'fireworks',
  'other',
]);

/** The hosted providers the app has presets for in a role, in the order the presets list them. */
function presetProviders(role: 'mentor' | 'hosted'): ProviderId[] {
  const ids =
    role === 'mentor'
      ? MENTOR_PRESETS.map((preset) => preset.provider)
      : STUDENT_PRESETS.filter((preset) => preset.runtime === 'openai_compatible').flatMap(
          (preset) => PROVIDER_IDS.filter((id) => PROVIDERS[id].baseUrl === preset.baseUrl),
        );
  return [...new Set(ids)];
}

/** Those providers whose key isn't saved yet, offered by their presets. */
function notConnected(role: 'mentor' | 'hosted', connections: readonly Connection[]) {
  return presetProviders(role)
    .filter((id) => !connections.some((connection) => connection.provider === id))
    .map((id): Connection => {
      const { label, baseUrl, secretRef } = PROVIDERS[id];
      return {
        id,
        provider: id,
        label,
        baseUrl,
        ...(secretRef ? { secretRef } : {}),
        local: false,
        offered: true,
      };
    });
}

/**
 * The connections a picker lists for its role. The mentor and hosted pickers also offer the
 * presets of providers that aren't connected yet, after the connected ones.
 */
export function connectionsFor(role: PickerRole, connections: readonly Connection[]): Connection[] {
  switch (role) {
    case 'mentor':
      return [
        ...connections.filter((connection) => !connection.runtime || connection.runtime.running),
        ...notConnected(role, connections),
      ];
    case 'student':
      return connections.filter((connection) => connection.local);
    case 'hosted':
      return [
        ...connections.filter(
          (connection) => !connection.local && HOSTED_COPY_PROVIDERS.has(connection.provider),
        ),
        ...notConnected(role, connections),
      ];
  }
}

/** OpenRouter names models "Maker: Model"; the app shows the model. */
export function modelLabel(id: string, entry?: ModelEntry): string {
  const label = entry?.label?.replace(/^[^:]{1,40}:\s+/, '').trim();
  return label || id;
}

/** One choice in a picker: a model on a connection. */
export interface ModelChoice {
  connection: Connection;
  id: string;
  /** What the connection's list says about it, when it was in the list. */
  entry?: ModelEntry;
}

export function presetFor(connection: Connection, id: string): MentorPreset | undefined {
  return MENTOR_PRESETS.find(
    (preset) => preset.provider === connection.provider && preset.model === id,
  );
}

/**
 * The mentor settings for a choice. OpenRouter's listed price is saved with it, so the spending
 * cap is kept at that price; any other model without a preset has no price until one is entered.
 */
export function mentorFromChoice(
  choice: ModelChoice,
  reasoningEffort: ReasoningEffort,
): Extract<MentorConfig, { kind: 'model' }> {
  const { connection, id, entry } = choice;
  const preset = presetFor(connection, id);
  const pricing = connection.provider === 'openrouter' ? entry?.pricing : undefined;
  return {
    kind: 'model',
    provider: connection.provider,
    label: preset?.label ?? modelLabel(id, entry),
    baseUrl: connection.baseUrl,
    model: id,
    reasoningEffort,
    ...(connection.secretRef ? { secretRef: connection.secretRef } : {}),
    ...(pricing ? { pricing } : {}),
  };
}

/** The local student endpoint for a choice on a runtime here. */
export function studentFromChoice(choice: ModelChoice, contextLength: number): StudentEndpoint {
  const { connection, id } = choice;
  return {
    runtime: connection.provider === 'ollama' ? 'ollama' : 'openai_compatible',
    baseUrl: connection.baseUrl,
    model: id,
    contextLength,
  };
}

/** A hosted copy for faster training, with OpenRouter's listed price saved for the estimates. */
export function hostedFromChoice(choice: ModelChoice, contextLength: number): StudentEndpoint {
  const { connection, id, entry } = choice;
  const pricing = connection.provider === 'openrouter' ? entry?.pricing : undefined;
  return {
    runtime: 'openai_compatible',
    baseUrl: connection.baseUrl,
    model: id,
    ...(connection.secretRef ? { secretRef: connection.secretRef } : {}),
    contextLength,
    ...(pricing ? { pricing } : {}),
  };
}

/** The connection a saved mentor or endpoint points at, if it is still connected. */
export function connectionOf(
  connections: readonly Connection[],
  target: { provider?: ProviderId; baseUrl: string },
): Connection | undefined {
  return connections.find(
    (connection) =>
      connection.baseUrl === target.baseUrl &&
      (target.provider === undefined || connection.provider === target.provider),
  );
}

/** How the app names a local model: Glimmer's builds by their build, anything else by its id. */
export function localModelName(model: string): string {
  const build = GLIMMER_BUILDS.find((candidate) => candidate.model === model);
  if (build) return `Muse Glimmer · ${build.label.split(',')[0]}`;
  const preset = STUDENT_PRESETS.find((candidate) => candidate.model === model);
  return preset ? preset.label.replace(/\s+on\s+.*$/i, '') : model;
}
