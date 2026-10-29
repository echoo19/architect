import type { ChatMessage, JsonValue, ToolSpec } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { contextBudget, ContextWindow, estimateTokens, noRoomError } from '../src/agent/context';

/*
 * The context window as the agent loop uses it, on conversations built here. Sizes are chosen so
 * the arithmetic can be followed: a result of N digits counts as 1.1 N tokens (a digit is a token,
 * with the 10% margin), and every message adds 16 for what the chat template wraps around it.
 */

const NO_TOOLS: ToolSpec[] = [];
/** A 8,192-token context where a turn may write 1,024 tokens: 7,168 are left for the prompt. */
const window = (contextLength = 8_192, maxOutputTokens = 1_024, tools = NO_TOOLS) =>
  new ContextWindow(contextLength, maxOutputTokens, tools);

const system: ChatMessage = { role: 'system', content: 'You are the returns desk.' };
const request: ChatMessage = { role: 'user', content: 'How many orders did C-1107 place?' };
const reading = (id: string, args: Record<string, JsonValue>): ChatMessage => ({
  role: 'assistant',
  content: '',
  toolCalls: [{ id, name: 'read', arguments: args }],
});
const result = (id: string, content: string, name = 'read'): ChatMessage => ({
  role: 'tool',
  toolCallId: id,
  name,
  content,
});
/** `lines` numbered lines of digits, `width` digits each, as a read prints them. */
function numbered(first: number, lines: number, width = 90): string {
  return Array.from({ length: lines }, (_, at) => `${first + at}\t${'7'.repeat(width)}`).join('\n');
}
/** A conversation of `count` reads of 10 lines of 90 digits each (about 1,000 tokens). */
function conversation(count: number): ChatMessage[] {
  const messages: ChatMessage[] = [system, request];
  for (let at = 1; at <= count; at += 1) {
    const first = 1 + (at - 1) * 10;
    messages.push(reading(`c${at}`, { path: 'data/orders.csv', offset: first, limit: 10 }));
    messages.push(result(`c${at}`, numbered(first, 10)));
  }
  return messages;
}

describe('the budget', () => {
  it('leaves the reply what the harness lets a turn write, and the prompt the rest', () => {
    expect(contextBudget(16_384, 4_096)).toEqual({
      contextLength: 16_384,
      replyRoom: 4_096,
      promptRoom: 12_288,
    });
    expect(contextBudget(16_384, 1_000)).toMatchObject({ replyRoom: 1_000, promptRoom: 15_384 });
  });

  it('never gives the reply more than a quarter of the context', () => {
    expect(contextBudget(16_384, 32_768)).toMatchObject({ replyRoom: 4_096, promptRoom: 12_288 });
    expect(contextBudget(8_192, 4_096)).toMatchObject({ replyRoom: 2_048, promptRoom: 6_144 });
  });

  it('gives the next try after a cut-off the whole output limit, up to half the context', () => {
    expect(contextBudget(16_384, 6_000, true)).toMatchObject({ replyRoom: 6_000 });
    expect(contextBudget(16_384, 32_768, true)).toMatchObject({ replyRoom: 8_192 });
    // A limit the quarter already covered has nothing more to give.
    expect(contextBudget(16_384, 4_096, true)).toEqual(contextBudget(16_384, 4_096));
  });
});

