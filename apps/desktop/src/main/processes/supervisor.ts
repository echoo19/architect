/** What a process reports about itself: it is serving, or it could not start and why. */
export type ProcessStatus = { type: 'ready' } | { type: 'failed'; message: string };

/** A connection that fails its waiting requests when closed. */
export interface Closable {
  close(): void;
}

/** One running background process and the connection to it. */
export interface SupervisedProcess<Client extends Closable> {
  readonly client: Client;
  onStatus(listener: (status: ProcessStatus) => void): void;
  onExit(listener: (code: number) => void): void;
  /** Asks the process to finish cleanly and exit. */
  requestStop(): void;
  kill(): void;
}

export interface SupervisorOptions<Client extends Closable> {
  /** The process as messages name it, e.g. "The engine". */
  name: string;
  launch(): SupervisedProcess<Client>;
  /** Called with every new connection, before any request goes over it. */
  onConnect?(client: Client): void;
  /** Called each time a process says it is serving. */
  onReady?(): void;
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

interface Link<Client extends Closable> {
  readonly process: SupervisedProcess<Client>;
  readonly startedAt: number;
  /** Set once the process is gone; requests it was answering failed with it. */
  lost: boolean;
}

/**
 * Keeps a background process running: starts it, restarts it with growing waits when it exits
 * unexpectedly, and stops it when the app quits. While it is down, every call fails at once with
 * a message that says what happened, instead of waiting on a process that isn't there.
 */
export class Supervisor<Client extends Closable> {
  private link: Link<Client> | null = null;
  private started = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private failuresInARow = 0;
  /** Why the last process couldn't start, until one starts. */
  private startFailure: string | null = null;
  /** Set before the process is asked to stop, so its exit is never mistaken for a crash. */
  private stopRequested = false;
  private stopped: Promise<void> | null = null;
  private readonly restartDelaysMs: readonly number[];
  private readonly stableAfterMs: number;
  private readonly stopTimeoutMs: number;

  constructor(private readonly options: SupervisorOptions<Client>) {
    this.restartDelaysMs = options.restartDelaysMs ?? RESTART_DELAYS_MS;
    this.stableAfterMs = options.stableAfterMs ?? STABLE_AFTER_MS;
    this.stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS;
  }

  /** Starts the process. Calling it again while it runs or waits to restart does nothing. */
  start(): void {
    if (this.started || this.stopRequested) return;
    this.started = true;
    this.launch();
  }

  /**
   * Sends one request. Requests made while the process starts wait for it; requests made while
   * it is down, or that it was answering when it exited, fail with a clear reason.
   */
  async call<T>(request: (client: Client) => Promise<T>): Promise<T> {
    const link = this.link;
    if (!link || this.stopRequested) throw new Error(this.unavailable(false));
    try {
      return await request(link.process.client);
    } catch (error) {
      if (!link.lost) throw error;
      throw new Error(this.unavailable(true), { cause: error });
    }
  }

  /** Closes the process cleanly, or kills it if it takes too long. Nothing restarts after this. */
  stop(): Promise<void> {
    if (!this.stopped) {
      this.stopRequested = true;
      this.stopped = this.shutdown();
    }
    return this.stopped;
  }

  /** Why a request can't be answered; `lost` when the process went away while answering it. */
  private unavailable(lost: boolean): string {
    const { name } = this.options;
    if (this.stopRequested) return `${name} has stopped because Architect is closing.`;
    if (!this.started) return `${name} is starting. Try again in a moment.`;
    if (this.startFailure) {
      return `${name} couldn't start: ${this.startFailure} Architect keeps trying in the background.`;
    }
    return lost
      ? `${name} stopped while it was working on this. It is restarting; try again in a moment.`
      : `${name} stopped unexpectedly and is restarting. Try again in a moment.`;
  }

  private launch(): void {
    let child: SupervisedProcess<Client>;
    try {
      child = this.options.launch();
    } catch (error) {
      this.startFailure = error instanceof Error ? error.message : String(error);
      this.scheduleRestart();
      return;
    }
    const link: Link<Client> = { process: child, startedAt: Date.now(), lost: false };
    child.onStatus((status) => {
      if (status.type === 'ready') {
        this.startFailure = null;
        this.options.onReady?.();
        return;
      }
      this.startFailure = status.message;
      child.kill();
    });
    child.onExit((code) => this.exited(link, code));
    this.link = link;
    this.options.onConnect?.(child.client);
  }

  private exited(link: Link<Client>, code: number): void {
    link.lost = true;
    link.process.client.close();
    if (this.link === link) this.link = null;
    if (this.stopRequested) return;
    console.error(`${this.options.name} process exited unexpectedly (code ${code}).`);
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
