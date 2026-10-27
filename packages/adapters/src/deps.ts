import type { TokenPricing } from '@architect/shared';
import type { Timeouts } from './http/client';
import type { RetryOptions } from './http/retry';

/** What every adapter accepts besides its configuration. All of it exists so tests can run offline. */
export interface AdapterDeps {
  /** Replaces the global `fetch`; tests use it to send requests to a local server. */
  fetch?: typeof fetch;
  retry?: RetryOptions;
  /** Limits for streamed replies: time to the first byte and silence between chunks. */
  timeouts?: Partial<Timeouts>;
}

export interface MentorDeps extends AdapterDeps {
  /** Read from the app's secret store by the caller. It is sent to the provider and never logged. */
  apiKey: string;
  /** Defaults to the price of the preset that matches the config; with neither, cost is null. */
  pricing?: TokenPricing;
  /** Ties one job's calls together for the provider's caching and routing. Default: a fresh id. */
  sessionKey?: string;
}

export interface StudentDeps extends AdapterDeps {
  /** For hosted endpoints, and for a local server started with `--api-key`. */
  apiKey?: string;
  /** What the app calls this endpoint. Default: the runtime or host name. */
  label?: string;
}
