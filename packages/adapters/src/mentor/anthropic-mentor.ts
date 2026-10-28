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
  type ReasoningEffort,
  type Usage,
} from '@architect/shared';
import {
  ANTHROPIC_VERSION,
  fitsOutputFormat,
  toAnthropicMessages,
  toolName,
} from '../anthropic/messages';
import { readMessagesStream } from '../anthropic/stream';
import { ModelInfoWire } from '../anthropic/wire';
import type { MentorDeps } from '../deps';
import { createHttpClient } from '../http/client';
import { badResponse, connectionFailure } from '../http/errors';
import { extractJsonObject, type JsonObject } from '../json-extract';
import { describeMissingModel } from '../openai/models';
import { listAnthropicModels } from '../models/anthropic';
import { addCosts, MentorReplyError } from './model-mentor';
import { emptyReply, jsonInstructions, repairMessages, unusableJson } from './prompts';
import type { ModelMentorConfig } from './providers';

const SERVICE = 'Anthropic';
const MESSAGES_PATH = '/messages';

/** What the model can do, from its entry in Anthropic's model list. */
interface Capabilities {
  /** `output_config.format`: decoding held to a JSON schema. */
  structuredOutputs: boolean;
  /** The `output_config.effort` levels it takes. */
  efforts: ReadonlySet<ReasoningEffort>;
}

/**
 * How the reply is held to the loop's schema: `output_config.format` where the model has
 * structured outputs; a forced tool call on older models that don't, where forcing a tool is the
 * reliable path; the schema in the prompt when the schema uses something structured outputs
 * don't take.
 */
type JsonPlan = 'format' | 'tool' | 'prompt';

interface Reply {
  text: string;
  cutOff: boolean;
  usage: Usage;
  costUsd: number | null;
}

function capabilitiesOf(info: ModelInfoWire): Capabilities {
  const capabilities = info.capabilities;
  const efforts = new Set<ReasoningEffort>();
  if (capabilities?.effort?.supported) {
    for (const level of ['low', 'medium', 'high'] as const) {
      if (capabilities.effort[level]?.supported !== false) efforts.add(level);
    }
  }
  return { structuredOutputs: capabilities?.structured_outputs?.supported === true, efforts };
}

function jsonPlan(capabilities: Capabilities, schema: unknown): JsonPlan {
  if (!capabilities.structuredOutputs) return 'tool';
  return fitsOutputFormat(schema) ? 'format' : 'prompt';
}

function refusal(category: string | null): string {
  const why = category ? ` (${category.replaceAll('_', ' ')})` : '';
  return `Anthropic's safety checks declined the request${why}. Try another mentor for this job.`;
}

/**
 * A mentor on Anthropic's Messages API. Replies are streamed. The model's own entry in the model
 * list, read once, says which controls it takes, so effort and structured output are only sent
 * where they work.
 */
export function createAnthropicMentor(
  config: ModelMentorConfig,
  deps: MentorDeps = {},
): MentorAdapter {
  const pricing = deps.pricing ?? mentorPricing(config);
  const apiKey = deps.apiKey ?? '';
  const http = createHttpClient({
    baseUrl: config.baseUrl,
    service: SERVICE,
    headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    secrets: apiKey ? [apiKey] : [],
    fetch: deps.fetch,
    retry: deps.retry,
    timeouts: deps.timeouts,
  });

  const price = (usage: Usage): number | null => (pricing ? costUsd(pricing, usage) : null);

  let known: Promise<Capabilities> | undefined;
  function capabilities(signal?: AbortSignal): Promise<Capabilities> {
    if (known) return known;
    const lookup = http
      .withRetries(
        () =>
          http.getJson(`/models/${encodeURIComponent(config.model)}`, ModelInfoWire, {
            signal,
            model: config.model,
          }),
        signal,
      )
      .then(capabilitiesOf);
    known = lookup;
    // A failed lookup is asked again next time rather than remembered.
    lookup.catch(() => {
      if (known === lookup) known = undefined;
    });
    return lookup;
  }

  function requestBody(
    request: MentorCompletionRequest,
    messages: ChatMessage[],
    plan: JsonPlan | null,
    model: Capabilities,
  ): Record<string, unknown> {
    const { json } = request;
    const converted = toAnthropicMessages(messages);
    const system = [
      request.system,
      ...converted.system,
      ...(json && plan === 'prompt' ? [jsonInstructions(json)] : []),
    ].join('\n\n');
    const body: Record<string, unknown> = {
      model: config.model,
      max_tokens: request.maxOutputTokens,
      system,
      messages: converted.messages,
      stream: true,
    };
    const output: Record<string, unknown> = {};
    const effort = request.reasoningEffort ?? config.reasoningEffort;
    if (model.efforts.has(effort)) output['effort'] = effort;
    if (json && plan === 'format') output['format'] = { type: 'json_schema', schema: json.schema };
    if (json && plan === 'tool') {
      const name = toolName(json.name);
      body['tools'] = [
        { name, description: `Give the reply as "${json.name}".`, input_schema: json.schema },
      ];
      body['tool_choice'] = { type: 'tool', name };
    }
    if (Object.keys(output).length > 0) body['output_config'] = output;
    return body;
  }

  /** One streamed request, read to the end, repeated whole if it fails part-way. */
  function ask(
    body: Record<string, unknown>,
    signal: AbortSignal | undefined,
    retries: boolean,
  ): Promise<Reply> {
    const attempt = async (): Promise<Reply> => {
      const stream = await http.openStream(MESSAGES_PATH, body, {
        signal,
        model: config.model,
        accept: 'text/event-stream',
      });
      try {
        const reply = await readMessagesStream(stream, SERVICE);
        if (!reply.usage) {
          throw badResponse(SERVICE, 'a reply without token usage, so its cost cannot be counted');
        }
        const spent = { usage: reply.usage, costUsd: price(reply.usage) };
        if (reply.stopReason === 'refusal') {
          throw new MentorReplyError(refusal(reply.refusalCategory), spent, 'blocked');
        }
        return {
          text: reply.toolInput ?? reply.text,
          cutOff: reply.stopReason === 'max_tokens',
          ...spent,
        };
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
    const model = await capabilities(signal);
    const plan = request.json ? jsonPlan(model, request.json.schema) : null;
    const first = await ask(requestBody(request, request.messages, plan, model), signal, retries);
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
          ...repairMessages(first.text, parsed.error, plan === 'prompt'),
        ];
        last = await ask(requestBody(request, correction, plan, model), signal, retries);
        usage = addUsage(usage, last.usage);
        cost = addCosts(cost, last.costUsd);
        parsed = extractJsonObject(last.text);
        if (!parsed.ok) {
          throw new MentorReplyError(unusableJson(parsed.error, last.cutOff), {
            usage,
            costUsd: cost,
          });
        }
      }
      json = parsed.value;
    } else if (first.text.trim() === '') {
      throw new MentorReplyError(emptyReply(first.cutOff), { usage, costUsd: cost });
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
    try {
      await capabilities();
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        detail: `Connected to ${SERVICE}. ${config.model} is available.`,
      };
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'not_found') {
        const available = await listAnthropicModels(http).then(
          (models) => models.map((model) => model.id),
          () => [],
        );
        return {
          ok: false,
          error: `${SERVICE} accepted the key but doesn't offer "${config.model}".`,
          hint: describeMissingModel(config.model, available),
        };
      }
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