describe('making room', () => {
  it('sends a conversation that fits as it is', () => {
    const messages = conversation(2);
    const fit = window().fit(messages, 3);
    expect(fit).toMatchObject({ cleared: [], fits: true });
    expect(fit.messages).toEqual(messages);
  });

  it('clears the oldest results first, only as many as it takes, and says which turn did it', () => {
    // Each read counts about 1,100 tokens with its call; six come to 7,053 of the 7,168 there are.
    const cleared = (reads: number) =>
      window()
        .fit(conversation(reads), reads + 1)
        .cleared.map((entry) => entry.callId);
    expect(cleared(6)).toEqual([]);
    expect(cleared(7)).toEqual(['c1', 'c2']);
    expect(cleared(8)).toEqual(['c1', 'c2', 'c3']);

    const fit = window().fit(conversation(7), 8);
    expect(fit.fits).toBe(true);
    expect(fit.tokens).toBeLessThanOrEqual(fit.budget.promptRoom);
    expect(fit.cleared.every((entry) => entry.turn === 8 && entry.name === 'read')).toBe(true);
  });

  it('replaces a cleared result with a note that names the call and how to get it back', () => {
    const fit = window().fit(conversation(7), 8);
    expect(fit.cleared[0]?.stub).toBe(
      '[Cleared to make room: read data/orders.csv, lines 1-10. Read it again if you need it.]',
    );
    expect(fit.cleared[1]?.stub).toBe(
      '[Cleared to make room: read data/orders.csv, lines 11-20. Read it again if you need it.]',
    );
    expect(fit.messages[3]).toEqual(result('c1', fit.cleared[0]?.stub ?? ''));
    // The result after those two is still whole.
    expect(fit.messages[7]).toEqual(conversation(7)[7]);
  });

  it("never touches the system prompt, the request, the model's own turns or the newest result", () => {
    const messages = conversation(7);
    const fit = window().fit(messages, 8);
    // The first two results (at 3 and 5) are the ones cleared; every other message is the same one.
    for (const [at, message] of messages.entries()) {
      if (at === 3 || at === 5) continue;
      expect(fit.messages[at]).toBe(message);
    }
    // The newest result is the last message: whatever else is cleared, it stays whole.
    expect(fit.messages.at(-1)).toBe(messages.at(-1));
  });

  it("keeps every result of the model's latest turn, which it has yet to read", () => {
    const messages: ChatMessage[] = [system, request];
    for (let at = 1; at <= 6; at += 1) {
      messages.push(
        reading(`c${at}`, { path: 'data/orders.csv' }),
        result(`c${at}`, numbered(1, 10)),
      );
    }
    messages.push({
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'a', name: 'read', arguments: { path: 'data/customers.csv' } },
        { id: 'b', name: 'read', arguments: { path: 'data/products.csv' } },
      ],
    });
    messages.push(result('a', numbered(1, 10)), result('b', numbered(1, 10)));
    const fit = window().fit(messages, 8);
    const kept = fit.messages.slice(-2);
    expect(kept).toEqual(messages.slice(-2));
    expect(fit.cleared.map((cleared) => cleared.callId)).not.toContain('a');
    expect(fit.cleared.map((cleared) => cleared.callId)).not.toContain('b');
  });

  it('keeps a result cleared in every later turn, so the model reads one conversation', () => {
    const held = window();
    const first = held.fit(conversation(7), 8);
    const later = conversation(8);
    const second = held.fit(later, 9);
    // Nothing is cleared a second time, and what was cleared reads the same.
    for (const cleared of first.cleared) {
      expect(second.cleared.map((entry) => entry.callId)).not.toContain(cleared.callId);
    }
    expect(second.messages[3]).toEqual(first.messages[3]);
    expect(second.messages[5]).toEqual(first.messages[5]);
  });

  it('sends the same thing when asked again with nothing new', () => {
    const held = window();
    const messages = conversation(7);
    const first = held.fit(messages, 8);
    const again = held.fit(messages, 8);
    expect(again.cleared).toEqual([]);
    expect(again.messages).toEqual(first.messages);
    expect(again.tokens).toBe(first.tokens);
  });

  it('leaves a result alone when its note would not be shorter', () => {
    const tiny = 'No lines match in data/orders.csv.';
    const messages = [
      system,
      request,
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'g', name: 'grep', arguments: { pattern: 'ORD-9' } }],
      },
      result('g', tiny, 'grep'),
      ...conversation(7).slice(2),
    ] satisfies ChatMessage[];
    const fit = window().fit(messages, 9);
    expect(fit.cleared.map((cleared) => cleared.callId)).not.toContain('g');
    expect(fit.messages[3]).toEqual(result('g', tiny, 'grep'));
  });
});

