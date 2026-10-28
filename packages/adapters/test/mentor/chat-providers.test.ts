import { mentorPreset, type MentorCompletionRequest } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createModelMentor } from '../../src/mentor/model-mentor';
import type { ModelMentorConfig } from '../../src/mentor/providers';
import { textReply, usageChunk, deltaChunk, type UsageBody } from '../helpers/chat';
import { mentorConfig } from '../helpers/configs';
import {
  routeTo,
  sendEventStream,
  startServer,
  stopServers,
  type FakeServer,
  type RecordedRequest,
} from '../helpers/server';

afterEach(stopServers);

const API_KEY = 'sk-test-0123456789';
const STRICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { title: { type: 'string' } },
  required: ['title'],
} as const;
const LOOSE_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
} as const;
const REQUEST: MentorCompletionRequest = {
  system: 'You are the mentor.',
  messages: [{ role: 'user', content: 'Diagnose.' }],
  json: { name: 'hypothesis', schema: STRICT_SCHEMA },
  maxOutputTokens: 4096,
};

async function call(
  config: ModelMentorConfig,
  replyText = '{"title":"Fix"}',
  usage: UsageBody & { cost?: number } = { prompt_tokens: 10, completion_tokens: 5 },
  request: MentorCompletionRequest = REQUEST,
  apiKey: string | null = API_KEY,
) {
  const server = await startServer((_request, res) =>
    sendEventStream(res, [
      deltaChunk({ role: 'assistant', content: '' }),
      deltaChunk({ content: replyText }),
      deltaChunk({}, 'stop'),
      usageChunk(usage),
      '[DONE]',
    ]),
  );
  const mentor = createModelMentor(config, {
    ...(apiKey === null ? {} : { apiKey }),
    fetch: routeTo(server),
    retry: { maxAttempts: 1 },
  });
  const completion = await mentor.complete(request);
  return { completion, server, mentor, sent: body(server.requests[0]) };
}

const body = (request: RecordedRequest | undefined) => request?.json() ?? {};
const roles = (sent: Record<string, unknown>) =>
  (sent['messages'] as { role: string }[]).map((message) => message.role);
const systemText = (sent: Record<string, unknown>) =>
  (sent['messages'] as { content: string }[])[0]?.content ?? '';

describe('OpenAI', () => {
  it('sends a developer message, max_completion_tokens, a strict schema and the effort', async () => {
    const { sent, server, completion } = await call(mentorConfig('openai-gpt-6-luna'));
    expect(server.requests[0]?.path).toBe('/v1/chat/completions');
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(roles(sent)).toEqual(['developer', 'user']);
    expect(sent['max_completion_tokens']).toBe(4096);
    expect(sent).not.toHaveProperty('max_tokens');
    expect(sent['reasoning_effort']).toBe('medium');
    expect(sent['response_format']).toEqual({
      type: 'json_schema',
      json_schema: { name: 'hypothesis', schema: STRICT_SCHEMA, strict: true },
    });
    expect(typeof sent['prompt_cache_key']).toBe('string');
    expect(systemText(sent)).toBe('You are the mentor.');
    expect(completion.json).toEqual({ title: 'Fix' });
  });

  it('prices the call at the preset, with long prompts at the long-prompt rates', async () => {
    const short = await call(mentorConfig('openai-gpt-6-luna'), undefined, {
      prompt_tokens: 200_000,
      completion_tokens: 1_000_000,
    });
    expect(short.completion.costUsd).toBeCloseTo((200_000 * 0.1) / 1e6 + 0.5, 10);
    // Above 272,000 input tokens the whole call bills at $0.20 in and $0.75 out per million.
    expect(
      short.mentor.estimateCostUsd({ inputTokens: 300_000, outputTokens: 100_000 }),
    ).toBeCloseTo((300_000 * 0.2 + 100_000 * 0.75) / 1e6, 10);
  });

  it('leaves strict off for a schema outside the strict subset', async () => {
    const { sent } = await call(mentorConfig('openai-gpt-6-luna'), undefined, undefined, {
      ...REQUEST,
      json: { name: 'hypothesis', schema: LOOSE_SCHEMA },
    });
    expect(sent['response_format']).toEqual({
      type: 'json_schema',
      json_schema: { name: 'hypothesis', schema: LOOSE_SCHEMA },
    });
  });

  it('sends no reasoning effort to a model that does not reason', async () => {
    const { sent } = await call(
      mentorConfig('openai-gpt-6-luna', { model: 'gpt-4.1', label: 'GPT-4.1' }),
    );
    expect(sent).not.toHaveProperty('reasoning_effort');
  });
});

describe('Google Gemini', () => {
  it('sends a system message, max_tokens, the schema and the effort', async () => {
    const { sent, server } = await call(mentorConfig('gemini-flash-lite'));
    expect(server.requests[0]?.path).toBe('/v1beta/openai/chat/completions');
    expect(roles(sent)).toEqual(['system', 'user']);
    expect(sent['max_tokens']).toBe(4096);
    expect(sent['reasoning_effort']).toBe('medium');
    expect(sent['response_format']).toEqual({
      type: 'json_schema',
      json_schema: { name: 'hypothesis', schema: STRICT_SCHEMA },
    });
    expect(sent).not.toHaveProperty('prompt_cache_key');
  });
});

