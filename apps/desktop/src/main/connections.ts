import {
  assertInsideNetwork,
  createMentor,
  createStudent,
  listModels,
  loadedOllamaModels,
  type NetworkDeps,
  type verifyKey,
} from '@architect/adapters';
import {
  AdapterError,
  customSecretRef,
  keyDestinationProblem,
  LMSTUDIO_BASE_URL,
  PROVIDERS,
  secretLabel,
  isSecretRef,
  type AddConnectionRequest,
  type AddConnectionResult,
  type AdapterErrorCode,
  type ConnectionTest,
  type CustomEndpoint,
  type GpuInfo,
  type LocalRuntime,
  type LocalRuntimes,
  type MentorConfig,
  type ModelEntry,
  type ModelSource,
  type ProviderId,
  type StudentEndpoint,
} from '@architect/shared';
import { ollamaStatus } from './ollama/status';

/** Reads a saved key by its ref. */
export type KeyLookup = (ref: string) => Promise<string | undefined>;

/** Why a key may not go to a URL, or null when it may. Tests against local servers swap it. */
export type KeyDestinationCheck = (ref: string, url: string) => string | null;

const ADD_KEY_HINT = 'Add the key in Settings, then test again.';

/**
 * The closed network's refusal of a request to `url` (decision 098), or null when it may go. A
 * check from Settings is held to the network as teaching is, and refused before any key is read.
 */
function outsideOf(
  network: NetworkDeps | undefined,
  service: string,
  url: string,
): AdapterError | null {
  try {
    assertInsideNetwork(network, service, url);
    return null;
  } catch (error) {
    if (error instanceof AdapterError) return error;
    throw error;
  }
}

/** A local runtime answers at once; anything slower counts as not running. */
const LOCAL_TIMEOUT_MS = 3_000;

/** Ways of not getting an answer at all, as opposed to getting a wrong one. */
const NO_ANSWER: ReadonlySet<AdapterErrorCode> = new Set(['network', 'timeout', 'aborted']);

/**
 * Checks that the mentor answers, with its saved key when it uses one. Nothing is sent before
 * the key is found and allowed to go where the config points.
 */
export async function testMentor(
  config: MentorConfig,
  keys: KeyLookup,
  checkDestination: KeyDestinationCheck = keyDestinationProblem,
  network?: NetworkDeps,
): Promise<ConnectionTest> {
  if (config.kind !== 'model') {
    return {
      ok: false,
      error: `${config.label} can't be used as a mentor yet.`,
      hint: 'Choose a model API instead.',
    };
  }
  const outside = outsideOf(network, config.label, config.baseUrl);
  if (outside !== null) return { ok: false, error: outside.message };
  if (config.secretRef === undefined) return createMentor(config, { network }).testConnection();
  const problem = checkDestination(config.secretRef, config.baseUrl);
  if (problem !== null) return { ok: false, error: problem };
  const apiKey = await keys(config.secretRef);
  if (!apiKey) {
    return { ok: false, error: `No key is saved for ${config.label}.`, hint: ADD_KEY_HINT };
  }
  return createMentor(config, { apiKey, network }).testConnection();
}

/** Checks that the student's server answers and has the model. */
export async function testStudent(
  endpoint: StudentEndpoint,
  keys: KeyLookup,
  checkDestination: KeyDestinationCheck = keyDestinationProblem,
  network?: NetworkDeps,
): Promise<ConnectionTest> {
  const outside = outsideOf(network, new URL(endpoint.baseUrl).host, endpoint.baseUrl);
  if (outside !== null) return { ok: false, error: outside.message };
  let apiKey: string | undefined;
  if (endpoint.secretRef !== undefined) {
    const problem = checkDestination(endpoint.secretRef, endpoint.baseUrl);
    if (problem !== null) return { ok: false, error: problem };
    apiKey = await keys(endpoint.secretRef);
    if (!apiKey) {
      const host = new URL(endpoint.baseUrl).host;
      return { ok: false, error: `No key is saved for ${host}.`, hint: ADD_KEY_HINT };
    }
  }
  return createStudent(endpoint, { apiKey, network }).testConnection();
}

