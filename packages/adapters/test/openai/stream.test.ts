import { AdapterError } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { readChatCompletionStream, type ChatStreamEvent } from '../../src/openai/stream';
import { deltaChunk, eventBytes, inPieces, textReply, usageChunk } from '../helpers/chat';

async function read(
  payloads: unknown[],
  options: { firstCallNumber?: number; pieceSize?: number } = {},
): Promise<ChatStreamEvent[]> {
  const bytes = eventBytes(payloads);
  const events: ChatStreamEvent[] = [];
  const stream = readChatCompletionStream(inPieces(bytes, options.pieceSize), {
    service: 'Testhost',
    firstCallNumber: options.firstCallNumber,
  });
  for await (const event of stream) events.push(event);
  return events;
}

async function failure(payloads: unknown[]): Promise<AdapterError> {
  const error = await read(payloads).then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AdapterError);
  return error as AdapterError;
}

function text(events: ChatStreamEvent[]): string {
  return events.flatMap((event) => (event.type === 'text' ? [event.delta] : [])).join('');
}

function end(events: ChatStreamEvent[]): Extract<ChatStreamEvent, { type: 'end' }> {
  const last = events.at(-1);
  if (last?.type !== 'end') throw new Error('stream did not end with an end event');
  return last;
}

/** The fragments a server sends for one call: id and name first, then pieces of the arguments. */
const callStart = (index: number, id: string, name: string) =>
  deltaChunk({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: '' } }] });
const callArgs = (index: number, fragment: string) =>
  deltaChunk({ tool_calls: [{ index, function: { arguments: fragment } }] });

