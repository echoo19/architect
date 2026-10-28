import type { TokenPricing } from '@architect/shared';
import type { Timeouts } from './http/client';
import type { RetryOptions } from './http/retry';

/** Overrides for what an adapter would otherwise fix for itself. Tests use them to stay offline and fast. */
export interface AdapterDeps {
  /** Replaces the global `fetch`; tests use it to send requests to a local server. */
  fetch?: typeof fetch;
  /** Attempts, backoff and the sleep between them. */
  retry?: RetryOptions;
  /** Limits for streamed replies: time to the first byte and silence between chunks. */
  timeouts?: Partial<Timeouts>;
}

export interface MentorDeps extends AdapterDeps {
  /**
   * Read from the app's secret store by the caller. It is sent to the provider and never logged.
   * A model on this computer needs none.
   */
  apiKey?: string;
  /**
   * Defaults to the price saved with the config, else its preset's, else free for a model on
   * this computer; with none of them, cost is null.
   */
  pricing?: TokenPricing;
  /** Ties one job's calls together for the provider's caching and routing. Default: a fresh id. */
  sessionKey?: string;
}

export interface StudentDeps extends AdapterDeps {
  /** For hosted endpoints, and for a local server started with `--api-key`. */
  apiKey?: string;
  /**
   * The most CPU threads a local runtime may use for this model; its own default when absent.
   * Fewer threads keep the computer cooler and quieter at the cost of speed.
   */
  cpuThreads?: number;
  /**
   * How long a local runtime rests after each reply, as a share of the time the reply took: 0.75
   * rests three quarters as long. The GPU then draws less on average, so it runs cooler and
   * quieter. No rest when absent.
   */
  cooldown?: number;
  /** Waits out a rest, or until the signal aborts. Tests replace it to stay fast. */
  rest?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** What the app calls this endpoint. Default: the runtime or host name. */
  label?: string;
}