/**
 * The models a connection offers, from its own list. The key goes along only where the
 * provider needs one to list, and only to that key's own hosts.
 */
export async function listConnectionModels(
  source: ModelSource,
  keys: KeyLookup,
  checkDestination: KeyDestinationCheck = keyDestinationProblem,
  network?: NetworkDeps,
): Promise<ModelEntry[]> {
  const outside = outsideOf(network, new URL(source.baseUrl).host, source.baseUrl);
  if (outside !== null) throw outside;
  const needsKey = source.secretRef !== undefined && source.provider !== 'openrouter';
  let apiKey: string | undefined;
  if (needsKey && source.secretRef !== undefined) {
    const problem = checkDestination(source.secretRef, source.baseUrl);
    if (problem !== null) throw new Error(problem);
    apiKey = await keys(source.secretRef);
    if (!apiKey) {
      const who = isSecretRef(source.secretRef) ? secretLabel(source.secretRef) : source.baseUrl;
      throw new Error(`No key is saved for ${who}. Add it in Settings.`);
    }
  }
  return listModels({
    provider: source.provider,
    baseUrl: source.baseUrl,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(network === undefined ? {} : { network }),
  });
}

async function localRuntime(
  baseUrl: string,
  read: (signal: AbortSignal) => Promise<{ version?: string; models: ModelEntry[] }>,
): Promise<LocalRuntime> {
  try {
    const { version, models } = await read(AbortSignal.timeout(LOCAL_TIMEOUT_MS));
    return { running: true, baseUrl, models, ...(version === undefined ? {} : { version }) };
  } catch (error) {
    if (error instanceof AdapterError && NO_ANSWER.has(error.code)) {
      return { running: false, baseUrl, models: [] };
    }
    throw error;
  }
}

/** Ollama's models, each with how it sits in memory when it is loaded right now. */
async function ollamaRuntime(baseUrl: string): Promise<LocalRuntime> {
  const status = await ollamaStatus(baseUrl);
  if (!status.running) return { running: false, baseUrl, models: [] };
  const loaded = await loadedOllamaModels(baseUrl, AbortSignal.timeout(LOCAL_TIMEOUT_MS));
  return {
    running: true,
    baseUrl,
    ...(status.version === undefined ? {} : { version: status.version }),
    models: status.models.map((model): ModelEntry => {
      const inMemory = loaded.find((entry) => entry.name === model.name);
      return {
        id: model.name,
        sizeBytes: model.sizeBytes,
        ...(inMemory
          ? { inMemory: { totalBytes: inMemory.totalBytes, gpuBytes: inMemory.gpuBytes } }
          : {}),
      };
    }),
  };
}

export interface LocalRuntimeOptions {
  ollamaBaseUrl: string;
  lmStudioBaseUrl?: string;
  /** The GPU, found once per run of the app: it doesn't change while the app is open. */
  gpu: () => Promise<GpuInfo | null>;
}

/**
 * Ollama and LM Studio on this computer, whether each answers and the models it has, and the GPU
 * they can use. Asking loads no model.
 */
export async function detectLocalRuntimes(options: LocalRuntimeOptions): Promise<LocalRuntimes> {
  const lmStudioBaseUrl = options.lmStudioBaseUrl ?? LMSTUDIO_BASE_URL;
  const [ollama, lmstudio, gpu] = await Promise.all([
    ollamaRuntime(options.ollamaBaseUrl),
    localRuntime(lmStudioBaseUrl, async (signal) => ({
      models: await listModels({ provider: 'lmstudio', baseUrl: lmStudioBaseUrl, signal }),
    })),
    options.gpu(),
  ]);
  return { ollama, lmstudio, gpu };
}

/** What adding a connection needs from the app: a model check, and places to keep what it saves. */
export interface ConnectionDeps {
  verifyKey: typeof verifyKey;
  listModels: typeof listModels;
  saveKey(ref: string, value: string): Promise<void>;
  clearKey(ref: string): Promise<void>;
  addEndpoint(endpoint: CustomEndpoint): Promise<void>;
  removeEndpoint(baseUrl: string): Promise<void>;
}