describe('what a cleared result is called', () => {
  /** The note that replaces the oldest result of a conversation whose first call is `call`. */
  function noteFor(call: ChatMessage, content: string, name: string): string | undefined {
    const messages: ChatMessage[] = [system, request, call];
    const id = call.role === 'assistant' ? (call.toolCalls?.[0]?.id ?? 'x') : 'x';
    messages.push(result(id, content, name), ...conversation(7).slice(2));
    return window()
      .fit(messages, 9)
      .cleared.find((cleared) => cleared.callId === id)?.stub;
  }
  const call = (id: string, name: string, args: Record<string, JsonValue>): ChatMessage => ({
    role: 'assistant',
    content: '',
    toolCalls: [{ id, name, arguments: args }],
  });
  const bulk = numbered(1, 12);

  it('reads: the file, and the lines the read showed, not the lines it asked for', () => {
    // The read asked for 200 lines and the result stopped at 119: the note says what was shown.
    const shown = `${numbered(1, 119)}\n[Lines 1-119 of 412. 293 more lines: read on with offset 120.]`;
    expect(noteFor(call('x', 'read', { path: 'data/orders.csv', limit: 200 }), shown, 'read')).toBe(
      '[Cleared to make room: read data/orders.csv, lines 1-119. Read it again if you need it.]',
    );
  });

  it('reads: a single line, and a file that printed no lines', () => {
    expect(
      noteFor(
        call('x', 'read', { path: 'data/policy.md', offset: 9, limit: 1 }),
        `9\t${'7'.repeat(900)}`,
        'read',
      ),
    ).toBe('[Cleared to make room: read data/policy.md, line 9. Read it again if you need it.]');
    expect(noteFor(call('x', 'read', { path: 'data/policy.md' }), '7'.repeat(900), 'read')).toBe(
      '[Cleared to make room: read data/policy.md. Read it again if you need it.]',
    );
  });

  it('searches: the pattern and where', () => {
    const big = `${bulk}\n${bulk}`;
    expect(
      noteFor(
        call('x', 'grep', { pattern: 'ORD-1005', path: 'data/order_lines.csv' }),
        big,
        'grep',
      ),
    ).toBe(
      '[Cleared to make room: grep "ORD-1005" in data/order_lines.csv. Search again if you need it.]',
    );
    expect(noteFor(call('x', 'grep', { pattern: 'RT-50\\d\\d' }), big, 'grep')).toBe(
      '[Cleared to make room: grep "RT-50\\\\d\\\\d". Search again if you need it.]',
    );
  });

  it('lists: the folder or the pattern', () => {
    const listing = `${bulk}\n${bulk}`;
    expect(noteFor(call('x', 'ls', { path: 'data' }), listing, 'ls')).toBe(
      '[Cleared to make room: ls data. List it again if you need it.]',
    );
    expect(noteFor(call('x', 'ls', {}), listing, 'ls')).toBe(
      '[Cleared to make room: ls. List it again if you need it.]',
    );
    expect(noteFor(call('x', 'glob', { pattern: 'data/*.csv' }), listing, 'glob')).toBe(
      '[Cleared to make room: glob data/*.csv. List it again if you need it.]',
    );
  });

  it('runs: the first line of the code', () => {
    const code = "const rows = csv.parse(files.read('data/orders.csv'));\nprint(rows.length);";
    expect(noteFor(call('x', 'run', { code }), `${bulk}\n${bulk}`, 'run')).toBe(
      '[Cleared to make room: run "const rows = csv.parse(files.read(\'data/orders.csv\'));". Run it again if you need it.]',
    );
  });

  it('a tool the harness wrote: its name and arguments', () => {
    expect(
      noteFor(
        call('x', 'labor_cost', { tier: 'lead', hours: 2 }),
        `${bulk}\n${bulk}`,
        'labor_cost',
      ),
    ).toBe(
      '[Cleared to make room: labor_cost {"tier":"lead","hours":2}. Call it again if you need it.]',
    );
  });
});

