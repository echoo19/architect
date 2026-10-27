import { AdapterError } from '@architect/shared';
import { cancelled, HttpError } from './errors';
import { failureForNetworkError, timeoutFailure } from './failures';

/**
 * Owns one request's lifetime: an abort controller joined with the caller's signal, and a
 * watchdog that cancels the request when it goes quiet. Whatever stopped the request, `classify`
 * says whether the caller cancelled, the server went silent, or the network failed.
 */
export class RequestGuard {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly external: AbortSignal | undefined;
  private readonly service: string;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private silentMs: number | undefined;
  private closed = false;

  constructor(external: AbortSignal | undefined, service: string) {
    this.external = external;
    this.service = service;
    this.signal = external
      ? AbortSignal.any([external, this.controller.signal])
      : this.controller.signal;
  }

  /** Cancels the request if nothing happens for `ms`. Arming again replaces the previous timer. */
  arm(ms: number): void {
    this.disarm();
    this.timer = setTimeout(() => {
      this.silentMs = ms;
      this.controller.abort();
    }, ms);
  }

  disarm(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Stops the request and frees its timer. Safe to call more than once. */
  close(): void {
    this.closed = true;
    this.disarm();
    this.controller.abort();
  }

  classify(error: unknown): AdapterError {
    if (error instanceof AdapterError) return error;
    if (this.external?.aborted || this.closed) return cancelled();
    if (this.silentMs !== undefined) {
      return new HttpError(timeoutFailure(this.service, this.silentMs), { cause: error });
    }
    return new HttpError(failureForNetworkError(error, this.service), { cause: error });
  }
}