describe('text', () => {
  it('streams text deltas in order and ends with the finish reason', async () => {
    const events = await read(textReply(['Hel', 'lo', ' world']));
    expect(events.filter((event) => event.type === 'text')).toHaveLength(3);
    expect(text(events)).toBe('Hello world');
    expect(end(events)).toMatchObject({ finish: 'stop', toolCalls: [] });
  });

  it('gives the same result however the bytes are cut', async () => {
    const payloads = textReply(['héllo ', '😀', ' done'], {
      prompt_tokens: 3,
      completion_tokens: 4,
    });
    const whole = await read(payloads);
    for (const pieceSize of [1, 2, 3, 7, 50]) {
      expect(await read(payloads, { pieceSize }), `pieces of ${pieceSize}`).toEqual(whole);
    }
    expect(text(whole)).toBe('héllo 😀 done');
  });

  it('ignores keep-alive comments and chunks with no choices', async () => {
    const bytes = new TextEncoder().encode(
      ': ping\n\ndata: {"choices":[]}\n\ndata: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    );
    const events: ChatStreamEvent[] = [];
    for await (const event of readChatCompletionStream(inPieces(bytes), { service: 'Testhost' })) {
      events.push(event);
    }
    expect(text(events)).toBe('hi');
  });

  it('reports length when the reply was cut off', async () => {
    const events = await read(textReply('partial', undefined, 'length'));
    expect(end(events).finish).toBe('length');
  });

  it('treats an unfamiliar finish reason as an ordinary stop', async () => {
    expect(end(await read(textReply('x', undefined, 'end_turn'))).finish).toBe('stop');
  });

  it('accepts a stream that ends without [DONE] once it has finished', async () => {
    const payloads = textReply('ok').slice(0, -1);
    expect(end(await read(payloads)).finish).toBe('stop');
  });
});

describe('usage', () => {
  it('maps prompt, completion, reasoning and cached tokens', async () => {
    const events = await read(
      textReply('ok', {
        prompt_tokens: 542,
        completion_tokens: 243,
        prompt_tokens_details: { cached_tokens: 128 },
        completion_tokens_details: { reasoning_tokens: 173 },
      }),
    );
    expect(end(events).usage).toEqual({
      inputTokens: 542,
      outputTokens: 243,
      reasoningTokens: 173,
      cachedInputTokens: 128,
    });
  });

  it('leaves out counts the server did not report', async () => {
    const usage = end(
      await read(textReply('ok', { prompt_tokens: 7, completion_tokens: 2 })),
    ).usage;
    expect(usage).toEqual({ inputTokens: 7, outputTokens: 2 });
    expect(usage).not.toHaveProperty('reasoningTokens');
    expect(usage).not.toHaveProperty('cachedInputTokens');
  });

  it('treats null detail counts as absent', async () => {
    const usage = end(
      await read(
        textReply('ok', {
          prompt_tokens: 7,
          completion_tokens: 2,
          prompt_tokens_details: { cached_tokens: null },
          completion_tokens_details: null,
        }),
      ),
    ).usage;
    expect(usage).toEqual({ inputTokens: 7, outputTokens: 2 });
  });

  it('takes the last usage when the server repeats it on every chunk', async () => {
    const events = await read([
      { choices: [{ delta: { content: 'a' } }], usage: { prompt_tokens: 5, completion_tokens: 1 } },
      {
        choices: [{ delta: { content: 'b' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      },
      '[DONE]',
    ]);
    expect(end(events).usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it('is absent when the server sends none', async () => {
    expect(end(await read(textReply('ok', null))).usage).toBeUndefined();
  });

  it('counts reasoning deltas in either field, never shows them, and defers to the server count', async () => {
    const payloads = [
      deltaChunk({ reasoning_content: 'thinking' }),
      deltaChunk({ reasoning: ' more' }),
      deltaChunk({ reasoning_content: '' }),
      deltaChunk({ content: 'Answer' }),
      deltaChunk({}, 'stop'),
    ];
    const counted = await read([
      ...payloads,
      usageChunk({ prompt_tokens: 4, completion_tokens: 9 }),
    ]);
    expect(text(counted)).toBe('Answer');
    expect(end(counted).usage?.reasoningTokens).toBe(2);

    const reported = await read([
      ...payloads,
      usageChunk({
        prompt_tokens: 4,
        completion_tokens: 9,
        completion_tokens_details: { reasoning_tokens: 6 },
      }),
    ]);
    expect(end(reported).usage?.reasoningTokens).toBe(6);
  });
});

describe('tool calls', () => {
  it('assembles a call from its fragments and parses the arguments', async () => {
    const events = await read([
      callStart(0, 'call_abc', 'read_table'),
      callArgs(0, '{"name":"inv'),
      callArgs(0, 'oices.csv","limit":'),
      callArgs(0, '5}'),
      deltaChunk({}, 'tool_calls'),
      usageChunk({ prompt_tokens: 20, completion_tokens: 12 }),
      '[DONE]',
    ]);
    expect(end(events)).toMatchObject({
      finish: 'tool_calls',
      toolCalls: [
        { id: 'call_abc', name: 'read_table', arguments: { name: 'invoices.csv', limit: 5 } },
      ],
    });
  });

  it('keeps parallel calls apart by index, in index order', async () => {
    const events = await read([
      callStart(1, 'call_b', 'calculate'),
      callStart(0, 'call_a', 'read_table'),
      callArgs(1, '{"expression":'),
      callArgs(0, '{"name":"a.csv"}'),
      callArgs(1, '"1+1"}'),
      deltaChunk({}, 'tool_calls'),
    ]);
    expect(end(events).toolCalls).toEqual([
      { id: 'call_a', name: 'read_table', arguments: { name: 'a.csv' } },
      { id: 'call_b', name: 'calculate', arguments: { expression: '1+1' } },
    ]);
  });

  it('works when the fragments are cut mid-token', async () => {
    const payloads = [
      callStart(0, 'c1', 'f'),
      callArgs(0, '{"a":"é😀"}'),
      deltaChunk({}, 'tool_calls'),
    ];
    const whole = await read(payloads);
    expect(await read(payloads, { pieceSize: 1 })).toEqual(whole);
    expect(end(whole).toolCalls[0]?.arguments).toEqual({ a: 'é😀' });
  });

  it('reports tool_calls even when the server says stop', async () => {
    const events = await read([callStart(0, 'c1', 'f'), callArgs(0, '{}'), deltaChunk({}, 'stop')]);
    expect(end(events).finish).toBe('tool_calls');
  });

  it('keeps length when the reply ran out of room', async () => {
    const events = await read([
      callStart(0, 'c1', 'f'),
      callArgs(0, '{}'),
      deltaChunk({}, 'length'),
    ]);
    expect(end(events).finish).toBe('length');
  });

  it('numbers calls that arrive without an id by their place in the transcript', async () => {
    const noId = (index: number, name: string) =>
      deltaChunk({ tool_calls: [{ index, function: { name, arguments: '{}' } }] });
    const events = await read([noId(0, 'one'), noId(1, 'two'), deltaChunk({}, 'tool_calls')], {
      firstCallNumber: 4,
    });
    expect(end(events).toolCalls.map((call) => call.id)).toEqual(['call_4', 'call_5']);
  });

  it('copes with a server that omits the index', async () => {
    const events = await read([
      deltaChunk({ tool_calls: [{ id: 'a', function: { name: 'one', arguments: '{"x":' } }] }),
      deltaChunk({ tool_calls: [{ function: { arguments: '1}' } }] }),
      deltaChunk({ tool_calls: [{ id: 'b', function: { name: 'two', arguments: '{}' } }] }),
      deltaChunk({}, 'tool_calls'),
    ]);
    expect(end(events).toolCalls).toEqual([
      { id: 'a', name: 'one', arguments: { x: 1 } },
      { id: 'b', name: 'two', arguments: {} },
    ]);
  });

  it('does not repeat a name or id that the server sends on every fragment', async () => {
    const whole = (fragment: string) =>
      deltaChunk({
        tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_table', arguments: fragment } }],
      });
    const events = await read([whole('{"a":'), whole('1}'), deltaChunk({}, 'tool_calls')]);
    expect(end(events).toolCalls).toEqual([{ id: 'c1', name: 'read_table', arguments: { a: 1 } }]);
  });

  it('treats empty arguments as no arguments', async () => {
    const events = await read([callStart(0, 'c1', 'list_files'), deltaChunk({}, 'tool_calls')]);
    expect(end(events).toolCalls[0]?.arguments).toEqual({});
  });

  it('interleaves text before a call without mixing the two', async () => {
    const events = await read([
      deltaChunk({ content: 'Let me look.' }),
      callStart(0, 'c1', 'list_files'),
      callArgs(0, '{}'),
      deltaChunk({}, 'tool_calls'),
    ]);
    expect(text(events)).toBe('Let me look.');
    expect(end(events).toolCalls).toHaveLength(1);
  });

  it('rejects arguments that are not valid JSON, naming the tool', async () => {
    const error = await failure([
      callStart(0, 'c1', 'read_table'),
      callArgs(0, '{"name": '),
      deltaChunk({}, 'tool_calls'),
    ]);
    expect(error.code).toBe('bad_response');
    expect(error.message).toContain('"read_table"');
    expect(error.message).toContain("aren't valid JSON");
  });

  it('rejects arguments that are JSON but not an object', async () => {
    const error = await failure([
      callStart(0, 'c1', 'read_table'),
      callArgs(0, '[1,2]'),
      deltaChunk({}, 'tool_calls'),
    ]);
    expect(error.code).toBe('bad_response');
    expect(error.message).toContain("aren't a JSON object");
  });

  it('rejects a call that never got a name', async () => {
    const error = await failure([callArgs(0, '{}'), deltaChunk({}, 'tool_calls')]);
    expect(error.message).toContain('without a name');
  });
});

describe('failures', () => {
  it('raises "blocked" when the content filter stops the reply', async () => {
    const error = await failure(textReply('', undefined, 'content_filter'));
    expect(error.code).toBe('blocked');
    expect(error.retryable).toBe(false);
  });

  it('treats a stream that stops without finishing as a dropped connection', async () => {
    const error = await failure([deltaChunk({ content: 'half a sent' })]);
    expect(error.code).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('closed the connection before the reply was finished');
  });

  it('reports a body with no events as not a stream', async () => {
    const error = await failure(['[DONE]']);
    expect(error.code).toBe('bad_response');
  });

  it('reports a chunk that is not JSON, or has the wrong shape, as a bad response', async () => {
    const notJson = await read(['{oops', '[DONE]']).catch((reason: unknown) => reason);
    expect((notJson as AdapterError).code).toBe('bad_response');
    const wrongShape = await failure([{ choices: 'many' }]);
    expect(wrongShape.code).toBe('bad_response');
  });

  it.each([
    [{ message: 'Slow down', type: 'rate_limit_error' }, 'rate_limit', true],
    [{ message: 'Bad key', code: 'invalid_api_key' }, 'auth', false],
    [{ message: 'Out of credit', type: 'insufficient_quota' }, 'quota', false],
    [{ message: 'Too long', code: 'context_length_exceeded' }, 'bad_request', false],
    [{ message: 'Overloaded', type: 'server_error' }, 'server', true],
  ] as const)('maps an error event %j to %s', async (error, code, retryable) => {
    const raised = await failure([deltaChunk({ content: 'start' }), { error }]);
    expect(raised.code).toBe(code);
    expect(raised.retryable).toBe(retryable);
  });

  it('quotes the message of an error event', async () => {
    const raised = await failure([
      { error: { message: 'The model is overloaded', type: 'server_error' } },
    ]);
    expect(raised.message).toContain('The model is overloaded.');
  });
});
