import {
  AdapterError,
  costUsd,
  mentorPreset,
  type MentorAdapter,
  type MentorCompletionRequest,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createModelMentor, MentorReplyError } from '../../src/mentor/model-mentor';
import { mentorConfig } from '../helpers/configs';
import { textReply, type UsageBody } from '../helpers/chat';
import {
  openEventStream,
  routeTo,
  sendEventStream,
  sendJson,
  startServer,
  stopServers,
  type FakeServer,
  type Handler,
  type RecordedRequest,
} from '../helpers/server';

afterEach(stopServers);

const API_KEY = 'LLM_test-key-0123456789';
const SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
} as const;
const REQUEST: MentorCompletionRequest = {
  system: 'You are the mentor.',
  messages: [{ role: 'user', content: 'Diagnose.' }],
  maxOutputTokens: 4096,
};
const JSON_REQUEST: MentorCompletionRequest = {
  ...REQUEST,
  json: { name: 'hypothesis', schema: SCHEMA },
};

const delays: number[] = [];
const retry = {
  sleep: async (ms: number) => {
    delays.push(ms);
  },
  random: () => 0,
};

async function mentorOn(
  handler: Handler,
  key: Parameters<typeof mentorConfig>[0] = 'meta-spark',
  overrides: Parameters<typeof mentorConfig>[1] = {},
): Promise<{ mentor: MentorAdapter; server: FakeServer }> {
  delays.length = 0;
  const server = await startServer(handler);
  const mentor = createModelMentor(mentorConfig(key, overrides), {
    apiKey: API_KEY,
    fetch: routeTo(server),
    retry,
  });
  return { mentor, server };
}

/** Answers every request with the next reply in the list (the last one repeats). */
function replies(...streams: unknown[][]): Handler {
  let served = 0;
  return (_request, res) => {
    sendEventStream(res, streams[Math.min(served++, streams.length - 1)] ?? []);
  };
}

const reply = (text: string, usage?: UsageBody | null) => textReply(text, usage);
const body = (request: RecordedRequest | undefined) => request?.json() ?? {};

async function failure(promise: Promise<unknown>): Promise<AdapterError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AdapterError);
  return error as AdapterError;
}