describe('OpenRouter', () => {
  const config = mentorConfig('meta-spark', {
    provider: 'openrouter',
    label: 'Nemotron',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'nvidia/nemotron-3.5-super-vl:free',
    pricing: { inputPerM: 0.3, cachedInputPerM: 0.03, outputPerM: 1.2 },
  });

  it('asks for the schema twice, caps the provider price and credits the app', async () => {
    const { sent, server } = await call(config);
    expect(sent['response_format']).toMatchObject({ type: 'json_schema' });
    expect(systemText(sent)).toContain('single code block marked json');
    expect(sent['reasoning']).toEqual({ effort: 'medium' });
    expect(sent).not.toHaveProperty('reasoning_effort');
    expect(sent['provider']).toEqual({ max_price: { prompt: 0.3, completion: 1.2 } });
    expect(server.requests[0]?.headers['x-title']).toBe('Architect');
    expect(server.requests[0]?.headers['http-referer']).toContain('github.com');
  });

  it('charges what OpenRouter reports the call cost, over the listed price', async () => {
    const { completion } = await call(config, undefined, {
      prompt_tokens: 1000,
      completion_tokens: 100,
      cost: 0.00042,
    });
    expect(completion.costUsd).toBe(0.00042);
  });

  it('holds a free model to free providers', async () => {
    const { sent } = await call({
      ...config,
      pricing: { inputPerM: 0, cachedInputPerM: 0, outputPerM: 0 },
    });
    expect(sent['provider']).toEqual({ max_price: { prompt: 0, completion: 0 } });
  });
});

describe('a model on this computer', () => {
  it('reaches Ollama at /v1 with no key, holds it to the schema, and costs nothing', async () => {
    const config = mentorConfig('meta-spark', {
      provider: 'ollama',
      label: 'Granite',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'granite4.2:8b',
      secretRef: undefined,
    });
    const { sent, server, completion } = await call(
      config,
      undefined,
      { prompt_tokens: 500, completion_tokens: 50 },
      REQUEST,
      null,
    );
    expect(server.requests[0]?.path).toBe('/v1/chat/completions');
    expect(server.requests[0]?.headers).not.toHaveProperty('authorization');
    expect(sent['response_format']).toMatchObject({ type: 'json_schema' });
    expect(sent).not.toHaveProperty('reasoning_effort');
    expect(completion.costUsd).toBe(0);
  });

  it('treats LM Studio the same way', async () => {
    const config = mentorConfig('meta-spark', {
      provider: 'lmstudio',
      label: 'Qwen',
      baseUrl: 'http://127.0.0.1:1234/v1',
      model: 'qwen3-8b',
      secretRef: undefined,
    });
    const { sent, server, completion } = await call(config, undefined, undefined, REQUEST, null);
    expect(server.requests[0]?.path).toBe('/v1/chat/completions');
    expect(sent['response_format']).toMatchObject({ type: 'json_schema' });
    expect(completion.costUsd).toBe(0);
  });
});

describe('other OpenAI-compatible hosts', () => {
  it('puts the schema in the prompt on Groq, which caps output with max_completion_tokens', async () => {
    const config = mentorConfig('meta-spark', {
      provider: 'groq',
      label: 'GPT-OSS 120B',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: 'openai/gpt-oss-120b',
      secretRef: 'groq',
    });
    const { sent, server, completion } = await call(config, '```json\n{"title":"Fix"}\n```');
    expect(server.requests[0]?.path).toBe('/openai/v1/chat/completions');
    expect(sent).not.toHaveProperty('response_format');
    expect(sent['max_completion_tokens']).toBe(4096);
    expect(systemText(sent)).toContain('"hypothesis"');
    expect(completion.json).toEqual({ title: 'Fix' });
    // No preset and no saved price: the cost is unknown.
    expect(completion.costUsd).toBeNull();
  });

  it('uses the price saved with an endpoint the user added', async () => {
    const config = mentorConfig('meta-spark', {
      provider: 'other',
      label: 'House model',
      baseUrl: 'https://llm.example.com/v1',
      model: 'house-model',
      secretRef: 'custom:llm.example.com',
      pricing: { inputPerM: 1, cachedInputPerM: 1, outputPerM: 2 },
    });
    const { completion } = await call(config, undefined, {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
    });
    expect(completion.costUsd).toBe(3);
  });
});

describe('the Meta default', () => {
  it('is unchanged: developer message, max_completion_tokens and the preset price', async () => {
    const { sent, completion } = await call(mentorConfig('meta-spark'), undefined, {
      prompt_tokens: 1_000_000,
      completion_tokens: 0,
    });
    expect(roles(sent)).toEqual(['developer', 'user']);
    expect(sent['max_completion_tokens']).toBe(4096);
    expect(sent).not.toHaveProperty('provider');
    expect(completion.costUsd).toBe(mentorPreset('meta-spark').pricing.inputPerM);
  });
});

describe('two calls with a repair', () => {
  it('prices each call at its own rates', async () => {
    let served = 0;
    const server: FakeServer = await startServer((_request, res) => {
      served += 1;
      sendEventStream(
        res,
        served === 1
          ? textReply('not json', { prompt_tokens: 90_000, completion_tokens: 10 })
          : textReply('{"title":"ok"}', { prompt_tokens: 90_100, completion_tokens: 10 }),
      );
    });
    const mentor = createModelMentor(
      mentorConfig('anthropic-haiku', {
        provider: 'other',
        baseUrl: 'https://llm.example.com/v1',
        model: 'priced-like-haiku',
        pricing: mentorPreset('anthropic-haiku').pricing,
      }),
      { apiKey: API_KEY, fetch: routeTo(server), retry: { maxAttempts: 1 } },
    );
    const completion = await mentor.complete(REQUEST);
    // Together the calls pass 100,000 input tokens, but each one alone stays at the lower rate.
    expect(completion.costUsd).toBeCloseTo((180_100 * 0.1 + 20 * 0.5) / 1e6, 10);
  });
});
