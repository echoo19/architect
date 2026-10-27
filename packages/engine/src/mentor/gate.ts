import {
  GuardError,
  UsageSchema,
  type ChatMessage,
  type MentorAdapter,
  type MentorCompletion,
  type MentorCompletionRequest,
  type Usage,
} from '@architect/shared';
import { z } from 'zod';

export interface LeakScan {
  leaked: boolean;
  matchedIds: string[];
}

/** Matches text against fingerprints of the locked test tasks. Built by the vault. */
export interface LeakDetector {
  scan(text: string): LeakScan;
}

export interface MentorGateOptions {
  leakDetector: LeakDetector;
  /**
   * Throws `GuardError('budget')` when a call that could cost up to `maxUsd` must not start;
   * otherwise returns the authorized amount.
   */
  authorize(maxUsd: number | null): number;
  /** Told about every refused call, so the refusal is logged where the user can see it. */
  onRefusal(message: string): void;
}

export interface GatedCompletion {
  completion: MentorCompletion;
  /** What the call is charged against the budget. */
  costUsd: number;
}

/** What a call cost, including one that failed after the provider had already charged for it. */
export interface MentorCharge {
  model: string;
  usage: Usage;
  costUsd: number;
}

export interface GatedCallOptions {
  signal?: AbortSignal;
  /** Runs once every check has passed, just before the request leaves. */
  onSend?(): void;
  /** Runs when a call fails but reports what it spent, so the spend still counts. */
  onSpent?(charge: MentorCharge): void;
}

/** Adapters attach the spend to an error when the provider charged for an unusable reply. */
const SpentSchema = z.object({
  usage: UsageSchema,
  costUsd: z.number().nonnegative().nullable(),
});

/** What a correction message adds when an adapter asks the mentor to repair malformed JSON. */
const REPAIR_OVERHEAD_TOKENS = 1_000;

function messageText(message: ChatMessage): string {
  if (message.role !== 'assistant' || !message.toolCalls?.length) return message.content;
  return [message.content, ...message.toolCalls.map((call) => JSON.stringify(call))].join('\n');
}

/** Everything a mentor call would send, as one text, for the leak scan and the size estimate. */
export function payloadText(request: MentorCompletionRequest): string {
  const parts = [request.system, ...request.messages.map(messageText)];
  if (request.json) parts.push(JSON.stringify(request.json));
  return parts.join('\n\n');
}

/** A deliberately high estimate: three bytes per token, where English text averages about four. */
export function estimateInputTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3);
}

/**
 * The most a call could cost, or null when the price is unknown. A JSON request can take two
 * model calls, because the adapter asks once more when the reply isn't valid JSON, and the
 * second sees the first reply as well.
 */
export function worstCaseUsd(
  adapter: MentorAdapter,
  request: MentorCompletionRequest,
  inputTokens: number,
): number | null {
  const first = adapter.estimateCostUsd({ inputTokens, outputTokens: request.maxOutputTokens });
  if (first === null || !request.json) return first;
  const repair = adapter.estimateCostUsd({
    inputTokens: inputTokens + request.maxOutputTokens + REPAIR_OVERHEAD_TOKENS,
    outputTokens: request.maxOutputTokens,
  });
  return repair === null ? null : first + repair;
}

/**
 * The only way the loop reaches a mentor. Before a call starts it checks, in order: the mentor
 * hasn't been released for the locked test, the payload carries nothing from the test split,
 * and the most the call could cost fits in the budget.
 */
export class MentorGate {
  private released = false;

  constructor(private readonly options: MentorGateOptions) {}

  /** After this, every call is refused: the locked test is about to run. */
  release(): void {
    this.released = true;
  }

  async complete(
    adapter: MentorAdapter,
    request: MentorCompletionRequest,
    options: GatedCallOptions = {},
  ): Promise<GatedCompletion> {
    if (this.released) {
      throw this.refuse('The mentor was released for the locked test; no mentor call can start.');
    }
    const text = payloadText(request);
    const scan = this.options.leakDetector.scan(text);
    if (scan.leaked) {
      const tasks = scan.matchedIds.length === 1 ? 'task' : 'tasks';
      throw this.refuse(
        `Refused a mentor call: its payload matched ${scan.matchedIds.length} locked test ${tasks}.`,
      );
    }
    const authorized = this.options.authorize(
      worstCaseUsd(adapter, request, estimateInputTokens(text)),
    );
    const charge = (usage: Usage, reported: number | null): number =>
      reported ?? adapter.estimateCostUsd(usage) ?? authorized;

    options.onSend?.();
    let completion: MentorCompletion;
    try {
      completion = await adapter.complete(request, options.signal);
    } catch (error) {
      const spent = SpentSchema.safeParse(error);
      if (spent.success) {
        const { usage, costUsd } = spent.data;
        options.onSpent?.({ model: adapter.model, usage, costUsd: charge(usage, costUsd) });
      }
      throw error;
    }
    return { completion, costUsd: charge(completion.usage, completion.costUsd) };
  }

  private refuse(message: string): GuardError {
    this.options.onRefusal(message);
    return new GuardError('split', message);
  }
}
