import {
  GuardError,
  type ChatMessage,
  type MentorAdapter,
  type MentorCompletion,
  type MentorCompletionRequest,
} from '@architect/shared';

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

  /**
   * `onSend` runs once every check has passed, just before the request leaves, so nothing about
   * a refused call is announced or written anywhere.
   */
  async complete(
    adapter: MentorAdapter,
    request: MentorCompletionRequest,
    options: { signal?: AbortSignal; onSend?(): void } = {},
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
    const maxUsd = adapter.estimateCostUsd({
      inputTokens: estimateInputTokens(text),
      outputTokens: request.maxOutputTokens,
    });
    const authorized = this.options.authorize(maxUsd);
    options.onSend?.();
    const completion = await adapter.complete(request, options.signal);
    const costUsd = completion.costUsd ?? adapter.estimateCostUsd(completion.usage) ?? authorized;
    return { completion, costUsd };
  }

  private refuse(message: string): GuardError {
    this.options.onRefusal(message);
    return new GuardError('split', message);
  }
}
