import {
  AdapterError,
  type StudentAdapter,
  type StudentChatRequest,
  type StudentStreamEvent,
} from '@architect/shared';
import type { Clock } from '../loop/deps';
import { errorMessage } from '../loop/errors';

/** The words every refusal of the GPU window starts with, so a run paused by it is told apart. */
export const GPU_REFUSAL = 'The GPU window';

export interface GpuWindowOptions {
  /** The minutes this command may use this computer's GPU, from its first local request. */
  minutes: number;
  clock: Clock;
  /** Frees the GPU: stops llama-server and unloads Ollama's models. */
  release(): Promise<void>;
  log(line: string): void;
}

/**
 * The owner's GPU window as a hard stop (decision 051): this command may use this computer's GPU
 * for the minutes granted, counted from its first local request. When they are up, every local
 * request in flight is stopped and refused as a runtime failure, so no attempt it cut is scored,
 * no local request starts again, and the GPU is freed. Runs it stopped keep what they finished and
 * go on in a later window. With no minutes granted, nothing runs on the GPU at all.
 */
export class GpuWindow {
  private readonly stop = new AbortController();
  private openedAt: number | null = null;
  private closed: string | null = null;

  constructor(private readonly options: GpuWindowOptions) {}

  /** Why local work can't run now, or null while the window is open or not opened yet. */
  refusal(): string | null {
    if (this.options.minutes <= 0) {
      return `${GPU_REFUSAL} granted to this command is 0 minutes, so nothing runs on this computer's GPU. Run again with --gpu-minutes when the owner grants a window.`;
    }
    return this.closed;
  }

  /** Lets a local request start, opening the window at the first; throws once it has closed. */
  private admit(): void {
    const refused = this.refusal();
    if (refused !== null) throw new AdapterError('quota', refused);
    if (this.openedAt !== null) return;
    const { minutes, clock, log } = this.options;
    this.openedAt = clock.now();
    log(`${GPU_REFUSAL} opens: ${minutes} minutes from now.`);
    clock.timeout(minutes * 60_000).addEventListener(
      'abort',
      () => {
        void this.close();
      },
      { once: true },
    );
  }

  /** Ends the window: stops what runs locally, refuses what comes next, and frees the GPU. */
  async close(): Promise<void> {
    if (this.closed !== null || this.openedAt === null) return;
    const { minutes, clock, log } = this.options;
    this.closed = `${GPU_REFUSAL} granted to this command (${minutes} minutes from ${new Date(this.openedAt).toISOString()}) ended at ${new Date(clock.now()).toISOString()}. Local work stopped there and goes on in a later window.`;
    this.stop.abort(new AdapterError('quota', this.closed));
    log(this.closed);
    try {
      await this.options.release();
    } catch (error) {
      log(`The GPU couldn't be freed after the window: ${errorMessage(error)}`);
    }
  }

  /**
   * A student on this computer, held to the window: a request starts only while it is open, and
   * one in flight when it closes is stopped there and refused, never scored as a wrong answer.
   */
  guard(student: StudentAdapter): StudentAdapter {
    return {
      label: student.label,
      model: student.model,
      baseUrl: student.baseUrl,
      isLocal: student.isLocal,
      contextLength: student.contextLength,
      chat: (request, signal) => this.chat(student, request, signal),
      describe: () => student.describe(),
      testConnection: () => student.testConnection(),
      release: () => student.release(),
    };
  }

  private async *chat(
    student: StudentAdapter,
    request: StudentChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StudentStreamEvent> {
    this.admit();
    const stopped = this.stop.signal;
    const both = signal === undefined ? stopped : AbortSignal.any([signal, stopped]);
    try {
      for await (const event of student.chat(request, both)) {
        // A reply that ignores the signal still ends at the window: nothing after it counts.
        if (this.closed !== null) throw new AdapterError('quota', this.closed);
        yield event;
      }
    } catch (error) {
      if (this.closed !== null && signal?.aborted !== true) {
        throw new AdapterError('quota', this.closed);
      }
      throw error;
    }
  }
}