describe('the Meta request', () => {
  it('is a streamed chat completion with a developer message and Meta’s token field', async () => {
    const { mentor, server } = await mentorOn(replies(reply('ok')));
    await mentor.complete(REQUEST);

    const [request] = server.requests;
    expect(request?.method).toBe('POST');
    expect(request?.path).toBe('/v1/chat/completions');
    expect(request?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request?.headers.accept).toBe('text/event-stream');
    expect(body(request)).toMatchObject({
      model: mentorPreset('meta-spark').model,
      messages: [
        { role: 'developer', content: 'You are the mentor.' },
        { role: 'user', content: 'Diagnose.' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      reasoning_effort: 'medium',
      max_completion_tokens: 4096,
    });
    expect(body(request)).not.toHaveProperty('max_tokens');
  });

  it('never sends the parameters Meta rejects or that it ignores', async () => {
    const { mentor, server } = await mentorOn(replies(reply('{"title":"x"}')));
    await mentor.complete({ ...JSON_REQUEST, reasoningEffort: 'high' });
    const sent = body(server.requests[0]);
    for (const key of [
      'tool_choice',
      'stop',
      'n',
      'logprobs',
      'top_p',
      'temperature',
      'seed',
      'logit_bias',
      'frequency_penalty',
      'presence_penalty',
      'max_output_tokens',
    ]) {
      expect(sent, key).not.toHaveProperty(key);
    }
    expect(sent['reasoning_effort']).not.toBe('none');
  });

  it('takes the reasoning effort from the request, else from the config', async () => {
    const { mentor, server } = await mentorOn(replies(reply('ok')), 'meta-spark', {
      reasoningEffort: 'low',
    });
    await mentor.complete(REQUEST);
    await mentor.complete({ ...REQUEST, reasoningEffort: 'high' });
    expect(body(server.requests[0])['reasoning_effort']).toBe('low');
    expect(body(server.requests[1])['reasoning_effort']).toBe('high');
  });

  it('asks for structured output with a JSON schema and keeps the prompt as written', async () => {
    const { mentor, server } = await mentorOn(replies(reply('{"title":"Fix"}')));
    await mentor.complete(JSON_REQUEST);

    const sent = body(server.requests[0]);
    expect(sent['response_format']).toEqual({
      type: 'json_schema',
      json_schema: { name: 'hypothesis', schema: SCHEMA },
    });
    expect(sent['messages']).toEqual([
      { role: 'developer', content: 'You are the mentor.' },
      { role: 'user', content: 'Diagnose.' },
    ]);
  });

  it('sends no response format when no JSON was asked for', async () => {
    const { mentor, server } = await mentorOn(replies(reply('plain text')));
    await mentor.complete(REQUEST);
    expect(body(server.requests[0])).not.toHaveProperty('response_format');
  });

  it('sends one stable cache key for all of a job’s calls, and can be told which', async () => {
    const { mentor, server } = await mentorOn(replies(reply('ok')));
    await mentor.complete(REQUEST);
    await mentor.complete(REQUEST);
    const keys = server.requests.map((request) => body(request)['prompt_cache_key']);
    expect(typeof keys[0]).toBe('string');
    expect(keys[1]).toBe(keys[0]);

    const named = await startServer(replies(reply('ok')));
    await createModelMentor(mentorConfig('meta-spark'), {
      apiKey: API_KEY,
      fetch: routeTo(named),
      sessionKey: 'job-123',
    }).complete(REQUEST);
    expect(body(named.requests[0])['prompt_cache_key']).toBe('job-123');
  });
});

describe('the Spark Open requests', () => {
  it.each(['baseten-spark-open', 'modal-spark-open'] as const)(
    'puts the schema in the prompt on %s instead of sending response_format',
    async (key) => {
      const { mentor, server } = await mentorOn(
        replies(reply('```json\n{"title":"Fix"}\n```')),
        key,
      );
      const completion = await mentor.complete(JSON_REQUEST);

      const sent = body(server.requests[0]);
      expect(sent).not.toHaveProperty('response_format');
      const messages = sent['messages'] as { role: string; content: string }[];
      expect(messages[0]?.role).toBe('system');
      expect(messages[0]?.content).toContain('You are the mentor.');
      expect(messages[0]?.content).toContain('"hypothesis"');
      expect(messages[0]?.content).toContain('single code block marked json');
      expect(messages[0]?.content).toContain(JSON.stringify(SCHEMA, null, 2));
      expect(completion.json).toEqual({ title: 'Fix' });
    },
  );

  it('uses max_tokens, always sets it, and sends no Meta-only fields', async () => {
    const { mentor, server } = await mentorOn(replies(reply('ok')), 'baseten-spark-open');
    await mentor.complete({ ...REQUEST, maxOutputTokens: 777 });
    const sent = body(server.requests[0]);
    expect(sent['max_tokens']).toBe(777);
    expect(sent).not.toHaveProperty('max_completion_tokens');
    expect(sent).not.toHaveProperty('prompt_cache_key');
    expect(sent['reasoning_effort']).toBe('medium');
    expect(sent['stream']).toBe(true);
    expect(sent).not.toHaveProperty('n');
    expect(sent).not.toHaveProperty('seed');
    expect(sent).not.toHaveProperty('temperature');
  });

  it('keeps one Modal conversation on one container with an affinity key', async () => {
    const { mentor, server } = await mentorOn(replies(reply('ok')), 'modal-spark-open');
    await mentor.complete(REQUEST);
    await mentor.complete(REQUEST);
    const keys = server.requests.map((request) => request.headers['modal-routing-affinity-key']);
    expect(keys[0]).toMatch(/^architect-/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('sends no affinity key to hosts that do not use one', async () => {
    const { mentor, server } = await mentorOn(replies(reply('ok')), 'baseten-spark-open');
    await mentor.complete(REQUEST);
    expect(server.requests[0]?.headers).not.toHaveProperty('modal-routing-affinity-key');
  });

  it('treats an unknown provider like Spark Open: system message, max_tokens, schema in the prompt', async () => {
    const { mentor, server } = await mentorOn(replies(reply('{"title":"x"}')), 'meta-spark', {
      provider: 'other',
      baseUrl: 'https://llm.example.com/v1',
      model: 'house-model',
    });
    await mentor.complete(JSON_REQUEST);
    const sent = body(server.requests[0]);
    expect(sent).not.toHaveProperty('response_format');
    expect(sent['max_tokens']).toBe(4096);
    expect((sent['messages'] as { role: string }[])[0]?.role).toBe('system');
  });
});

describe('results', () => {
  it('returns the text, usage, cost, model and latency', async () => {
    const { mentor } = await mentorOn(
      replies(reply('Here is the diagnosis.', { prompt_tokens: 100, completion_tokens: 40 })),
    );
    const completion = await mentor.complete(REQUEST);

    expect(completion.text).toBe('Here is the diagnosis.');
    expect(completion.usage).toEqual({ inputTokens: 100, outputTokens: 40 });
    expect(completion.model).toBe(mentorPreset('meta-spark').model);
    expect(completion.latencyMs).toBeGreaterThanOrEqual(0);
    expect(completion).not.toHaveProperty('json');
  });

  it('prices cached input at the cached rate and counts reasoning as output', async () => {
    const usage: UsageBody = {
      prompt_tokens: 1000,
      completion_tokens: 500,
      prompt_tokens_details: { cached_tokens: 400 },
      completion_tokens_details: { reasoning_tokens: 200 },
    };
    const { mentor } = await mentorOn(replies(reply('ok', usage)));
    const completion = await mentor.complete(REQUEST);

    expect(completion.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      reasoningTokens: 200,
      cachedInputTokens: 400,
    });
    // 600 fresh input at $1.25, 400 cached at $0.15, 500 output at $4.25, per million.
    expect(completion.costUsd).toBeCloseTo((600 * 1.25 + 400 * 0.15 + 500 * 4.25) / 1e6, 10);
    expect(completion.costUsd).toBe(costUsd(mentorPreset('meta-spark').pricing, completion.usage));
    expect(mentor.estimateCostUsd(completion.usage)).toBe(completion.costUsd);
  });

  it('uses the price of the tier named in the model id', async () => {
    const { mentor } = await mentorOn(
      replies(reply('ok', { prompt_tokens: 1000, completion_tokens: 500 })),
      'meta-spark-contributor',
    );
    const completion = await mentor.complete(REQUEST);
    expect(completion.costUsd).toBeCloseTo((1000 * 0.1 + 500 * 0.2) / 1e6, 10);
  });

  it('prefers a price passed in over the preset’s', async () => {
    const server = await startServer(
      replies(reply('ok', { prompt_tokens: 1_000_000, completion_tokens: 0 })),
    );
    const mentor = createModelMentor(mentorConfig('meta-spark'), {
      apiKey: API_KEY,
      fetch: routeTo(server),
      pricing: { inputPerM: 2, cachedInputPerM: 1, outputPerM: 3 },
    });
    expect((await mentor.complete(REQUEST)).costUsd).toBe(2);
  });

  it('reports no cost for a model whose price is unknown', async () => {
    const { mentor } = await mentorOn(replies(reply('ok')), 'meta-spark', {
      provider: 'other',
      baseUrl: 'https://llm.example.com/v1',
      model: 'house-model',
    });
    const completion = await mentor.complete(REQUEST);
    expect(completion.costUsd).toBeNull();
    expect(mentor.estimateCostUsd(completion.usage)).toBeNull();
  });

  it('describes itself', async () => {
    const { mentor } = await mentorOn(replies(reply('ok')), 'baseten-spark-open');
    expect(mentor).toMatchObject({
      kind: 'model',
      provider: 'baseten',
      model: mentorPreset('baseten-spark-open').model,
      label: mentorPreset('baseten-spark-open').label,
    });
  });

  it('refuses a reply that comes without token usage, since its cost could not be counted', async () => {
    const { mentor, server } = await mentorOn(replies(reply('ok', null)));
    const error = await failure(mentor.complete(REQUEST));
    expect(error.code).toBe('bad_response');
    expect(error.message).toContain('token usage');
    expect(server.requests).toHaveLength(1);
  });
});

describe('JSON replies', () => {
  it('parses the reply and returns it next to the raw text', async () => {
    const { mentor, server } = await mentorOn(replies(reply('{"title":"Round up"}')));
    const completion = await mentor.complete(JSON_REQUEST);
    expect(completion.json).toEqual({ title: 'Round up' });
    expect(completion.text).toBe('{"title":"Round up"}');
    expect(server.requests).toHaveLength(1);
  });

  it('strips fences and prose around the object', async () => {
    const { mentor } = await mentorOn(
      replies(reply('Sure!\n```json\n{"title":"Fenced"}\n```\nDone.')),
      'baseten-spark-open',
    );
    expect((await mentor.complete(JSON_REQUEST)).json).toEqual({ title: 'Fenced' });
  });

  it('makes one repair call that shows the bad reply and the parse error', async () => {
    const first = reply('{"title": "Oops",}', { prompt_tokens: 100, completion_tokens: 30 });
    const second = reply('{"title":"Fixed"}', { prompt_tokens: 160, completion_tokens: 20 });
    const { mentor, server } = await mentorOn(replies(first, second));

    const completion = await mentor.complete(JSON_REQUEST);

    expect(server.requests).toHaveLength(2);
    const repair = body(server.requests[1])['messages'] as { role: string; content: string }[];
    expect(repair.map((message) => message.role)).toEqual([
      'developer',
      'user',
      'assistant',
      'user',
    ]);
    expect(repair[2]?.content).toBe('{"title": "Oops",}');
    expect(repair[3]?.content).toContain('That reply could not be used:');
    expect(repair[3]?.content).toContain('JSON');
    expect(completion.json).toEqual({ title: 'Fixed' });
    expect(completion.text).toBe('{"title":"Fixed"}');
    // Both calls are paid for, so both are counted.
    expect(completion.usage).toMatchObject({ inputTokens: 260, outputTokens: 50 });
    expect(completion.costUsd).toBeCloseTo((260 * 1.25 + 50 * 4.25) / 1e6, 10);
  });

  it('asks for a fenced block again on hosts without structured output', async () => {
    const { mentor, server } = await mentorOn(
      replies(reply('no json here'), reply('```json\n{"title":"ok"}\n```')),
      'baseten-spark-open',
    );
    await mentor.complete(JSON_REQUEST);
    const repair = body(server.requests[1])['messages'] as { content: string }[];
    expect(repair.at(-1)?.content).toContain('in a single code block marked json');
  });

  it('gives up after the one repair, with bad_response and the spend attached', async () => {
    const bad = reply('still not json', { prompt_tokens: 50, completion_tokens: 10 });
    const { mentor, server } = await mentorOn(replies(bad));

    const error = await failure(mentor.complete(JSON_REQUEST));

    expect(server.requests).toHaveLength(2);
    expect(error.code).toBe('bad_response');
    expect(error).toBeInstanceOf(MentorReplyError);
    expect(error.message).toContain('not valid JSON, even after one correction');
    const { usage, costUsd: cost } = error as MentorReplyError;
    expect(usage).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(cost).toBeCloseTo((100 * 1.25 + 20 * 4.25) / 1e6, 10);
  });

  it('says so when the reply was cut off by the output limit', async () => {
    const cut = textReply('{"title":"half', undefined, 'length');
    const { mentor } = await mentorOn(replies(cut));
    const error = await failure(mentor.complete(JSON_REQUEST));
    expect(error.message).toContain('cut off at the output limit');
  });

  it('corrects an empty reply without echoing the empty assistant turn', async () => {
    const { mentor, server } = await mentorOn(
      replies(textReply('', undefined, 'length'), reply('{"title":"ok"}')),
    );
    const completion = await mentor.complete(JSON_REQUEST);
    expect(completion.json).toEqual({ title: 'ok' });
    const repair = body(server.requests[1])['messages'] as { role: string }[];
    expect(repair.map((message) => message.role)).toEqual(['developer', 'user', 'user']);
  });
});

describe('plain replies', () => {
  it('raises an error with the spend when the model used its whole limit thinking', async () => {
    const { mentor } = await mentorOn(
      replies(textReply('', { prompt_tokens: 30, completion_tokens: 4096 }, 'length')),
    );
    const error = await failure(mentor.complete(REQUEST));
    expect(error.message).toContain('whole output limit on reasoning');
    expect((error as MentorReplyError).usage).toEqual({ inputTokens: 30, outputTokens: 4096 });
  });

  it('raises an error for an empty reply', async () => {
    const { mentor } = await mentorOn(replies(reply('   ')));
    expect((await failure(mentor.complete(REQUEST))).message).toBe(
      'The mentor sent an empty reply.',
    );
  });
});

describe('retries and failures', () => {
  it('retries a 429 that asks for a wait, then a 503, then succeeds', async () => {
    let served = 0;
    const { mentor, server } = await mentorOn((_request, res) => {
      served += 1;
      if (served === 1) {
        sendJson(res, 429, { error: { message: 'slow down' } }, { 'retry-after': '3' });
      } else if (served === 2) {
        sendJson(res, 503, { error: { message: 'overloaded' } });
      } else {
        sendEventStream(res, reply('finally'));
      }
    });

    const completion = await mentor.complete(REQUEST);

    expect(completion.text).toBe('finally');
    expect(server.requests).toHaveLength(3);
    expect(delays).toEqual([3000, 1000]);
  });

  it.each([400, 401, 402, 403, 404])('does not retry HTTP %i', async (status) => {
    const { mentor, server } = await mentorOn((_request, res) =>
      sendJson(res, status, { error: { message: 'no' } }),
    );
    await failure(mentor.complete(REQUEST));
    expect(server.requests).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('tells the person to check the key in Settings on a 401', async () => {
    const { mentor } = await mentorOn((_request, res) => sendJson(res, 401, { error: 'no' }));
    const error = await failure(mentor.complete(REQUEST));
    expect(error.code).toBe('auth');
    expect(error.message).toBe(
      "Meta didn't accept the API key (HTTP 401). Check the key in Settings.",
    );
  });

  it('names the model on a 404', async () => {
    const { mentor } = await mentorOn((_request, res) => sendJson(res, 404, { error: 'no' }));
    const error = await failure(mentor.complete(REQUEST));
    expect(error.code).toBe('not_found');
    expect(error.message).toContain(mentorPreset('meta-spark').model);
  });

  it('repeats the whole call when the stream dies part-way with a retryable error', async () => {
    let served = 0;
    const { mentor, server } = await mentorOn((_request, res) => {
      served += 1;
      if (served === 1) {
        openEventStream(res);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'par' } }] })}\n\n`);
        res.end(
          `data: ${JSON.stringify({ error: { message: 'overloaded', type: 'server_error' } })}\n\n`,
        );
      } else {
        sendEventStream(res, reply('whole'));
      }
    });
    const completion = await mentor.complete(REQUEST);
    expect(completion.text).toBe('whole');
    expect(server.requests).toHaveLength(2);
  });

  it('stops at the signal, mid-stream', async () => {
    const { mentor } = await mentorOn((_request, res) => {
      openEventStream(res);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'thinking' } }] })}\n\n`);
    });
    const controller = new AbortController();
    const pending = mentor.complete(REQUEST, controller.signal);
    setTimeout(() => controller.abort(), 60);
    const error = await failure(pending);
    expect(error.code).toBe('aborted');
  });
});

