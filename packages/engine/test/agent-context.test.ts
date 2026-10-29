import { skillFiles } from '@architect/harness';
import type { ChatMessage, Harness, StudentChatRequest } from '@architect/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runAgent } from '../src/agent/loop';
import { contextBudget } from '../src/agent/context';
import { renderCompactTrace } from '../src/mentor/trace';
import { openAgentFiles } from '../src/files/agent-files';
import { createSandbox } from '../src/sandbox/sandbox';
import type { Sandbox } from '../src/sandbox/types';
import { makeHarness, makeJob, makeJobDir, type TempJob } from './support/fixtures';
import { ScriptedStudent, type ScriptedTurn } from './support/scripted-student';

/*
 * The agent loop in a small context, with real tools on a table too big to hold: 600 orders, read
 * 60 lines at a time. The student is scripted, and reports for each prompt what a tokenizer would
 * count, from a rule that is not the loop's own, as a runtime does.
 */

const CONTEXT = 8_192;
/** What a reply may write here, so 7,168 tokens are left for a prompt. */
const OUTPUT = 1_024;
const PROMPT_ROOM = contextBudget(CONTEXT, OUTPUT).promptRoom;
const READS = 8;

const ORDERS = [
  'order_id,customer_id,order_date,shipped_on,delivered_on,shipping,payment',
  ...Array.from(
    { length: 600 },
    (_, at) =>
      `ORD-${10_001 + at},C-${1_100 + ((at * 7) % 90)},2026-05-${String(1 + (at % 28)).padStart(2, '0')},2026-05-${String(2 + (at % 27)).padStart(2, '0')},2026-05-${String(5 + (at % 24)).padStart(2, '0')},${(at % 5) * 4}.00,card`,
  ),
].join('\n');

let job: TempJob | undefined;
afterEach(() => job?.remove());

let sandbox: Sandbox;
beforeAll(() => {
  sandbox = createSandbox();
});
afterAll(() => sandbox.dispose());

/** The size of a prompt by another rule than the loop's: a digit is most of a token. */
function realTokens(messages: readonly ChatMessage[]): number {
  let total = 1_100; // the template's tool instructions, and the tools
  for (const message of messages) {
    const text =
      message.role === 'assistant'
        ? message.content + JSON.stringify(message.toolCalls ?? [])
        : message.content;
    const digits = (text.match(/[0-9]/g) ?? []).length;
    total += 8 + Math.round(digits * 0.85 + (text.length - digits) / 3.7);
  }
  return total;
}

/** Reads the next 60 lines on every turn, then answers; each turn reports its prompt's size. */
function readingOrders(reads = READS, extra: Partial<ScriptedTurn> = {}) {
  return (request: StudentChatRequest, turn: number): ScriptedTurn => {
    const usage = { inputTokens: realTokens(request.messages), outputTokens: 150 };
    if (turn < reads) {
      const offset = 1 + turn * 60;
      return {
        toolCalls: [{ name: 'read', arguments: { path: 'data/orders.csv', offset, limit: 60 } }],
        usage,
        ...extra,
      };
    }
    return { text: 'ANSWER: 400', usage };
  };
}

async function run(
  student: ScriptedStudent,
  harness: Harness = makeHarness({ decoding: { maxOutputTokens: OUTPUT } }),
) {
  job = makeJobDir({ 'orders.csv': ORDERS });
  const files = await openAgentFiles({
    dataDir: job.dataDir,
    files: [{ name: 'orders.csv', kind: 'table', access: 'read', description: 'Every order.' }],
    skills: skillFiles(harness),
    mode: 'scratch',
  });
  const trace = await runAgent({
    harness,
    job: makeJob(),
    student,
    files,
    sandbox,
    request: 'How many orders are there?',
    mode: 'task',
    seed: 42,
  });
  return { trace, student };
}

const toolResults = (messages: readonly ChatMessage[]) =>
  messages.filter((message) => message.role === 'tool');

