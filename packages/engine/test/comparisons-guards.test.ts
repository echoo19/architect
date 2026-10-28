import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AdapterError,
  DecodingSchema,
  type StudentAdapter,
  type StudentChatRequest,
  type StudentStreamEvent,
  type TokenPricing,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { GPU_REFUSAL, GpuWindow } from '../src/comparisons/gpu';
import { CREDIT_REFUSAL, StudentCredit, worstCaseUsd } from '../src/comparisons/spend';
import { systemClock } from '../src/loop/deps';

const PRICE: TokenPricing = { inputPerM: 0.3, cachedInputPerM: 0.04, outputPerM: 1.2 };
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function journalFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'architect-credit-'));
  dirs.push(dir);
  return join(dir, 'requests.jsonl');
}

function request(prompt = 'Refund order 1042.'): StudentChatRequest {
  return {
    messages: [{ role: 'user', content: prompt }],
    tools: [],
    decoding: DecodingSchema.parse({ maxOutputTokens: 1_000 }),
    seed: 1,
  };
}

type Reply = (signal?: AbortSignal) => AsyncGenerator<StudentStreamEvent>;

function student(reply: Reply, isLocal = false): StudentAdapter & { calls: number } {
  const fake = {
    label: 'Student',
    model: 'hosted-student',
    baseUrl: isLocal ? 'http://127.0.0.1:11434' : 'https://openrouter.ai/api/v1',
    isLocal,
    calls: 0,
    chat: (_request: StudentChatRequest, signal?: AbortSignal) => {
      fake.calls += 1;
      return reply(signal);
    },
    describe: async () => ({ model: 'hosted-student' }),
    testConnection: async () => ({ ok: true as const, latencyMs: 1, detail: 'fake' }),
    release: async () => undefined,
  };
  return fake;
}

async function drain(stream: AsyncIterable<StudentStreamEvent>): Promise<StudentStreamEvent[]> {
  const events: StudentStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const lines = (file: string) =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as { event: string; id: string });

