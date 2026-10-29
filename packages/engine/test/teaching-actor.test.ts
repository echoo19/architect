import {
  AdapterError,
  DecodingSchema,
  type ActorAdapter,
  type StudentChatRequest,
  type StudentStreamEvent,
  type Usage,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { MentorGate } from '../src/mentor/gate';
import { gatedActor } from '../src/teaching/actor';

const price = (usage: Usage) => (usage.inputTokens + 4 * usage.outputTokens) / 1_000_000;

function actorOf(stream: () => AsyncGenerator<StudentStreamEvent>): ActorAdapter {
  return {
    label: 'Spark',
    model: 'spark-test',
    baseUrl: 'https://api.example.com/v1',
    isLocal: false,
    contextLength: null,
    chat: () => stream(),
    describe: async () => ({ model: 'spark-test' }),
    testConnection: async () => ({ ok: true, latencyMs: 1, detail: 'test' }),
    release: async () => {},
    estimateCostUsd: price,
  };
}

const request: StudentChatRequest = {
  messages: [{ role: 'user', content: 'Process the return.' }],
  tools: [],
  decoding: DecodingSchema.parse({}),
  seed: 1,
};

/** The charges one call of `stream` makes, and what the call threw, if anything. */
async function charged(stream: () => AsyncGenerator<StudentStreamEvent>) {
  let authorized = 0;
  const gate = new MentorGate({
    leakDetector: { scan: () => ({ leaked: false, matchedIds: [] }) },
    authorize: (maxUsd) => (authorized = maxUsd ?? 0),
    onRefusal: () => {},
  });
  const charges: { usd: number; usage: Usage }[] = [];
  const actor = gatedActor(actorOf(stream), gate, {
    onCharge: (charge) => charges.push({ usd: charge.costUsd, usage: charge.usage }),
  });
  let error: unknown = null;
  try {
    for await (const _event of actor.chat(request)) {
      // Each event passes through; the charge is what matters here.
    }
  } catch (caught) {
    error = caught;
  }
  return { charges, error, authorized };
}

describe('the mentor acting as the agent is charged', () => {
  it('by the usage its reply reports', async () => {
    const usage = { inputTokens: 1000, outputTokens: 200 };
    const { charges } = await charged(async function* () {
      yield { type: 'text', delta: 'ANSWER: {}' };
      yield { type: 'done', usage, finish: 'stop' };
    });
    expect(charges).toEqual([{ usd: price(usage), usage }]);
  });

  it('the most it was allowed when the stream broke off before saying what it used', async () => {
    const { charges, error, authorized } = await charged(async function* () {
      yield { type: 'text', delta: 'Reading' };
      throw new AdapterError('bad_request', "The tool call's arguments weren't JSON.");
    });
    expect(error).toBeInstanceOf(AdapterError);
    expect(authorized).toBeGreaterThan(0);
    expect(charges).toEqual([{ usd: authorized, usage: { inputTokens: 0, outputTokens: 0 } }]);
  });

  it('the most it was allowed when the reply reported no usage at all', async () => {
    const { charges, authorized } = await charged(async function* () {
      yield { type: 'text', delta: 'ANSWER: {}' };
      yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, finish: 'stop' };
    });
    expect(charges.map((charge) => charge.usd)).toEqual([authorized]);
  });
});
