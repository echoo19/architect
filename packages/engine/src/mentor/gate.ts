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

/** A piece of a mentor payload with where it came from, so a refusal can say where it matched. */
export interface PayloadPart {
  /** The origin, such as `train task invoice-012` or `data file policy.md`. */
  label: string;
  text: string;
}

/** The gate refused a call because its payload matched the locked test. It holds no test content. */
export class LeakRefusal extends GuardError {
  constructor(message: string) {
    super('split', message);
  }
}

export interface GatedCallOptions {
  signal?: AbortSignal;
  /** The payload's parts by origin, so a refused call can name the parts that matched. */
  parts?: readonly PayloadPart[];
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

/** Parts a refusal names before it only counts the rest. */
const NAMED_PARTS = 3;

/** `a`, `a and b`, `a, b and c`, then `a, b, c and 2 more parts`. */
function listed(labels: readonly string[]): string {
  const shown =
    labels.length > NAMED_PARTS + 1
      ? [...labels.slice(0, NAMED_PARTS), `${labels.length - NAMED_PARTS} more parts`]
      : [...labels];
  const last = shown.pop() ?? '';
  return shown.length === 0 ? last : `${shown.join(', ')} and ${last}`;
}

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
      throw this.refuse(
        new GuardError(
          'split',
          'The mentor was released for the locked test; no mentor call can start.',
        ),
      );
    }
    const text = payloadText(request);
    const scan = this.options.leakDetector.scan(text);
    if (scan.leaked) {
      throw this.refuse(
        new LeakRefusal(this.leakMessage(scan.matchedIds.length, options.parts ?? [])),
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

  /** How many test tasks matched and in which parts of the payload, by label only. */
  private leakMessage(matched: number, parts: readonly PayloadPart[]): string {
    const tasks = matched === 1 ? 'task' : 'tasks';
    const sources = parts
      .filter((part) => this.options.leakDetector.scan(part.text).leaked)
      .map((part) => part.label);
    const where = sources.length > 0 ? `, in ${listed(sources)}` : '';
    return `Refused a mentor call: its payload matched ${matched} locked test ${tasks}${where}.`;
  }

  private refuse<E extends GuardError>(error: E): E {
    this.options.onRefusal(error.message);
    return error;
  }
}
