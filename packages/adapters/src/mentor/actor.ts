import {
  AdapterError,
  costUsd,
  emptyUsage,
  mentorPricing,
  type ActorAdapter,
  type MentorConfig,
  type StudentChatRequest,
  type StudentStreamEvent,
  type Usage,
} from '@architect/shared';
import type { MentorDeps } from '../deps';
import { createHttpClient } from '../http/client';
import { connectionFailure } from '../http/errors';
import { isLoopbackUrl } from '../loopback';
import { toWireMessages, toWireTools } from '../openai/messages';
import { openUnstreamed } from '../openai/unstreamed';
import { readChatCompletionStream } from '../openai/stream';
import { countToolCalls } from '../tool-calls';
import { chatTraits, type ModelMentorConfig } from './providers';

const CHAT_PATH = '/chat/completions';

/** Whether `createMentorActor` can make this mentor an agent: a model on a Chat Completions API. */
export function mentorCanAct(config: MentorConfig): config is ModelMentorConfig {
  return config.kind === 'model' && config.provider !== 'anthropic';
}

/**
 * The mentor's model as an agent with the student's tools (decision 042): the same provider, key,
 * price, token field, reasoning control and price cap as the mentor, with the tools offered and
 * their calls streamed back the way a student's are. The runner admits every call through the
 * mentor's gate. Sampling and the runner's seed are left to the provider, which may not take
 * them. Anthropic's Messages API isn't spoken here yet.
 */
export function createMentorActor(config: MentorConfig, deps: MentorDeps = {}): ActorAdapter {
  if (!mentorCanAct(config)) {
    throw new AdapterError(
      'bad_request',
      `${config.label} can't act as the agent yet. Choose a mentor on a Chat Completions API.`,
    );
  }
  const model: ModelMentorConfig = config;
  const traits = chatTraits(model);
  const pricing = deps.pricing ?? mentorPricing(model);
  const sessionKey = deps.sessionKey ?? `architect-${crypto.randomUUID()}`;
  const { service } = traits;
  const apiKey = deps.apiKey ?? '';
  const http = createHttpClient({
    baseUrl: traits.baseUrl,
    service,
    headers: {
      ...traits.headers,
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      ...(traits.sendsAffinityKey ? { 'modal-routing-affinity-key': sessionKey } : {}),
    },
    secrets: apiKey ? [apiKey] : [],
    fetch: deps.fetch,
    retry: deps.retry,
    timeouts: deps.timeouts,
  });
  const price = (usage: Usage): number | null => (pricing ? costUsd(pricing, usage) : null);

  function body(request: StudentChatRequest): Record<string, unknown> {
    const wire: Record<string, unknown> = {
      model: model.model,
      messages: toWireMessages(request.messages, {
        systemRole: traits.systemRole,
        toolNames: new URL(traits.baseUrl).hostname !== 'api.groq.com',
      }),
      stream: true,
      stream_options: { include_usage: true },
      [traits.tokenLimitField]: request.decoding.maxOutputTokens,
    };
    if (request.tools.length > 0) wire['tools'] = toWireTools(request.tools);
    if (traits.reasoning === 'reasoning_effort') wire['reasoning_effort'] = model.reasoningEffort;
    if (traits.reasoning === 'openrouter') wire['reasoning'] = { effort: model.reasoningEffort };
    if (traits.sendsCacheKey) wire['prompt_cache_key'] = sessionKey;
    if (traits.capsPrice && pricing) {
      wire['provider'] = {
        max_price: { prompt: pricing.inputPerM, completion: pricing.outputPerM },
      };
    }
    return wire;
  }

  async function* chat(
    request: StudentChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StudentStreamEvent> {
    const stream = await http.withRetries(
      () =>
        traits.unstreamed
          ? openUnstreamed(http, CHAT_PATH, body(request), { signal, model: model.model })
          : http.openStream(CHAT_PATH, body(request), {
              signal,
              model: model.model,
              accept: 'text/event-stream',
            }),
      signal,
    );
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

  return {
    label: model.label,
    model: model.model,
    baseUrl: traits.baseUrl,
    isLocal: isLoopbackUrl(traits.baseUrl),
    // The mentor's model has a window far beyond any task here, so the loop makes no room for it.
    contextLength: null,
    chat,
    estimateCostUsd: price,
    describe: async () => ({ model: model.model }),
    testConnection: async () => {
      const started = performance.now();
      try {
        for await (const _event of chat({
          messages: [{ role: 'user', content: 'Reply with the word ready.' }],
          tools: [],
          decoding: {
            temperature: 1,
            topP: 1,
            topK: 0,
            maxSteps: 1,
            maxOutputTokens: 64,
            thinking: 'low',
          },
          seed: 1,
        })) {
          // Reading to the end is the check.
        }
        return {
          ok: true,
          latencyMs: Math.round(performance.now() - started),
          detail: `${service} answered as the agent.`,
        };
      } catch (error) {
        return connectionFailure(error);
      }
    },
    release: async () => {},
  };
}
