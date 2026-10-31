import {
  AdapterError,
  type ConnectionTest,
  type StudentAdapter,
  type StudentChatRequest,
  type StudentEndpoint,
  type StudentModelInfo,
  type StudentStreamEvent,
} from '@architect/shared';
import { current, type StudentDeps } from '../deps';
import { createHttpClient } from '../http/client';
import { badResponse, connectionFailure, cutOff, HttpError } from '../http/errors';
import { describeErrorPayload, failureForStreamError } from '../http/failures';
import { readNdjson } from '../http/ndjson';
import { isLoopbackUrl } from '../loopback';
import { toWireTools } from '../openai/messages';
import { callId, countToolCalls, parseToolArguments } from '../tool-calls';
import { makeUsage } from '../usage';
import { fetchModels, fetchVersion, OLLAMA_SERVICE, unloadModel } from './ollama-api';
import { OllamaChunkWire, ShowWire, sameModel, toOllamaMessages } from './ollama-wire';
import { rest } from './rest';

/**
 * What Ollama says when the model writes a tool call its parser can't read, such as "parse
 * Glimmer call to run: missing ATEM function_calls wrapper". It answers HTTP 500, or ends the
 * stream with it, but the fault is in what the model wrote, not in the server.
 */
const UNREADABLE_CALL = /\bparse\b[^.]*\bcall\b[^.]*/i;

/**
 * Ollama's error for a tool call it couldn't read, as one the model wrote badly: the turn can be
 * asked for again, or count against the student, instead of stopping an evaluation as an outage.
 * Asking again with the same seed gets the same call, so it is never retried as it stands.
 */
function asUnreadableCall(error: unknown): unknown {
  if (!(error instanceof AdapterError) || error.code !== 'server') return error;
  const said = UNREADABLE_CALL.exec(error.message);
  if (!said) return error;
  return new AdapterError(
    'bad_response',
    `The model wrote a tool call ${OLLAMA_SERVICE} couldn't read (${said[0].trim()}).`,
    { cause: error, ...(error.status === undefined ? {} : { status: error.status }) },
  );
}

/** Muse Glimmer's renderer and parser first shipped in this release. */
const MIN_VERSION = '0.32.7';

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
    network: deps.network,
    retry: deps.retry,
    timeouts: deps.timeouts,
  });

  const show = (signal?: AbortSignal): Promise<ShowWire> =>
    http.postJson('/api/show', { model: endpoint.model }, ShowWire, {
      signal,
      model: endpoint.model,
    });

  let known: ThinkStyle | undefined;
  /**
   * How the model takes `think`: models without the `thinking` capability reject the field, and
   * a model that lists no levels, unlike Glimmer, takes only true or false.
   */
  async function thinkStyle(signal?: AbortSignal): Promise<ThinkStyle> {
    if (known !== undefined) return known;
    try {
      const shown = await show(signal);
      known = thinkStyleOf(shown);
      return known;
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'aborted') throw error;
      // The chat request will report a missing model or a stopped server far better than this lookup.
      return { kind: 'levels', levels: null };
    }
  }

  function chatBody(request: StudentChatRequest, style: ThinkStyle): Record<string, unknown> {
    const { decoding } = request;
    // Asked for each request: a change in quiet mode reaches a student that is already open.
    const threads = current(deps.cpuThreads);
    return {
      model: endpoint.model,
      messages: toOllamaMessages(request.messages),
      ...(request.tools.length > 0 ? { tools: toWireTools(request.tools) } : {}),
      ...thinkField(style, decoding.thinking),
      stream: true,
      options: {
        num_ctx: endpoint.contextLength,
        num_predict: decoding.maxOutputTokens,
        temperature: decoding.temperature,
        top_p: decoding.topP,
        top_k: decoding.topK,
        seed: request.seed,
        ...(threads === undefined ? {} : { num_thread: threads }),
      },
    };
  }

  async function* chat(
    request: StudentChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StudentStreamEvent> {
    const started = performance.now();
    const body = chatBody(request, await thinkStyle(signal));
    const stream = await http.withRetries(
      () =>
        http.openStream('/api/chat', body, { signal, model: endpoint.model }).catch((error) => {
          throw asUnreadableCall(error);
        }),
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
            finish: finishReason(line.done_reason, calls),
          };
          // In quiet mode the GPU rests for a share of the time the reply took, so the next
          // call starts cooler.
          const cooldown = current(deps.cooldown);
          if (cooldown) await (deps.rest ?? rest)((performance.now() - started) * cooldown, signal);
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
    contextLength: endpoint.contextLength,
    chat,
    describe,
    testConnection,
    release: () => unloadModel(http, endpoint.model),
  };
}

/**
 * How a model takes Ollama's `think`: not at all, as levels it names (Glimmer's are low to max;
 * null when Ollama is too old to list them), or as true or false only.
 */
type ThinkStyle =
  { kind: 'none' } | { kind: 'levels'; levels: readonly string[] | null } | { kind: 'boolean' };

/** Reads `/api/show`. An Ollama that reports no capabilities at all is assumed to take levels. */
function thinkStyleOf(shown: ShowWire): ThinkStyle {
  const { capabilities } = shown;
  if (capabilities?.length && !capabilities.includes('thinking')) return { kind: 'none' };
  const levels = (shown.thinking?.values ?? []).filter(
    (value): value is string => typeof value === 'string',
  );
  if (levels.length > 0) return { kind: 'levels', levels };
  return capabilities?.length ? { kind: 'boolean' } : { kind: 'levels', levels: null };
}

/** The `think` field for the harness's reasoning level, in the form the model takes. */
function thinkField(style: ThinkStyle, level: string): { think?: string | boolean } {
  switch (style.kind) {
    case 'none':
      return {};
    case 'boolean':
      return { think: true };
    case 'levels':
      return { think: style.levels === null || style.levels.includes(level) ? level : true };
  }
}

function parseLine(raw: unknown): OllamaChunkWire {
  if (typeof raw === 'object' && raw !== null && 'error' in raw && raw.error) {
    throw asUnreadableCall(
      new HttpError(failureForStreamError(describeErrorPayload(raw), OLLAMA_SERVICE)),
    );
  }
  const parsed = OllamaChunkWire.safeParse(raw);
  if (!parsed.success) {
    throw badResponse(OLLAMA_SERVICE, 'a reply line in an unexpected shape', parsed.error);
  }
  return parsed.data;
}

function finishReason(
  doneReason: string | null | undefined,
  toolCalls: number,
): 'stop' | 'tool_calls' | 'length' {
  if (doneReason === 'length') return 'length';
  return toolCalls > 0 ? 'tool_calls' : 'stop';
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
