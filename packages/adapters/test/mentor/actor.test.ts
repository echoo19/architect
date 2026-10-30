import {
  AdapterError,
  DecodingSchema,
  mentorPreset,
  type StudentChatRequest,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createMentorActor } from '../../src/mentor/actor';
import { answer, deltaChunk, textReply, usageChunk } from '../helpers/chat';
import { mentorConfig } from '../helpers/configs';
import { routeTo, startServer, stopServers } from '../helpers/server';

afterEach(stopServers);

const API_KEY = 'LLM_test-key-0123456789';

const REQUEST: StudentChatRequest = {
  messages: [
    { role: 'system', content: 'You are the returns desk.' },
    { role: 'user', content: 'Record the return of order 1182.' },
  ],
  tools: [
    {
      name: 'read',
      description: 'Read a file.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  ],
  decoding: DecodingSchema.parse({ maxOutputTokens: 16_000 }),
  seed: 7,
};

describe('the mentor acting as the agent', () => {
  it("asks the mentor's provider with the student's tools, and hands the calls back", async () => {
    const server = await startServer((request, res) =>
      answer(request, res, [
        deltaChunk({
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call_a',
              type: 'function',
              function: { name: 'read', arguments: '{"path":"data/orders.csv"}' },
            },
          ],
        }),
        deltaChunk({}, 'tool_calls'),
        usageChunk({ prompt_tokens: 1000, completion_tokens: 200 }),
        '[DONE]',
      ]),
    );
    const actor = createMentorActor(mentorConfig('meta-spark'), {
      apiKey: API_KEY,
      fetch: routeTo(server),
    });
    const events = [];
    for await (const event of actor.chat(REQUEST)) events.push(event);

    expect(events).toEqual([
      {
        type: 'tool_call',
        call: { id: 'call_a', name: 'read', arguments: { path: 'data/orders.csv' } },
      },
      { type: 'done', usage: { inputTokens: 1000, outputTokens: 200 }, finish: 'tool_calls' },
    ]);
    const body = server.requests[0]?.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      model: mentorPreset('meta-spark').model,
      // Meta is asked for whole replies, since its stream can end without the usage.
      stream: false,
      max_completion_tokens: 16_000,
      reasoning_effort: 'medium',
      tools: [{ type: 'function', function: { name: 'read' } }],
    });
    expect((body.messages as { role: string }[])[0]?.role).toBe('developer');
    expect(body).not.toHaveProperty('seed');
    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(actor.estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0 })).toBeGreaterThan(0);
    expect(actor.isLocal).toBe(false);
    // Its window is far beyond a task's, so the agent loop makes no room for it.
    expect(actor.contextLength).toBeNull();
  });

  it('streams text like any student, and counts what the reply used', async () => {
    const server = await startServer((request, res) =>
      answer(request, res, textReply('ANSWER: {"refund_cents":4500}')),
    );
    const actor = createMentorActor(mentorConfig('meta-spark'), {
      apiKey: API_KEY,
      fetch: routeTo(server),
    });
    const events = [];
    for await (const event of actor.chat(REQUEST)) events.push(event);
    expect(events.at(-1)).toEqual({
      type: 'done',
      usage: { inputTokens: 10, outputTokens: 5 },
      finish: 'stop',
    });
  });

  it("refuses a mentor whose API it doesn't speak as an agent", () => {
    expect(() =>
      createMentorActor({ kind: 'coding_agent', agent: 'claude_code', label: 'Claude Code' }),
    ).toThrow(AdapterError);
  });
});
