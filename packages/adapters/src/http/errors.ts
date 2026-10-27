import { AdapterError, type ConnectionTest } from '@architect/shared';
import type { Failure } from './failures';

const CANCELLED_MESSAGE = 'The request was cancelled.';

/**
 * An `AdapterError` that remembers how it was phrased. The message is `summary` plus `hint`, and
 * connection tests show the two apart. `retryAfterMs` is the wait the server asked for, if any.
 */
export class HttpError extends AdapterError {
  readonly summary: string;
  readonly hint?: string;
  readonly retryAfterMs?: number;

  constructor(
    failure: Failure,
    options: { status?: number; retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(failure.code, failure.hint ? `${failure.summary} ${failure.hint}` : failure.summary, {
      status: options.status,
      cause: options.cause,
    });
    this.summary = failure.summary;
    if (failure.hint !== undefined) this.hint = failure.hint;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}

export function cancelled(): AdapterError {
  return new AdapterError('aborted', CANCELLED_MESSAGE);
}

/** The server answered, but not with anything this adapter can use. */
export function badResponse(service: string, what: string, cause?: unknown): HttpError {
  return new HttpError({ code: 'bad_response', summary: `${service} sent ${what}.` }, { cause });
}

/** The server went away before the reply was complete. */
export function cutOff(service: string): HttpError {
  return new HttpError({
    code: 'network',
    summary: `${service} closed the connection before the reply was finished.`,
    hint: 'Try again.',
  });
}

type ConnectionFailure = Extract<ConnectionTest, { ok: false }>;

/**
 * Turns a failed request into the result of a connection test. Anything that isn't an
 * `AdapterError` is a bug in this package and keeps propagating.
 */
export function connectionFailure(error: unknown): ConnectionFailure {
  if (error instanceof HttpError) {
    return error.hint
      ? { ok: false, error: error.summary, hint: error.hint }
      : { ok: false, error: error.summary };
  }
  if (error instanceof AdapterError) return { ok: false, error: error.message };
  throw error;
}
