import {
  AdapterError,
  DecodingSchema,
  emptyUsage,
  GLIMMER_SAMPLING,
  readsReasoningStrengthLine,
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

/**
 * How a host is told how hard the model should think. Glimmer always reasons and reads its
 * strength from a line in the system message, or from a template variable on a local server.
 * OpenRouter maps `reasoning.effort` onto any model's own levels. Other models get neither.
 */
interface ReasoningPlan {
  /** Add `Reasoning strength: <level>.` to the system message. */
  line: boolean;
  /** `openrouter`: send `reasoning.effort`. `template`: send `chat_template_kwargs`. */
  field: 'openrouter' | 'template' | null;
}

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
 * A student behind an OpenAI-compatible Chat Completions endpoint: a hosted copy on Together,
 * OpenRouter, DeepInfra, Groq or Fireworks, or a server on this computer such as LM Studio or
 * llama.cpp. Reasoning text is counted and dropped.
 */
export function createOpenAICompatibleStudent(
  endpoint: StudentEndpoint,
  deps: StudentDeps = {},
): StudentAdapter {
  const { hostname, host: service } = new URL(endpoint.baseUrl);
  const plan = reasoningPlan(endpoint);
  // Groq refuses a `name` on messages, so tool results go without one there.
  const toolNames = hostname !== 'api.groq.com';

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
    const messages = toWireMessages(request.messages, { systemRole: 'system', toolNames });
    const body: Record<string, unknown> = {
      model: endpoint.model,
      // OpenRouter passes `reasoning.effort` on to some providers but not all (DeepInfra reads
      // Glimmer's system line), so Glimmer there gets both.
      messages: plan.line ? withReasoningLine(messages, level) : messages,
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
    if (plan.field === 'openrouter') body['reasoning'] = { effort: level };
    // A comparison pins OpenRouter to one provider's serving of the model, with no fallback.
    if (plan.field === 'openrouter' && endpoint.providers !== undefined) {
      body['provider'] = { order: endpoint.providers, allow_fallbacks: false };
    }
    if (plan.field === 'template') body['chat_template_kwargs'] = { reasoning_strength: level };
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

function reasoningPlan(endpoint: StudentEndpoint): ReasoningPlan {
  const glimmer = readsReasoningStrengthLine(endpoint.model);
  const { hostname } = new URL(endpoint.baseUrl);
  if (hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai')) {
    return { line: glimmer, field: 'openrouter' };
  }
  if (!glimmer) return { line: false, field: null };
  return isLoopbackUrl(endpoint.baseUrl)
    ? { line: false, field: 'template' }
    : { line: true, field: null };
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