describe("the student's credit", () => {
  it('writes each request down before it is sent, and settles it with what was billed', async () => {
    const file = journalFile();
    const credit = new StudentCredit(file, 10, systemClock);
    const seen: string[][] = [];
    const guarded = credit.guard(
      student(async function* () {
        // What the journal holds at the moment the request goes out.
        seen.push(lines(file).map((line) => line.event));
        yield { type: 'text', delta: 'ok' };
        yield {
          type: 'done',
          usage: { inputTokens: 30_000, outputTokens: 800 },
          finish: 'stop',
          costUsd: 0.0123,
        };
      }),
      PRICE,
    );
    await drain(guarded.chat(request()));
    expect(seen).toEqual([['sent']]);
    expect(lines(file).map((line) => line.event)).toEqual(['sent', 'settled']);
    expect(credit.total()).toBeCloseTo(0.0123, 9);
    expect(credit.summary()).toMatchObject({
      requests: 1,
      billedRequests: 1,
      uncertainRequests: 0,
    });
  });

  it('counts the listed price when nothing was billed, and never a reply with no usage as free', async () => {
    const file = journalFile();
    const credit = new StudentCredit(file, 10, systemClock);
    const listed = credit.guard(
      student(async function* () {
        yield { type: 'done', usage: { inputTokens: 30_000, outputTokens: 800 }, finish: 'stop' };
      }),
      PRICE,
    );
    await drain(listed.chat(request()));
    expect(credit.total()).toBeCloseTo((30_000 * 0.3 + 800 * 1.2) / 1e6, 9);
    const unreported = credit.guard(
      student(async function* () {
        yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0 }, finish: 'stop' };
      }),
      PRICE,
    );
    const before = credit.total();
    await drain(unreported.chat(request()));
    // At its worst: every byte of the prompt a token, every output token used.
    expect(credit.total() - before).toBeCloseTo(worstCaseUsd(request(), PRICE), 9);
    expect(credit.summary().uncertainRequests).toBe(1);
  });

  it('counts a request that failed partway at its worst, and one refused before any reply as free', async () => {
    const credit = new StudentCredit(journalFile(), 10, systemClock);
    const partway = credit.guard(
      student(async function* () {
        yield { type: 'text', delta: 'Let me' };
        throw new AdapterError('network', 'The connection dropped.');
      }),
      PRICE,
    );
    await expect(drain(partway.chat(request()))).rejects.toThrow('The connection dropped.');
    expect(credit.total()).toBeCloseTo(worstCaseUsd(request(), PRICE), 9);
    const refused = credit.guard(
      student(async function* () {
        yield* [];
        throw new AdapterError('quota', 'No credit left.', { status: 402 });
      }),
      PRICE,
    );
    const before = credit.total();
    await expect(drain(refused.chat(request()))).rejects.toThrow('No credit left.');
    expect(credit.total()).toBeCloseTo(before, 9);
  });

  it('counts a request its reader abandoned at its worst', async () => {
    const credit = new StudentCredit(journalFile(), 10, systemClock);
    const guarded = credit.guard(
      student(async function* () {
        yield { type: 'text', delta: 'one' };
        yield { type: 'text', delta: 'two' };
        yield { type: 'done', usage: { inputTokens: 10, outputTokens: 2 }, finish: 'stop' };
      }),
      PRICE,
    );
    for await (const _event of guarded.chat(request())) break;
    expect(credit.summary()).toMatchObject({ uncertainRequests: 1, inFlightRequests: 0 });
    expect(credit.total()).toBeCloseTo(worstCaseUsd(request(), PRICE), 9);
  });

  it("reads a crashed process's request with no end as spent at its worst, past a cut-off last line", () => {
    const file = journalFile();
    const at = new Date().toISOString();
    appendFileSync(
      file,
      `${JSON.stringify({ event: 'sent', id: 'req_a', at, model: 'm', worstUsd: 0.25 })}\n${JSON.stringify({ event: 'sent', id: 'req_b', at, model: 'm', worstUsd: 0.5 })}\n${JSON.stringify({ event: 'settled', id: 'req_b', at, usage: { inputTokens: 100, outputTokens: 10 }, billedUsd: 0.01, listedUsd: 0.01 })}\n{"event":"sett`,
    );
    const credit = new StudentCredit(file, 10, systemClock);
    expect(credit.total()).toBeCloseTo(0.26, 9);
    expect(credit.summary()).toMatchObject({
      requests: 2,
      settledUsd: 0.01,
      uncertainUsd: 0.25,
      uncertainRequests: 1,
    });
  });

  it('holds requests in flight at their worst, and refuses one that could pass the cap', async () => {
    const worst = worstCaseUsd(request(), PRICE);
    // Room for two requests at their worst, not three.
    const credit = new StudentCredit(journalFile(), 2.5 * worst, systemClock);
    let finish: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const slow = student(async function* () {
      await held;
      yield { type: 'done', usage: { inputTokens: 10, outputTokens: 2 }, finish: 'stop' };
    });
    const guarded = credit.guard(slow, PRICE);
    const first = drain(guarded.chat(request()));
    const second = drain(guarded.chat(request()));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await expect(drain(guarded.chat(request()))).rejects.toThrow(CREDIT_REFUSAL);
    expect(slow.calls).toBe(2);
    finish();
    await Promise.all([first, second]);
    // Settled cheaply, so there is room again.
    await expect(drain(guarded.chat(request()))).resolves.toHaveLength(1);
  });

  it("sends nothing for a student whose price isn't known", async () => {
    const credit = new StudentCredit(journalFile(), 10, systemClock);
    const fake = student(async function* () {
      yield { type: 'done', usage: { inputTokens: 10, outputTokens: 2 }, finish: 'stop' };
    });
    await expect(drain(credit.guard(fake, undefined).chat(request()))).rejects.toThrow(
      'has no known price',
    );
    expect(fake.calls).toBe(0);
  });
});

describe('the GPU window', () => {
  const answer = async function* (signal?: AbortSignal): AsyncGenerator<StudentStreamEvent> {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 200);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new AdapterError('aborted', 'Stopped.'));
        },
        { once: true },
      );
    });
    yield { type: 'done', usage: { inputTokens: 10, outputTokens: 2 }, finish: 'stop' };
  };

  it('runs nothing on the GPU when no minutes are granted', async () => {
    const releases: number[] = [];
    const window = new GpuWindow({
      minutes: 0,
      clock: systemClock,
      release: async () => {
        releases.push(1);
      },
      log: () => undefined,
    });
    const local = student(answer, true);
    await expect(drain(window.guard(local).chat(request()))).rejects.toThrow(GPU_REFUSAL);
    expect(local.calls).toBe(0);
  });

  it('stops a request in flight when the window ends, refuses the next, and frees the GPU', async () => {
    let released = 0;
    const window = new GpuWindow({
      // 60 ms.
      minutes: 0.001,
      clock: systemClock,
      release: async () => {
        released += 1;
      },
      log: () => undefined,
    });
    const local = student(answer, true);
    const guarded = window.guard(local);
    const error = await drain(guarded.chat(request())).then(
      () => null,
      (reason: unknown) => reason,
    );
    // A runtime failure, so the loop never scores the cut attempt as a wrong answer.
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).code).toBe('quota');
    expect((error as Error).message).toMatch(/^The GPU window granted to this command/);
    await expect(drain(guarded.chat(request()))).rejects.toThrow(GPU_REFUSAL);
    expect(local.calls).toBe(1);
    expect(released).toBe(1);
  });
});