describe('sizing the prompt', () => {
  it('counts a conversation by characters until a call has reported its size', () => {
    const messages = conversation(2);
    const expected =
      320 + // the template's tool instructions, with no tools listed
      estimateTokens('[]') +
      messages.reduce((total, message) => {
        if (message.role === 'assistant') {
          const call = message.toolCalls?.[0];
          return (
            total +
            16 +
            40 +
            estimateTokens(call?.name ?? '') +
            estimateTokens(JSON.stringify(call?.arguments))
          );
        }
        return total + 16 + estimateTokens(message.content);
      }, 0);
    expect(window().fit(messages, 3).tokens).toBe(expected);
  });

  it('counts the tools the student is offered', () => {
    const tool: ToolSpec = {
      name: 'read',
      description: 'Read a file.',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    };
    const bare = window().fit([system, request], 1).tokens;
    const offered = window(8_192, 1_024, [tool]).fit([system, request], 1).tokens;
    expect(offered - bare).toBe(estimateTokens(JSON.stringify([tool])) - estimateTokens('[]'));
  });

  it('takes the size a call reported for its prompt and reply, and counts only what came after', () => {
    const held = window();
    const messages = conversation(2);
    held.learn(messages.slice(0, 3), { inputTokens: 1_500, outputTokens: 60 }, true);
    // The reply is the last message of the three; the result after it is counted by characters.
    const fit = held.fit(messages.slice(0, 4), 2);
    expect(fit.tokens).toBe(1_560 + 16 + estimateTokens(numbered(1, 10)));
  });

  it('believes a call that says the prompt is smaller than the characters suggest', () => {
    // Seven reads count to over the room by characters, but the model says it read far less.
    const messages = conversation(7);
    expect(window().fit(messages, 8).cleared.length).toBeGreaterThan(0);
    const held = window();
    held.learn(messages.slice(0, 12), { inputTokens: 3_900, outputTokens: 80 }, true);
    const fit = held.fit(messages, 8);
    expect(fit.cleared).toEqual([]);
    expect(fit.tokens).toBeLessThan(fit.budget.promptRoom);
  });

  it('does not believe a size far below what the characters say', () => {
    const held = window();
    const messages = conversation(7);
    held.learn(messages.slice(0, 12), { inputTokens: 120, outputTokens: 10 }, true);
    expect(held.fit(messages, 8).cleared.length).toBeGreaterThan(0);
  });

  it('takes a size of nothing as no report at all', () => {
    const held = window();
    const messages = conversation(7);
    held.learn(messages.slice(0, 12), { inputTokens: 0, outputTokens: 0 }, true);
    expect(held.fit(messages, 8).tokens).toBe(window().fit(messages, 8).tokens);
  });

  it('takes out of a reported size the share that clearing a result has removed since', () => {
    // A small context, so the reported size is over the room and the first result has to go.
    const held = window(4_096, 512);
    const messages = conversation(4);
    // What the same conversation counts to by characters, with a context nothing can fill.
    const counted = new ContextWindow(1_000_000, 512, NO_TOOLS).fit(messages, 5).tokens;
    const reported = 4_000;
    held.learn(messages, { inputTokens: reported, outputTokens: 0 }, true);

    const fit = held.fit(messages, 5);
    expect(fit.cleared.map((entry) => entry.callId)).toEqual(['c1']);
    // The reported size shrinks by the result's share of the count, not by the result's whole count.
    const removed = estimateTokens(numbered(1, 10)) - estimateTokens(fit.cleared[0]?.stub ?? '');
    expect(fit.tokens).toBe(Math.ceil((reported * (counted - removed)) / counted));
    expect(fit.tokens).toBeGreaterThan(reported - removed);
    expect(fit.fits).toBe(true);
  });

  it('learns from a reply that was cut off and thrown away how big the prompt really was', () => {
    const held = window(8_192, 4_096);
    const messages = conversation(4);
    expect(held.fit(messages, 5).cleared).toEqual([]);
    // The prompt was far bigger than the characters said: the next try makes room.
    held.learn(messages, { inputTokens: 6_000, outputTokens: 4_000 }, false);
    const next = held.fit(messages, 5, true);
    expect(next.budget.replyRoom).toBe(4_096);
    expect(next.cleared.length).toBeGreaterThan(0);
    expect(next.fits).toBe(true);
  });
});

describe('when it cannot fit', () => {
  it('says the prompt does not fit when the request and the newest result alone are too big', () => {
    const huge = result('c1', '7'.repeat(9_000));
    const messages = [system, request, reading('c1', { path: 'data/orders.csv' }), huge];
    const fit = window().fit(messages, 2);
    expect(fit.fits).toBe(false);
    expect(fit.cleared).toEqual([]);
    expect(fit.messages.at(-1)).toBe(huge);
  });

  it('clears every older result first, and then says so', () => {
    const messages = [
      ...conversation(3),
      reading('big', { path: 'data/orders.csv' }),
      result('big', '7'.repeat(8_000)),
    ];
    const fit = window().fit(messages, 5);
    expect(fit.fits).toBe(false);
    expect(fit.cleared.map((cleared) => cleared.callId)).toEqual(['c1', 'c2', 'c3']);
  });

  it('explains it plainly, with the figures', () => {
    const fit = window().fit(
      [system, request, reading('c1', {}), result('c1', '7'.repeat(9_000))],
      2,
    );
    const said = noRoomError(fit);
    expect(said.startsWith("This task needs more room than the model's context allows.")).toBe(
      true,
    );
    expect(said).toContain('8,192 tokens leaves 7,168');
    expect(said).not.toMatch(/[—“”‘’]/);
  });
});