describe('testConnection', () => {
  const listing =
    (...ids: string[]): Handler =>
    (_request, res) =>
      sendJson(res, 200, { object: 'list', data: ids.map((id) => ({ id })) });

  it('confirms the configured model is in the list', async () => {
    const { mentor, server } = await mentorOn(
      listing('other-model-a', mentorPreset('meta-spark').model),
    );
    const result = await mentor.testConnection();
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.detail).toBe(
      `Connected to Meta. ${mentorPreset('meta-spark').model} is available.`,
    );
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/v1/models' });
  });

  it('says what is wrong when the account does not offer the model', async () => {
    const { mentor } = await mentorOn(listing('other-model-a', 'other-model-b'));
    const result = await mentor.testConnection();
    expect(result).toEqual({
      ok: false,
      error: `Meta accepted the key but doesn't offer "${mentorPreset('meta-spark').model}".`,
      hint: 'It offers other-model-a, other-model-b.',
    });
  });

  it('suggests the public id when only the dated snapshot id is missing', async () => {
    const undated = mentorPreset('baseten-spark-open').model.replace(/-\d+$/, '');
    const { mentor } = await mentorOn(listing(undated), 'baseten-spark-open');
    const result = await mentor.testConnection();
    expect(result).toMatchObject({
      ok: false,
      hint: `It lists "${undated}" instead. Try that id.`,
    });
  });

  it('turns a rejected key into a message with the next step', async () => {
    const { mentor } = await mentorOn((_request, res) => sendJson(res, 401, { error: 'no' }));
    expect(await mentor.testConnection()).toEqual({
      ok: false,
      error: "Meta didn't accept the API key (HTTP 401).",
      hint: 'Check the key in Settings.',
    });
  });

  it('asks for a few tokens when the host has no model list', async () => {
    const { mentor, server } = await mentorOn((request, res) => {
      if (request.method === 'GET') sendJson(res, 404, {});
      else sendEventStream(res, reply('ready'));
    }, 'modal-spark-open');

    const result = await mentor.testConnection();

    expect(result).toMatchObject({ ok: true });
    expect(server.requests.map((request) => request.method)).toEqual(['GET', 'POST']);
    expect(body(server.requests[1])['max_tokens']).toBe(64);
  });

  it('does not retry while testing', async () => {
    const { mentor, server } = await mentorOn((request, res) => {
      if (request.method === 'GET') sendJson(res, 404, {});
      else sendJson(res, 503, { error: 'busy' });
    });
    const result = await mentor.testConnection();
    expect(result).toMatchObject({ ok: false });
    expect(server.requests).toHaveLength(2);
    expect(delays).toEqual([]);
  });

  it('reports a server that is not there', async () => {
    const { mentor } = await mentorOn(listing());
    await stopServers();
    const result = await mentor.testConnection();
    expect(result).toMatchObject({ ok: false, error: "Couldn't connect to Meta." });
  });
});
