import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import {
  AdapterError,
  costUsd,
  newId,
  UsageSchema,
  type CreditSummary,
  type StudentAdapter,
  type StudentChatRequest,
  type StudentStreamEvent,
  type TokenPricing,
  type Usage,
} from '@architect/shared';
import { z } from 'zod';
import type { Clock } from '../loop/deps';
import { errorMessage } from '../loop/errors';

/*
 * The request journal (decision 051): every request a comparison sends to the hosted student,
 * written down and flushed to disk before it is sent, then settled with what it cost when its
 * reply ends. A request a crash cut off has no settlement, and one that failed partway may have
 * been billed; both count as spent at the most they could have cost. So the student's credit is
 * never held to less than was spent, whatever stopped the process.
 */

const SentLineSchema = z.object({
  event: z.literal('sent'),
  id: z.string().min(1),
  at: z.iso.datetime(),
  model: z.string(),
  /** The most the request can cost: every byte of its prompt a token, every output token used. */
  worstUsd: z.number().nonnegative(),
});

const SettledLineSchema = z.object({
  event: z.literal('settled'),
  id: z.string().min(1),
  at: z.iso.datetime(),
  usage: UsageSchema,
  /** What the provider said it charged, when it said. */
  billedUsd: z.number().nonnegative().nullable(),
  /** The listed price of the usage it reported; null when it reported none. */
  listedUsd: z.number().nonnegative().nullable(),
});

const FailedLineSchema = z.object({
  event: z.literal('failed'),
  id: z.string().min(1),
  at: z.iso.datetime(),
  error: z.string(),
  /** Refused with an HTTP 4xx answer before anything was generated, so nothing was billed. */
  unbilled: z.boolean(),
});

export const JournalLineSchema = z.discriminatedUnion('event', [
  SentLineSchema,
  SettledLineSchema,
  FailedLineSchema,
]);
export type JournalLine = z.infer<typeof JournalLineSchema>;

/** The words every refusal of the credit's cap starts with, so a run paused by it is told apart. */
export const CREDIT_REFUSAL = 'The student credit set aside for this comparison';

/** Template marks a chat format may add around each message, generously. */
const TOKENS_PER_MESSAGE = 16;

/**
 * The most one request can cost: no tokenizer makes more tokens than its prompt has bytes, so
 * every byte of the messages and tools as JSON counts as a token, with room for each message's
 * template marks, and every output token the request allows is used. `factor` raises it when
 * calibration found the provider billing more than the listed price.
 */
export function worstCaseUsd(
  request: StudentChatRequest,
  pricing: TokenPricing,
  factor = 1,
): number {
  const prompt = Buffer.byteLength(
    JSON.stringify({ messages: request.messages, tools: request.tools }),
    'utf8',
  );
  const inputTokens = prompt + TOKENS_PER_MESSAGE * (request.messages.length + 1);
  return (
    Math.max(1, factor) *
    costUsd(pricing, { inputTokens, outputTokens: request.decoding.maxOutputTokens })
  );
}

/** Refused before generation: an HTTP 4xx answer, with nothing of the reply received. */
function refusedUnbilled(error: unknown, received: boolean): boolean {
  return (
    !received &&
    error instanceof AdapterError &&
    error.status !== undefined &&
    error.status >= 400 &&
    error.status < 500
  );
}

function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

interface Request {
  sent: z.infer<typeof SentLineSchema>;
  end: z.infer<typeof SettledLineSchema> | z.infer<typeof FailedLineSchema> | null;
}

/**
 * The hosted student's credit for one comparison: the journal of its requests and the cap no
 * request may take it past. Every request reserves its worst case before it is sent, so what is
 * paid and what is in flight together never pass the cap.
 */
export class StudentCredit {
  private readonly requests = new Map<string, Request>();
  /** Requests this process has in flight; any other request with no end was cut off earlier. */
  private readonly inFlight = new Set<string>();
  private factor = 1;

