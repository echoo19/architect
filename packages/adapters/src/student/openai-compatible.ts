import {
  AdapterError,
  DecodingSchema,
  emptyUsage,
  GLIMMER_SAMPLING,
  type ConnectionTest,
  type StudentAdapter,
  type StudentChatRequest,
  type StudentEndpoint,
  type StudentStreamEvent,
} from '@architect/shared';
import type { StudentDeps } from '../deps';
import { createHttpClient } from '../http/client';
import { connectionFailure } from '../http/errors';
import { isLoopbackUrl } from '../loopback';
import { toWireMessages, toWireTools, type WireMessage } from '../openai/messages';
import { describeMissingModel, probeModel } from '../openai/models';
import { readChatCompletionStream } from '../openai/stream';
import { countToolCalls } from '../tool-calls';

const CHAT_PATH = '/chat/completions';

/** How a host wants to be told how hard to think. Glimmer always reasons; only the strength varies. */
type ReasoningStyle =
  /** OpenRouter maps `reasoning.effort` onto the model's levels. */
  | 'openrouter'
  /** A local llama.cpp, vLLM or SGLang takes template variables per request. */
  | 'template'
  /** Other hosts pass the system message to the chat template, which reads the line. */
  | 'system_line';

const CHECK_REQUEST: StudentChatRequest = {
  messages: [{ role: 'user', content: 'Reply with the word ready.' }],
  tools: [],
  decoding: DecodingSchema.parse({
    temperature: GLIMMER_SAMPLING.temperature,
    topP: GLIMMER_SAMPLING.topP,
    topK: GLIMMER_SAMPLING.topK,
    maxOutputTokens: 64,
    thinking: 'low',
  }),
  seed: 1,
};

/**
 * A student behind an OpenAI-compatible Chat Completions endpoint: hosted Glimmer on Together,
 * OpenRouter or DeepInfra, or a llama.cpp server. Reasoning text is counted and dropped.
 */
export function createOpenAICompatibleStudent(
  endpoint: StudentEndpoint,
  deps: StudentDeps = {},
): StudentAdapter {
  const service = new URL(endpoint.baseUrl).host;
  const style = reasoningStyle(endpoint.baseUrl);

  const http = createHttpClient({
    baseUrl: endpoint.baseUrl,
    service,
    headers: deps.apiKey ? { authorization: `Bearer ${deps.apiKey}` } : {},
    secrets: deps.apiKey ? [deps.apiKey] : [],
    fetch: deps.fetch,
    retry: deps.retry,
    timeouts: deps.timeouts,
  });

  function chatBody(request: StudentChatRequest): Record<string, unknown> {
    const { decoding } = request;
    const level = decoding.thinking;
    const messages = toWireMessages(request.messages, { systemRole: 'system', toolNames: true });
    const body: Record<string, unknown> = {
      model: endpoint.model,
      // OpenRouter passes `reasoning.effort` on to some providers but not all (DeepInfra reads the
      // system line), so it gets both.
      messages:
        style === 'system_line' || style === 'openrouter'
          ? withReasoningLine(messages, level)
          : messages,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: decoding.maxOutputTokens,
      temperature: decoding.temperature,
      top_p: decoding.topP,
      seed: request.seed,
    };
    // Hosts read 0 as "off" or reject it, so leave top_k out instead of sending it.
    if (decoding.topK > 0) body['top_k'] = decoding.topK;
    if (request.tools.length > 0) body['tools'] = toWireTools(request.tools);
    if (style === 'openrouter') body['reasoning'] = { effort: level };
    if (style === 'template') body['chat_template_kwargs'] = { reasoning_strength: level };
    return body;
  }

  async function* events(
    request: StudentChatRequest,
    signal: AbortSignal | undefined,
    retries: boolean,
  ): AsyncGenerator<StudentStreamEvent> {
    const body = chatBody(request);
    const open = () =>
      http.openStream(CHAT_PATH, body, {
        signal,
        model: endpoint.model,
        accept: 'text/event-stream',
      });
    const stream = await (retries ? http.withRetries(open, signal) : open());
    try {
      const firstCallNumber = countToolCalls(request.messages) + 1;
      for await (const event of readChatCompletionStream(stream, { service, firstCallNumber })) {
        if (event.type === 'text') {
          yield event;
          continue;
        }
        for (const call of event.toolCalls) yield { type: 'tool_call', call };
        yield { type: 'done', usage: event.usage ?? emptyUsage(), finish: event.finish };
      }
    } finally {
      stream.close();
    }
  }

  async function testConnection(): Promise<ConnectionTest> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    try {
      const probe = await probeModel(http, endpoint.model);
      if (probe.kind === 'listed') {
        return {
          ok: true,
          latencyMs: elapsed(),
          detail: `Connected to ${service}. ${endpoint.model} is available.`,
        };
      }
      // Hosts differ in what they list (dedicated endpoints often aren't), so ask for a few tokens.
      try {
        for await (const _event of events(CHECK_REQUEST, undefined, false)) {
          // Reading to the end is the check; the reply itself doesn't matter.
        }
      } catch (error) {
        if (
          probe.kind === 'missing' &&
          error instanceof AdapterError &&
          error.code === 'not_found'
        ) {
          return {
            ok: false,
            error: `${service} doesn't offer "${endpoint.model}".`,
            hint: describeMissingModel(endpoint.model, probe.available),
          };
        }
        throw error;
      }
      return {
        ok: true,
        latencyMs: elapsed(),
        detail: `Connected to ${service}. The model answered.`,
      };
    } catch (error) {
      return connectionFailure(error);
    }
  }

  return {
    label: deps.label ?? service,
    model: endpoint.model,
    baseUrl: endpoint.baseUrl,
    isLocal: isLoopbackUrl(endpoint.baseUrl),
    chat: (request, signal) => events(request, signal, true),
    describe: async () => ({ model: endpoint.model }),
    testConnection,
    release: async () => {},
  };
}

function reasoningStyle(baseUrl: string): ReasoningStyle {
  const { hostname } = new URL(baseUrl);
  if (hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai')) return 'openrouter';
  return isLoopbackUrl(baseUrl) ? 'template' : 'system_line';
}

/** Glimmer's chat template reads `Reasoning strength: <level>.` from the system message. */
function withReasoningLine(messages: WireMessage[], level: string): WireMessage[] {
  const line = `Reasoning strength: ${level}.`;
  const index = messages.findIndex((message) => message.role === 'system');
  if (index === -1) return [{ role: 'system', content: line }, ...messages];
  return messages.map((message, position) =>
    position === index && message.role === 'system'
      ? { ...message, content: `${message.content}\n\n${line}` }
      : message,
  );
}
