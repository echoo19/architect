import { looksLikeChatModel, PROVIDERS, type ModelEntry, type ProviderId } from '@architect/shared';
import { z } from 'zod';
import { ANTHROPIC_VERSION } from '../anthropic/messages';
import type { NetworkDeps } from '../deps';
import { createHttpClient } from '../http/client';
import { modelId } from '../openai/models';
import { fetchModels, OLLAMA_SERVICE } from '../student/ollama-api';
import { listAnthropicModels } from './anthropic';
import { checkOpenRouterKey, listOpenRouterModels } from './openrouter';

const count = z.number().int().positive();

const ListedWire = z.object({
  id: z.string(),
  display_name: z.string().nullish(),
  context_length: count.nullish(),
  context_window: count.nullish(),
});

/** `GET /models`: the standard `{ data: [...] }`, or a bare array as Together sends. */
const ListWire = z.union([z.object({ data: z.array(ListedWire) }), z.array(ListedWire)]);

export interface ListModelsOptions {
  provider: ProviderId;
  /** The connection's address; Ollama's is its native one, not `/v1`. */
  baseUrl: string;
  /** Sent only to the provider it belongs to; OpenRouter and local runtimes need none. */
  apiKey?: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** The closed network (decision 098): a list or key check outside it is refused, nothing sent. */
  network?: NetworkDeps;
}

function serviceOf(provider: ProviderId, baseUrl: string): string {
  return provider === 'other' ? new URL(baseUrl).host : PROVIDERS[provider].label;
}

function chatOnly(models: ModelEntry[]): ModelEntry[] {
  return models.filter((model) => looksLikeChatModel(model.id));
}

function toEntry(model: z.output<typeof ListedWire>): ModelEntry {
  const entry: ModelEntry = { id: modelId(model.id) };
  if (model.display_name) entry.label = model.display_name;
  const context = model.context_length ?? model.context_window;
  if (context) entry.contextLength = context;
  return entry;
}

/**
 * The chat models a connection offers, from its own list: Anthropic's and OpenRouter's newest
 * first (OpenRouter's with prices), Ollama's with their size on disk, and any OpenAI-compatible
 * list by id. Image, speech and embedding models are left out.
 */
export async function listModels(options: ListModelsOptions): Promise<ModelEntry[]> {
  const { provider, baseUrl, apiKey, signal } = options;
  const service = serviceOf(provider, baseUrl);
  const secrets = apiKey ? [apiKey] : [];
  switch (provider) {
    case 'anthropic': {
      const http = createHttpClient({
        baseUrl,
        service,
        headers: { 'x-api-key': apiKey ?? '', 'anthropic-version': ANTHROPIC_VERSION },
        secrets,
        fetch: options.fetch,
        network: options.network,
      });
      return chatOnly(await listAnthropicModels(http, signal));
    }
    case 'openrouter': {
      // The catalogue is public, so the key stays home.
      const http = createHttpClient({
        baseUrl,
        service,
        fetch: options.fetch,
        network: options.network,
      });
      return chatOnly(await listOpenRouterModels(http, signal));
    }
    case 'ollama': {
      const http = createHttpClient({
        baseUrl,
        service: OLLAMA_SERVICE,
        fetch: options.fetch,
        network: options.network,
      });
      const models = await fetchModels(http, signal);
      return chatOnly(models.map((model) => ({ id: model.name, sizeBytes: model.sizeBytes })));
    }
    default: {
      const http = createHttpClient({
        baseUrl,
        service,
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        secrets,
        fetch: options.fetch,
        network: options.network,
      });
      const list = await http.getJson('/models', ListWire, { signal });
      return chatOnly((Array.isArray(list) ? list : list.data).map(toEntry)).sort((a, b) =>
        a.id.localeCompare(b.id),
      );
    }
  }
}

/**
 * Checks a key with its provider before it is saved, and lists the chat models it opens up. Most
 * providers only list models for a good key; OpenRouter's list is public, so its key is asked
 * about on its own. A rejected key fails with an `auth` error.
 */
export async function verifyKey(
  options: ListModelsOptions & { apiKey: string },
): Promise<ModelEntry[]> {
  if (options.provider === 'openrouter') {
    const http = createHttpClient({
      baseUrl: options.baseUrl,
      service: PROVIDERS.openrouter.label,
      headers: { authorization: `Bearer ${options.apiKey}` },
      secrets: [options.apiKey],
      fetch: options.fetch,
      network: options.network,
    });
    await checkOpenRouterKey(http, options.signal);
  }
  return listModels(options);
}
