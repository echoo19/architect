import {
  addUsage,
  AdapterError,
  costUsd,
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
import { toWireMessages } from '../openai/messages';
import { describeMissingModel, probeModel } from '../openai/models';
import { readChatCompletionStream, type FinishReason } from '../openai/stream';
import { jsonInstructions, repairMessages } from './prompts';
import {
  presetPricing,
  providerTraits,
  supportsStructuredOutput,
  type ModelMentorConfig,
} from './providers';

const CHAT_PATH = '/chat/completions';

/** The spend on a call that produced nothing usable, so the caller can still count it. */
export class MentorReplyError extends AdapterError {
  readonly usage: Usage;
  readonly costUsd: number | null;

  constructor(message: string, spent: { usage: Usage; costUsd: number | null }) {
    super('bad_response', message);
    this.usage = spent.usage;
    this.costUsd = spent.costUsd;
  }
}

interface Reply {
  text: string;
  finish: FinishReason;
  usage: Usage;
}

/**
 * A mentor behind an OpenAI-compatible Chat Completions endpoint: the Meta Model API, or Muse
 * Spark Open on Baseten, Modal or another host. Replies are streamed, since a long non-streamed
 * request can hit the gateway's timeout.
 */
export function createModelMentor(config: ModelMentorConfig, deps: MentorDeps): MentorAdapter {
  const traits = providerTraits(config);
  const pricing = deps.pricing ?? presetPricing(config);
  const structured = supportsStructuredOutput(config);
  const sessionKey = deps.sessionKey ?? `architect-${crypto.randomUUID()}`;
  const { service } = traits;

  const http = createHttpClient({
    baseUrl: config.baseUrl,
    service,
    headers: {
      ...(deps.apiKey ? { authorization: `Bearer ${deps.apiKey}` } : {}),
      ...(traits.sendsAffinityKey ? { 'modal-routing-affinity-key': sessionKey } : {}),
    },
    secrets: [deps.apiKey],
    fetch: deps.fetch,
    retry: deps.retry,
    timeouts: deps.timeouts,
  });

  const price = (usage: Usage): number | null => (pricing ? costUsd(pricing, usage) : null);

  function requestBody(
    request: MentorCompletionRequest,
    messages: ChatMessage[],
  ): Record<string, unknown> {
    const system =
      request.json && !structured
        ? `${request.system}\n\n${jsonInstructions(request.json)}`
        : request.system;
    const body: Record<string, unknown> = {
      model: config.model,
      messages: toWireMessages([{ role: 'system', content: system }, ...messages], {
        systemRole: traits.systemRole,
        toolNames: false,
      }),
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: request.reasoningEffort ?? config.reasoningEffort,
      [traits.tokenLimitField]: request.maxOutputTokens,
    };
    if (request.json && structured) {
      body['response_format'] = {
        type: 'json_schema',
        json_schema: { name: request.json.name, schema: request.json.schema },
      };
    }
    if (traits.sendsCacheKey) body['prompt_cache_key'] = sessionKey;
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
          return { text, finish: event.finish, usage: event.usage };
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
    let json: JsonObject | undefined;

    if (request.json) {
      let parsed = extractJsonObject(first.text);
      if (!parsed.ok) {
        // One chance to fix it: show the model what it wrote and why that failed.
        const correction = [
          ...request.messages,
          ...repairMessages(first.text, parsed.error, !structured),
        ];
        last = await ask(requestBody(request, correction), signal, retries);
        usage = addUsage(usage, last.usage);
        parsed = extractJsonObject(last.text);
        if (!parsed.ok) {
          throw new MentorReplyError(unusableJson(parsed.error, last.finish), spent(usage));
        }
      }
      json = parsed.value;
    } else if (first.text.trim() === '') {
      throw new MentorReplyError(emptyReply(first.finish), spent(usage));
    }

    const completion: MentorCompletion = {
      text: last.text,
      usage,
      costUsd: price(usage),
      model: config.model,
      latencyMs: Math.round(performance.now() - started),
    };
    if (json !== undefined) completion.json = json;
    return completion;
  }

  function spent(usage: Usage): { usage: Usage; costUsd: number | null } {
    return { usage, costUsd: price(usage) };
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
          error: `${service} accepted the key but doesn't offer "${config.model}".`,
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

function unusableJson(problem: string, finish: FinishReason): string {
  return finish === 'length'
    ? "The mentor's reply was cut off at the output limit, so its JSON was incomplete. Raise the limit or lower the reasoning effort."
    : `The mentor's reply was not valid JSON, even after one correction. ${problem}`;
}

function emptyReply(finish: FinishReason): string {
  return finish === 'length'
    ? 'The mentor used its whole output limit on reasoning and wrote no answer. Raise the limit or lower the reasoning effort.'
    : 'The mentor sent an empty reply.';
}