describe('a conversation that outgrows the context', () => {
  it('without a limit, the prompt grows past the room (the failure this prevents)', async () => {
    const { trace, student } = await run(new ScriptedStudent(readingOrders(), null));
    expect(trace.stopReason).toBe('answer');
    const sizes = student.requests.map((request) => realTokens(request.messages));
    expect(Math.max(...sizes)).toBeGreaterThan(PROMPT_ROOM);
    expect(trace.cleared).toBeUndefined();
  });

  it('clears the oldest results so that every prompt stays inside the room, and still answers', async () => {
    const { trace, student } = await run(new ScriptedStudent(readingOrders(), CONTEXT));
    expect(trace).toMatchObject({ stopReason: 'answer', finalText: 'ANSWER: 400' });
    expect(student.requests).toHaveLength(READS + 1);
    for (const request of student.requests) {
      expect(realTokens(request.messages)).toBeLessThanOrEqual(PROMPT_ROOM);
    }
    expect(trace.cleared?.length).toBeGreaterThan(0);
  });

  it('keeps the whole conversation in the trace, and records what the model did not see, and when', async () => {
    const { trace, student } = await run(new ScriptedStudent(readingOrders(), CONTEXT));
    // Every result is whole in the trace, as the tools returned it.
    const results = toolResults(trace.messages);
    expect(results).toHaveLength(READS);
    for (const result of results) {
      expect(result.content).not.toContain('Cleared to make room');
      expect(result.content).toMatch(/^ *\d+\t/);
    }
    // Each clearing is recorded with the turn whose prompt first went without the result.
    const cleared = trace.cleared ?? [];
    for (const entry of cleared) {
      const sentWith = (request: StudentChatRequest) =>
        toolResults(request.messages).find((message) => message.toolCallId === entry.callId);
      const first = student.requests.findIndex(
        (request) => sentWith(request)?.content === entry.stub,
      );
      expect(first + 1).toBe(entry.turn);
      // Before that turn the model had the result whole, as the trace still has it.
      const whole = toolResults(trace.messages).find(
        (message) => message.toolCallId === entry.callId,
      );
      const before = student.requests.slice(0, first).flatMap((request) => sentWith(request) ?? []);
      for (const message of before) expect(message.content).toBe(whole?.content);
      expect(entry.name).toBe('read');
    }
    // Oldest first: the order they were cleared in is the order they were read in.
    const order = cleared.map((entry) => Number(entry.callId.split('_')[1]));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });

  it('tells the model what each cleared result was and how to get it back', async () => {
    const { trace, student } = await run(new ScriptedStudent(readingOrders(), CONTEXT));
    expect(trace.cleared?.[0]).toMatchObject({
      callId: 'call_0_0',
      stub: '[Cleared to make room: read data/orders.csv, lines 1-60. Read it again if you need it.]',
    });
    const last = student.requests.at(-1);
    expect(toolResults(last?.messages ?? [])[0]?.content).toBe(trace.cleared?.[0]?.stub);
  });

  it('never clears the newest result, the request or the system prompt', async () => {
    const { student } = await run(new ScriptedStudent(readingOrders(), CONTEXT));
    for (const request of student.requests.slice(1)) {
      const sent = request.messages;
      expect(sent[0]?.content).toContain('You are the service desk');
      expect(sent[1]).toEqual({ role: 'user', content: 'How many orders are there?' });
      expect(sent.at(-1)?.content).toMatch(/^ *\d+\t/);
    }
  });

  it('leaves a roomy context alone: nothing is cleared and the trace has no record of any', async () => {
    const { trace, student } = await run(new ScriptedStudent(readingOrders(), 131_072));
    expect(trace.cleared).toBeUndefined();
    for (const result of toolResults(student.requests.at(-1)?.messages ?? [])) {
      expect(result.content).not.toContain('Cleared to make room');
    }
  });

  it('leaves the model that has no limit (the mentor as the agent) alone, however much it reads', async () => {
    const { trace } = await run(new ScriptedStudent(readingOrders(), null));
    expect(trace.cleared).toBeUndefined();
  });

  it('shows the mentor which results the student no longer had', async () => {
    const { trace } = await run(new ScriptedStudent(readingOrders(), CONTEXT));
    const shown = renderCompactTrace(trace, { text: 800, args: 400, result: 100, total: 60_000 });
    const first = trace.cleared?.[0];
    expect(shown).toContain(
      `(cleared to make room: from turn ${first?.turn} the model read a note here, not this result)`,
    );
    expect(renderCompactTrace({ ...trace, cleared: undefined })).not.toContain(
      'cleared to make room',
    );
  });
});

describe('a conversation that cannot fit', () => {
  it('ends with a plain error when the instructions alone take the whole room, without calling the model', async () => {
    const harness = makeHarness({
      system: 'Follow the desk rules exactly. '.repeat(1_200),
      decoding: { maxOutputTokens: OUTPUT },
    });
    const { trace, student } = await run(new ScriptedStudent(readingOrders(), CONTEXT), harness);
    expect(student.requests).toHaveLength(0);
    expect(trace.stopReason).toBe('error');
    expect(
      trace.error?.startsWith("This task needs more room than the model's context allows."),
    ).toBe(true);
    expect(trace.error).toContain('8,192 tokens leaves 7,168');
  });

  it('clears every older result, then ends with the same error when the newest alone does not fit', async () => {
    // A context of 4,096 leaves 3,584 for a prompt once a reply has 512, and the tools take about
    // half. A short read fits; the 60 lines read after it fit only if the short one goes, and then
    // still don't.
    const harness = makeHarness({ decoding: { maxOutputTokens: 512 } });
    const student = new ScriptedStudent(
      (request, turn) => ({
        usage: { inputTokens: realTokens(request.messages), outputTokens: 100 },
        toolCalls: [
          {
            name: 'read',
            arguments: {
              path: 'data/orders.csv',
              offset: 1 + turn * 10,
              limit: turn === 0 ? 10 : 60,
            },
          },
        ],
      }),
      4_096,
    );
    const { trace } = await run(student, harness);
    expect(trace.stopReason).toBe('error');
    expect(
      trace.error?.startsWith("This task needs more room than the model's context allows."),
    ).toBe(true);
    // The model was asked twice. Before the third turn the short read was cleared, to no avail.
    expect(student.requests).toHaveLength(2);
    expect(trace.cleared).toEqual([
      {
        turn: 3,
        callId: 'call_0_0',
        name: 'read',
        stub: '[Cleared to make room: read data/orders.csv, lines 1-10. Read it again if you need it.]',
      },
    ]);
    // The trace still has both results whole.
    expect(
      toolResults(trace.messages).map((message) => message.content.includes('Cleared')),
    ).toEqual([false, false]);
  });
});

