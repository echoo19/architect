import {
  AdapterError,
  type ConnectionTest,
  type StudentAdapter,
  type StudentChatRequest,
  type StudentEndpoint,
  type StudentModelInfo,
  type StudentStreamEvent,
} from '@architect/shared';
import type { StudentDeps } from '../deps';
import { createHttpClient } from '../http/client';
import { badResponse, connectionFailure, cutOff, HttpError } from '../http/errors';
import { describeErrorPayload, failureForStreamError } from '../http/failures';
import { readNdjson } from '../http/ndjson';
import { isLoopbackUrl } from '../loopback';
import { toWireTools } from '../openai/messages';
import { callId, countToolCalls, parseToolArguments } from '../tool-calls';
import { makeUsage } from '../usage';
import { fetchModels, fetchVersion, OLLAMA_SERVICE } from './ollama-api';
import {
  AnyObjectWire,
  OllamaChunkWire,
  ShowWire,
  sameModel,
  toOllamaMessages,
} from './ollama-wire';

/** Muse Glimmer's renderer and parser first shipped in this release. */
const MIN_VERSION = '0.32.7';
const UNLOAD_TIMEOUT_MS = 60_000;

/**
 * A student served by Ollama, over its native `/api/chat`. The native API takes the context
 * size per request, has reasoning levels, and reports reasoning separately from the answer.
 */
export function createOllamaStudent(
  endpoint: StudentEndpoint,
  deps: StudentDeps = {},
): StudentAdapter {
  const http = createHttpClient({
    baseUrl: endpoint.baseUrl,
    service: OLLAMA_SERVICE,
    modelNotFoundHint: `Pull ${endpoint.model} first.`,
    fetch: deps.fetch,
    retry: deps.retry,
    timeouts: deps.timeouts,
  });

  const show = (signal?: AbortSignal): Promise<ShowWire> =>
    http.postJson('/api/show', { model: endpoint.model }, ShowWire, {
      signal,
      model: endpoint.model,
    });

  let thinking: boolean | undefined;
  /** Models without the `thinking` capability reject a `think` field, so only send it where it works. */
  async function canThink(signal?: AbortSignal): Promise<boolean> {
    if (thinking !== undefined) return thinking;
    try {
      const { capabilities } = await show(signal);
      thinking = !capabilities?.length || capabilities.includes('thinking');
      return thinking;
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'aborted') throw error;
      // The chat request will report a missing model or a stopped server far better than this lookup.
      return true;
    }
  }

  function chatBody(request: StudentChatRequest, think: boolean): Record<string, unknown> {
    const { decoding } = request;
    return {
      model: endpoint.model,
      messages: toOllamaMessages(request.messages),
      ...(request.tools.length > 0 ? { tools: toWireTools(request.tools) } : {}),
      ...(think ? { think: decoding.thinking } : {}),
      stream: true,
      options: {
        num_ctx: endpoint.contextLength,
        num_predict: decoding.maxOutputTokens,
        temperature: decoding.temperature,
        top_p: decoding.topP,
        top_k: decoding.topK,
        seed: request.seed,
      },
    };
  }

  async function* chat(
    request: StudentChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StudentStreamEvent> {
    const body = chatBody(request, await canThink(signal));
    const stream = await http.withRetries(
      () => http.openStream('/api/chat', body, { signal, model: endpoint.model }),
      signal,
    );
    try {
      const firstCall = countToolCalls(request.messages) + 1;
      let calls = 0;
      let reasoningChunks = 0;
      for await (const raw of readNdjson(stream, OLLAMA_SERVICE)) {
        const line = parseLine(raw);
        const { message } = line;
        // Each streamed piece of reasoning is about one token; Ollama reports only the total.
        if (message?.thinking) reasoningChunks += 1;
        if (message?.content) yield { type: 'text', delta: message.content };
        for (const call of message?.tool_calls ?? []) {
          const position = firstCall + calls;
          calls += 1;
          yield {
            type: 'tool_call',
            call: {
              id: callId(position),
              name: call.function.name,
              arguments: parseToolArguments(
                call.function.arguments,
                call.function.name,
                OLLAMA_SERVICE,
              ),
            },
          };
        }
        if (line.done) {
          const output = line.eval_count ?? 0;
          yield {
            type: 'done',
            usage: makeUsage(
              line.prompt_eval_count ?? 0,
              output,
              reasoningChunks > 0 ? { reasoningTokens: Math.min(reasoningChunks, output) } : {},
            ),
            finish: line.done_reason === 'length' ? 'length' : calls > 0 ? 'tool_calls' : 'stop',
          };
          return;
        }
      }
      throw cutOff(OLLAMA_SERVICE);
    } finally {
      stream.close();
    }
  }

  async function describe(): Promise<StudentModelInfo> {
    const [shown, models] = await Promise.all([show(), fetchModels(http)]);
    const info: StudentModelInfo = { model: endpoint.model };
    const quantization = shown.details?.quantization_level;
    if (quantization) info.quantization = quantization;
    const installed = models.find((model) => sameModel(model.name, endpoint.model));
    if (installed) {
      info.digest = installed.digest;
      info.sizeBytes = installed.sizeBytes;
    }
    const contextLength = contextLengthOf(shown.model_info);
    if (contextLength !== undefined) info.contextLength = contextLength;
    return info;
  }

  async function testConnection(): Promise<ConnectionTest> {
    const started = performance.now();
    try {
      const version = await fetchVersion(http);
      if (isTooOld(version)) {
        return {
          ok: false,
          error: `Ollama ${version} is too old to run this model.`,
          hint: `Update Ollama to ${MIN_VERSION} or later.`,
        };
      }
      const models = await fetchModels(http);
      if (!models.some((model) => sameModel(model.name, endpoint.model))) {
        return {
          ok: false,
          error: `${endpoint.model} isn't downloaded yet.`,
          hint: `Pull ${endpoint.model} to download it.`,
        };
      }
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        detail: `Ollama ${version} is running and ${endpoint.model} is ready.`,
      };
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'network') {
        return {
          ok: false,
          error: `Ollama isn't running at ${endpoint.baseUrl}.`,
          hint: 'Install Ollama from ollama.com if you have not, then open it and test again.',
        };
      }
      return connectionFailure(error);
    }
  }

  return {
    label: deps.label ?? OLLAMA_SERVICE,
    model: endpoint.model,
    baseUrl: endpoint.baseUrl,
    isLocal: isLoopbackUrl(endpoint.baseUrl),
    chat,
    describe,
    testConnection,
    async release() {
      // An empty chat with keep_alive 0 is how Ollama is asked to unload a model.
      await http.postJson(
        '/api/chat',
        { model: endpoint.model, messages: [], keep_alive: 0, stream: false },
        AnyObjectWire,
        { model: endpoint.model, timeoutMs: UNLOAD_TIMEOUT_MS },
      );
    },
  };
}