  constructor(
    private readonly file: string,
    private cap: number,
    private readonly clock: Clock,
  ) {
    if (!existsSync(file)) return;
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '');
    for (const [index, line] of lines.entries()) {
      let parsed: JournalLine;
      try {
        parsed = JournalLineSchema.parse(JSON.parse(line));
      } catch (error) {
        // A line cut off by a crash is the last one; any other is damage, which is reported.
        if (index === lines.length - 1) break;
        throw new Error(`Line ${index + 1} of ${file} can't be read: ${errorMessage(error)}`, {
          cause: error,
        });
      }
      this.read(parsed);
    }
  }

  private read(line: JournalLine): void {
    if (line.event === 'sent') {
      this.requests.set(line.id, { sent: line, end: null });
      return;
    }
    const request = this.requests.get(line.id);
    if (request !== undefined && request.end === null) request.end = line;
  }

  /** Appends a line and flushes it to disk before returning. */
  private write(line: JournalLine): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const fd = openSync(this.file, 'a');
    try {
      writeSync(fd, `${JSON.stringify(JournalLineSchema.parse(line))}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.read(line);
  }

  /** The cap now held to: the plan's, once it is confirmed. */
  holdTo(cap: number): void {
    this.cap = cap;
  }

  /** Raises every later worst case by what calibration found the provider billing over the list. */
  billingFactor(factor: number): void {
    this.factor = Math.max(1, factor);
  }

  /** What one request counts as spent: certain, uncertain, or held while in flight. */
  private costOf(request: Request): { usd: number; certain: boolean } {
    const { sent, end } = request;
    if (end === null) return { usd: sent.worstUsd, certain: false };
    if (end.event === 'failed') {
      return end.unbilled ? { usd: 0, certain: true } : { usd: sent.worstUsd, certain: false };
    }
    if (end.billedUsd !== null) return { usd: end.billedUsd, certain: true };
    // A reply that reported no usage and no charge can't be priced: its worst case stands.
    if (end.listedUsd !== null && end.usage.inputTokens > 0) {
      return { usd: end.listedUsd, certain: true };
    }
    return { usd: sent.worstUsd, certain: false };
  }

  /** Whether anything is left under the cap once what was paid or is held is counted. */
  hasRoom(): boolean {
    return this.total() < this.cap - 1e-9;
  }

  /** Every dollar paid, and every dollar that may have been: uncertain charges at their worst. */
  total(): number {
    let usd = 0;
    for (const request of this.requests.values()) usd += this.costOf(request).usd;
    return usd;
  }

  summary(): CreditSummary {
    const summary: CreditSummary = {
      capUsd: this.cap,
      requests: this.requests.size,
      settledUsd: 0,
      billedRequests: 0,
      uncertainUsd: 0,
      uncertainRequests: 0,
      inFlightRequests: 0,
    };
    for (const [id, request] of this.requests) {
      const { usd, certain } = this.costOf(request);
      if (this.inFlight.has(id)) {
        summary.inFlightRequests += 1;
        summary.uncertainUsd += usd;
        continue;
      }
      if (certain) summary.settledUsd += usd;
      else {
        summary.uncertainUsd += usd;
        summary.uncertainRequests += 1;
      }
      if (request.end?.event === 'settled' && request.end.billedUsd !== null) {
        summary.billedRequests += 1;
      }
    }
    return summary;
  }

  /** Why a request that could cost `worst` can't be sent now, or null when it can. */
  private refusal(worst: number): string | null {
    const held = this.total();
    if (held + worst <= this.cap + 1e-9) return null;
    return `${CREDIT_REFUSAL} (${money(this.cap)}) is used up: ${money(held)} is paid or held for requests in flight, and the next request could cost up to ${money(worst)}. Nothing more goes to the hosted student; raise --student-usd in a new output folder to go on.`;
  }

  private now(): string {
    return new Date(this.clock.now()).toISOString();
  }

  private settle(id: string, usage: Usage, billed: number | undefined, pricing: TokenPricing) {
    this.write({
      event: 'settled',
      id,
      at: this.now(),
      usage,
      billedUsd: billed ?? null,
      listedUsd: usage.inputTokens > 0 ? costUsd(pricing, usage) : null,
    });
  }

  private fail(id: string, error: string, unbilled: boolean): void {
    this.write({ event: 'failed', id, at: this.now(), error, unbilled });
  }

  /**
   * The hosted student, with every request reserved against the cap and written to the journal
   * before it is sent, and settled when its reply ends. A student whose price isn't known sends
   * nothing: its spending couldn't be held to the cap.
   */
  guard(student: StudentAdapter, pricing: TokenPricing | undefined): StudentAdapter {
    return {
      label: student.label,
      model: student.model,
      baseUrl: student.baseUrl,
      isLocal: student.isLocal,
      contextLength: student.contextLength,
      chat: (request, signal) => this.chat(student, pricing, request, signal),
      describe: () => student.describe(),
      testConnection: () => student.testConnection(),
      release: () => student.release(),
    };
  }

  private async *chat(
    student: StudentAdapter,
    pricing: TokenPricing | undefined,
    request: StudentChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StudentStreamEvent> {
    if (pricing === undefined) {
      throw new AdapterError(
        'quota',
        `${CREDIT_REFUSAL} can't be held to its cap: ${student.model} has no known price.`,
      );
    }
    const worst = worstCaseUsd(request, pricing, this.factor);
    const refused = this.refusal(worst);
    if (refused !== null) throw new AdapterError('quota', refused);
    const id = newId('req');
    this.write({ event: 'sent', id, at: this.now(), model: student.model, worstUsd: worst });
    this.inFlight.add(id);
    let received = false;
    let ended = false;
    try {
      for await (const event of student.chat(request, signal)) {
        if (event.type === 'done') {
          this.settle(id, event.usage, event.costUsd, pricing);
          ended = true;
        } else {
          received = true;
        }
        yield event;
      }
      if (!ended) this.fail(id, 'The reply ended without saying what it used.', false);
      ended = true;
    } catch (error) {
      if (!ended) this.fail(id, errorMessage(error), refusedUnbilled(error, received));
      ended = true;
      throw error;
    } finally {
      // The reader stopped before the reply ended: whatever was generated may be billed.
      if (!ended) this.fail(id, 'The request was abandoned before its reply ended.', false);
      this.inFlight.delete(id);
    }
  }
}