describe('a reply cut off at the end of the context', () => {
  it('learns how big the prompt really was and asks again with more room made', async () => {
    const base = readingOrders(4);
    const script = (request: StudentChatRequest, turn: number): ScriptedTurn => {
      // The third prompt was far bigger than the loop counted: its reply ran into the context's end.
      if (turn === 3) {
        return {
          text: 'The orders are',
          cutOff: true,
          usage: { inputTokens: PROMPT_ROOM + 900, outputTokens: CONTEXT - PROMPT_ROOM - 900 },
        };
      }
      return base(request, turn > 3 ? turn - 1 : turn);
    };
    const student = new ScriptedStudent(script, CONTEXT);
    const { trace } = await run(student);
    expect(trace.stopReason).toBe('answer');
    // The fourth prompt (three results) was cut off; the retry is the one after it.
    const [, , , first, retry] = student.requests;
    // The retry was sent a smaller prompt than the attempt that was cut off.
    expect(realTokens(retry?.messages ?? [])).toBeLessThan(realTokens(first?.messages ?? []));
    const cleared = (request: StudentChatRequest | undefined) =>
      toolResults(request?.messages ?? []).filter((m) => m.content.startsWith('[Cleared')).length;
    expect(cleared(retry)).toBeGreaterThan(cleared(first));
    expect(retry?.seed).toBe(42 + 1_000_003);
  });

  it('keeps the whole output limit free on the next try, when the quarter set aside was not enough', async () => {
    // A turn may write 4,096 tokens here, so a quarter of the context (2,048) is not all it needs:
    // the prompt may take 6,144 tokens on the first try, and 4,096 on the next.
    const harness = makeHarness({ decoding: { maxOutputTokens: 4_096 } });
    const reads = [1, 31].map((offset) => ({
      toolCalls: [{ name: 'read', arguments: { path: 'data/orders.csv', offset, limit: 30 } }],
    }));
    const student = new ScriptedStudent(
      [
        { ...reads[0], usage: { inputTokens: 1_500, outputTokens: 100 } },
        { ...reads[1], usage: { inputTokens: 3_000, outputTokens: 100 } },
        // The third prompt held 5,000 tokens, which fit beside a reply of a quarter of the context;
        // its reply wrote on until the context ended.
        {
          text: 'The orders are',
          cutOff: true,
          usage: { inputTokens: 5_000, outputTokens: CONTEXT - 5_000 },
        },
        { text: 'ANSWER: 600', usage: { inputTokens: 3_700, outputTokens: 20 } },
      ],
      CONTEXT,
    );
    const { trace } = await run(student, harness);
    expect(trace.error).toBeUndefined();
    expect(trace.stopReason).toBe('answer');
    const [, , first, retry] = student.requests;
    const stubs = (request: StudentChatRequest | undefined) =>
      toolResults(request?.messages ?? []).filter((m) => m.content.startsWith('[Cleared')).length;
    expect(stubs(first)).toBe(0);
    expect(stubs(retry)).toBe(1);
    expect(trace.cleared).toMatchObject([{ turn: 3, callId: 'call_0_0' }]);
  });

  it('says the context filled up when it never stops being cut off there', async () => {
    const filled = {
      text: 'The orders are',
      cutOff: true,
      usage: { inputTokens: 7_000, outputTokens: CONTEXT - 7_000 },
    };
    const { trace, student } = await run(new ScriptedStudent([filled, filled, filled], CONTEXT));
    expect(student.requests).toHaveLength(3);
    expect(trace.stopReason).toBe('error');
    expect(trace.error).toContain(
      "The model's reply was cut off when its context of 8,192 tokens filled up",
    );
    expect(trace.error).toContain('in the middle of its answer, 3 times in a row');
    expect(trace.error).toContain('larger context');
  });
});
