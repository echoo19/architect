import {
  addUsage,
  AdapterError,
  costUsd,
  mentorPricing,
  type ChatMessage,
  type ConnectionTest,
  type MentorAdapter,
  type MentorCompletion,
  type MentorCompletionRequest,
  type Usage,
} from '@architect/shared';
import type { MentorDeps } from '../deps';
import { createHttpClient } from '../http/client';
import { badResponse, connectionFailure, cutOff } from '../http/errors';
import { extractJsonObject, type JsonObject } from '../json-extract';
import { fitsStrictSubset } from '../json-schema';
import { toWireMessages } from '../openai/messages';
import { describeMissingModel, probeModel } from '../openai/models';
import { readChatCompletionStream, type FinishReason } from '../openai/stream';
import { emptyReply, jsonInstructions, repairMessages, unusableJson } from './prompts';
import { chatTraits, type ModelMentorConfig } from './providers';

const CHAT_PATH = '/chat/completions';

/**
 * A call that produced nothing usable, with what it spent, so the caller can still count it. A
 * provider declining the request is `blocked`; anything else is a `bad_response`.
 */
export class MentorReplyError extends AdapterError {
  readonly usage: Usage;
  readonly costUsd: number | null;

  constructor(
    message: string,
    spent: { usage: Usage; costUsd: number | null },
    code: 'bad_response' | 'blocked' = 'bad_response',
  ) {
    super(code, message);
    this.usage = spent.usage;
    this.costUsd = spent.costUsd;
  }
}

interface Reply {
  text: string;
  finish: FinishReason;
  usage: Usage;
  /** What the call cost: the server's own figure when it gives one, else the price applied. */
  costUsd: number | null;
}

/** Two calls' costs together; unknown when either is. */
export function addCosts(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

/**
 * A mentor behind an OpenAI-compatible Chat Completions endpoint: Meta, OpenAI, Google Gemini,
 * OpenRouter, Muse Spark Open on Baseten or Modal, a model on this computer, or any other
 * compatible server. Replies are streamed, since a long non-streamed request can hit a gateway's
 * timeout.
 */
export function createModelMentor(config: ModelMentorConfig, deps: MentorDeps = {}): MentorAdapter {
  const traits = chatTraits(config);
  const pricing = deps.pricing ?? mentorPricing(config);
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

  function requestBody(
    request: MentorCompletionRequest,
    messages: ChatMessage[],
  ): Record<string, unknown> {
    const { json } = request;
    const system =
      json && traits.json !== 'schema'
        ? `${request.system}\n\n${jsonInstructions(json)}`
        : request.system;
    const body: Record<string, unknown> = {
      model: config.model,
      messages: toWireMessages([{ role: 'system', content: system }, ...messages], {
        systemRole: traits.systemRole,
        toolNames: false,
      }),
      stream: true,
      stream_options: { include_usage: true },
      [traits.tokenLimitField]: request.maxOutputTokens,
    };
    const effort = request.reasoningEffort ?? config.reasoningEffort;
    if (traits.reasoning === 'reasoning_effort') body['reasoning_effort'] = effort;
    if (traits.reasoning === 'openrouter') body['reasoning'] = { effort };
    if (json && traits.json !== 'prompt') {
      const strict = traits.strictSchema && fitsStrictSubset(json.schema);
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: json.name, schema: json.schema, ...(strict ? { strict: true } : {}) },
      };
    }
    if (traits.sendsCacheKey) body['prompt_cache_key'] = sessionKey;
    if (traits.capsPrice && pricing) {
      // Never routed to a provider that charges more than the price the budget is kept with.
      body['provider'] = {
        max_price: { prompt: pricing.inputPerM, completion: pricing.outputPerM },
      };
    }
    return body;
  }

  /**
   * One streamed request, read to the end. A failure part-way, such as a dropped connection,
   * repeats the whole request, since nothing has been handed to the caller yet.
   */
  function ask(
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    retries: boolean,
  ): Promise<Reply> {
    const attempt = async (): Promise<Reply> => {
      const stream = await http.openStream(CHAT_PATH, body, {
        signal,
        model: config.model,
        accept: 'text/event-stream',
      });
      try {
        let text = '';
        for await (const event of readChatCompletionStream(stream, { service })) {
          if (event.type === 'text') {
            text += event.delta;
            continue;
          }
          if (!event.usage) {
            throw badResponse(
              service,
              'a reply without token usage, so its cost cannot be counted',
            );
          }
          return {
            text,
            finish: event.finish,
            usage: event.usage,
            costUsd: event.costUsd ?? price(event.usage),
          };
        }
        throw cutOff(service);
      } finally {
        stream.close();
      }
    };
    return retries ? http.withRetries(attempt, signal) : attempt();
  }

  async function complete(
    request: MentorCompletionRequest,
    signal?: AbortSignal,
    retries = true,
  ): Promise<MentorCompletion> {
    const started = performance.now();
    const first = await ask(requestBody(request, request.messages), signal, retries);
    let last = first;
    let usage = first.usage;
    let cost = first.costUsd;
    let json: JsonObject | undefined;

    if (request.json) {
      let parsed = extractJsonObject(first.text);
      if (!parsed.ok) {
        // One chance to fix it: show the model what it wrote and why that failed.
        const correction = [
          ...request.messages,
          ...repairMessages(first.text, parsed.error, traits.json !== 'schema'),
        ];
        last = await ask(requestBody(request, correction), signal, retries);
        usage = addUsage(usage, last.usage);
        cost = addCosts(cost, last.costUsd);
        parsed = extractJsonObject(last.text);
        if (!parsed.ok) {
          throw new MentorReplyError(unusableJson(parsed.error, last.finish === 'length'), {
            usage,
            costUsd: cost,
          });
        }
      }
      json = parsed.value;
    } else if (first.text.trim() === '') {
      throw new MentorReplyError(emptyReply(first.finish === 'length'), { usage, costUsd: cost });
    }

    const completion: MentorCompletion = {
      text: last.text,
      usage,
      costUsd: cost,
      model: config.model,
      latencyMs: Math.round(performance.now() - started),
    };
    if (json !== undefined) completion.json = json;
    return completion;
  }

  async function testConnection(): Promise<ConnectionTest> {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    try {
      const probe = await probeModel(http, config.model);
      if (probe.kind === 'listed') {
        return {
          ok: true,
          latencyMs: elapsed(),
          detail: `Connected to ${service}. ${config.model} is available.`,
        };
      }
      if (probe.kind === 'missing') {
        return {
          ok: false,
          error: apiKey
            ? `${service} accepted the key but doesn't offer "${config.model}".`
            : `${service} doesn't offer "${config.model}".`,
          hint: describeMissingModel(config.model, probe.available),
        };
      }
      // No model list on this host, so ask for a few tokens instead.
      await complete(
        {
          system: 'Reply with the single word ready.',
          messages: [{ role: 'user', content: 'Are you there?' }],
          maxOutputTokens: 64,
          reasoningEffort: 'low',
        },
        undefined,
        false,
      );
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
    kind: 'model',
    label: config.label,
    model: config.model,
    provider: config.provider,
    complete: (request, signal) => complete(request, signal),
    estimateCostUsd: price,
    testConnection,
  };
}