function parseLine(raw: unknown): OllamaChunkWire {
  if (typeof raw === 'object' && raw !== null && 'error' in raw && raw.error) {
    throw new HttpError(failureForStreamError(describeErrorPayload(raw), OLLAMA_SERVICE));
  }
  const parsed = OllamaChunkWire.safeParse(raw);
  if (!parsed.success) {
    throw badResponse(OLLAMA_SERVICE, 'a reply line in an unexpected shape', parsed.error);
  }
  return parsed.data;
}

/** The model's own context window, which Ollama files under `<architecture>.context_length`. */
function contextLengthOf(info: ShowWire['model_info']): number | undefined {
  const architecture = info?.['general.architecture'];
  if (typeof architecture !== 'string') return undefined;
  const length = info?.[`${architecture}.context_length`];
  return typeof length === 'number' ? length : undefined;
}

/** A source build of Ollama reports 0.0.0, which says nothing about its age. */
function isTooOld(version: string): boolean {
  const have = parts(version);
  if (have.every((part) => part === 0)) return false;
  const need = parts(MIN_VERSION);
  for (let i = 0; i < need.length; i++) {
    const difference = (have[i] ?? 0) - (need[i] ?? 0);
    if (difference !== 0) return difference < 0;
  }
  return false;
}

function parts(version: string): number[] {
  return version
    .split(/[.+-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}