/** An address the user typed, tidied: no trailing slash, and only HTTP or HTTPS. */
export function endpointAddress(raw: string | undefined): string {
  const text = raw?.trim() ?? '';
  if (!URL.canParse(text))
    throw new Error('Enter the full address, such as https://api.example.com/v1.');
  const url = new URL(text);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The address has to start with https:// or http://.');
  }
  if (url.username || url.password)
    throw new Error('Put the key in its own field, not in the address.');
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}

/** Turns a refused check into words, and lets a host without a model list through. */
function keyProblem(error: unknown, who: string): Error | null {
  if (!(error instanceof AdapterError))
    return error instanceof Error ? error : new Error(String(error));
  if (error.code === 'auth')
    return new Error(`${who} didn't accept that key. Check it and try again.`);
  if (error.code === 'not_found' || error.code === 'bad_response') return null;
  return new Error(error.message);
}

/**
 * Adds a connection. A key is checked with its provider first and saved only if it works; an
 * endpoint the user typed is tried as given and with `/v1` after it, and remembered at the
 * address that answered. The key is bound to that exact host and port.
 */
export async function addConnection(
  request: AddConnectionRequest,
  deps: ConnectionDeps,
): Promise<AddConnectionResult> {
  const { provider } = request;
  const info = PROVIDERS[provider];
  const key = request.key?.trim() ?? '';
  if (info.local) throw new Error(`${info.label} runs on this computer and needs no key.`);

  if (provider !== 'other') {
    if (!info.secretRef) throw new Error(`${info.label} has no key to save.`);
    if (key === '') throw new Error(`Paste your ${info.label} key.`);
    let models: ModelEntry[] | null = null;
    try {
      models = await deps.verifyKey({ provider, baseUrl: info.baseUrl, apiKey: key });
    } catch (error) {
      const problem = keyProblem(error, info.label);
      if (problem) throw problem;
    }
    await deps.saveKey(info.secretRef, key);
    return { secretRef: info.secretRef, ...(models === null ? {} : { models: models.length }) };
  }

  const typed = endpointAddress(request.baseUrl);
  // Checked before anything is sent: a key never travels in plain text off this computer.
  const destination = key ? keyDestinationProblem(customSecretRef(typed), typed) : null;
  if (destination !== null) {
    throw new Error(
      `Architect sends a key only over HTTPS, or over plain HTTP to this computer. Use an https:// address for ${new URL(typed).host}.`,
    );
  }
  const candidates = /\/v\d+$/.test(new URL(typed).pathname) ? [typed] : [typed, `${typed}/v1`];
  let found: { baseUrl: string; models: ModelEntry[] } | null = null;
  let lastError: unknown = null;
  for (const baseUrl of candidates) {
    try {
      const options = { provider, baseUrl, ...(key ? { apiKey: key } : {}) };
      const models = key
        ? await deps.verifyKey({ ...options, apiKey: key })
        : await deps.listModels(options);
      found = { baseUrl, models };
      break;
    } catch (error) {
      lastError = error;
      if (error instanceof AdapterError && error.code === 'auth') break;
    }
  }
  const host = new URL(typed).host;
  if (!found) {
    const problem = keyProblem(lastError, host);
    throw problem ?? new Error(`${host} has no model list at that address. Check the address.`);
  }
  const ref = customSecretRef(found.baseUrl);
  if (key) await deps.saveKey(ref, key);
  await deps.addEndpoint({ baseUrl: found.baseUrl, label: host });
  return { ...(key ? { secretRef: ref } : {}), models: found.models.length };
}

/** Forgets a connection: its key, and for an endpoint the user added, its address too. */
export async function removeConnection(
  source: { provider: ProviderId; baseUrl: string },
  deps: Pick<ConnectionDeps, 'clearKey' | 'removeEndpoint'>,
): Promise<void> {
  if (source.provider === 'other') {
    await deps.clearKey(customSecretRef(source.baseUrl));
    await deps.removeEndpoint(source.baseUrl);
    return;
  }
  const { secretRef, label } = PROVIDERS[source.provider];
  if (!secretRef) throw new Error(`${label} has no key to remove.`);
  await deps.clearKey(secretRef);
}
