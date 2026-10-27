import {
  connectEngine,
  type EngineApi,
  type EngineClient,
  type EnginePort,
} from '@architect/engine';
import type { RunEvent } from '@architect/shared';
import { answerSecretLookups, type EngineStatus } from '../../utility/link';

/** One engine process, as the supervisor sees it. */
export interface EngineProcess {
  /** Engine requests, answers and run events. */
  readonly requests: EnginePort;
  /** The engine's secret lookups, which main answers. */
  readonly secrets: EnginePort;
  onStatus(listener: (status: EngineStatus) => void): void;
  onExit(listener: (code: number) => void): void;
  /** Asks the engine to close cleanly and exit. */
  requestStop(): void;
  kill(): void;
}

export interface EngineSupervisorOptions {
  launch(): EngineProcess;
  getSecret(ref: string): Promise<string | undefined>;
  onEvent(event: RunEvent): void;
  /** The wait before each restart in a row of failures; the last one repeats. */
  restartDelaysMs?: readonly number[];
  /** A process that ran at least this long before it failed starts the waits over. */
  stableAfterMs?: number;
  /** How long a clean stop may take before the process is killed. */
  stopTimeoutMs?: number;
}

const RESTART_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
const STABLE_AFTER_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;

interface Link {
  readonly process: EngineProcess;
  readonly client: EngineClient;
  readonly startedAt: number;
  /** Set once the process is gone; requests it was answering failed with it. */
  lost: boolean;
}

/**
 * Keeps the engine process running: starts it, restarts it with growing waits when it exits
 * unexpectedly, and stops it when the app quits. While it is down, every call fails at once
 * with a message that says what happened, instead of waiting on a process that isn't there.
 */
export class EngineSupervisor {
  private link: Link | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private failuresInARow = 0;
  /** Why the last process couldn't start, until one starts. */
  private startFailure: string | null = null;
  /** Set before the engine is asked to stop, so its exit is never mistaken for a crash. */
  private stopRequested = false;
  private stopped: Promise<void> | null = null;
  private readonly restartDelaysMs: readonly number[];
  private readonly stableAfterMs: number;
  private readonly stopTimeoutMs: number;

  constructor(private readonly options: EngineSupervisorOptions) {
    this.restartDelaysMs = options.restartDelaysMs ?? RESTART_DELAYS_MS;
    this.stableAfterMs = options.stableAfterMs ?? STABLE_AFTER_MS;
    this.stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  }

  start(): void {
    if (this.link || this.restartTimer || this.stopRequested) return;
    this.launch();
  }

  /**
   * Sends one request to the engine. Requests made while it starts wait for it; requests made
   * while it is down, or that it was answering when it exited, fail with a clear reason.
   */
  async call<T>(request: (api: EngineApi) => Promise<T>): Promise<T> {
    const link = this.link;
    if (!link || this.stopRequested) throw new Error(this.unavailable(false));
    try {
      return await request(link.client);
    } catch (error) {
      if (!link.lost) throw error;
      throw new Error(this.unavailable(true), { cause: error });
    }
  }

  /** Closes the engine cleanly, or kills it if it takes too long. Nothing restarts after this. */
  stop(): Promise<void> {
    if (!this.stopped) {
      this.stopRequested = true;
      this.stopped = this.shutdown();
    }
    return this.stopped;
  }

  /** Why a request can't be answered; `lost` when the engine went away while answering it. */
  private unavailable(lost: boolean): string {
    if (this.stopRequested) return 'The engine has stopped because Architect is closing.';
    if (this.startFailure) {
      return `The engine couldn't start: ${this.startFailure} Architect keeps trying in the background.`;
    }
    return lost
      ? 'The engine stopped while it was working on this. It is restarting; try again in a moment.'
      : 'The engine stopped unexpectedly and is restarting. Try again in a moment.';
  }

  private launch(): void {
    let child: EngineProcess;
    try {
      child = this.options.launch();
    } catch (error) {
      this.startFailure = error instanceof Error ? error.message : String(error);
      this.scheduleRestart();
      return;
    }
    const client = connectEngine(child.requests, (error) => console.error('[engine]', error));
    client.runs.onEvent((event) => this.options.onEvent(event));
    answerSecretLookups(child.secrets, this.options.getSecret);
    const link: Link = { process: child, client, startedAt: Date.now(), lost: false };
    child.onStatus((status) => {
      if (status.type === 'ready') {
        this.startFailure = null;
        return;
      }
      this.startFailure = status.message;
      child.kill();
    });
    child.onExit((code) => this.exited(link, code));
    this.link = link;
  }

  private exited(link: Link, code: number): void {
    link.lost = true;
    link.client.close();
    if (this.link === link) this.link = null;
    if (this.stopRequested) return;
    console.error(`[engine] The engine process exited unexpectedly (code ${code}).`);
    if (Date.now() - link.startedAt >= this.stableAfterMs) this.failuresInARow = 0;
    this.scheduleRestart();
  }

  private scheduleRestart(): void {
    const index = Math.min(this.failuresInARow, this.restartDelaysMs.length - 1);
    const delay = this.restartDelaysMs[index] ?? 0;
    this.failuresInARow += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.launch();
    }, delay);
  }

  private async shutdown(): Promise<void> {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    const link = this.link;
    if (!link) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        link.process.kill();
        resolve();
      }, this.stopTimeoutMs);
      link.process.onExit(() => {
        clearTimeout(timer);
        resolve();
      });
      link.process.requestStop();
    });
  }
}
