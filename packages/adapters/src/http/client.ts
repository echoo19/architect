import { AdapterError } from '@architect/shared';
import type { z } from 'zod';
import { readChunks, readText } from './body';
import { badResponse, HttpError } from './errors';
import { describeErrorBody, failureForStatus, parseRetryAfter, redact } from './failures';
import { RequestGuard } from './guard';
import { withRetries, type RetryOptions } from './retry';

export interface Timeouts {
  /** Longest wait for the response to begin. */
  headersMs: number;
  /** Longest silence between pieces of a streamed reply. */
  idleMs: number;
}

/**
 * A local model may load from disk and read a long prompt before its first byte, and a
 * reasoning model can think for minutes without sending anything, so these are generous.
 */
const STREAM_TIMEOUTS: Timeouts = { headersMs: 300_000, idleMs: 300_000 };

const QUICK_TIMEOUT_MS = 15_000;
const ERROR_BODY_LIMIT = 64 * 1024;

export interface HttpClientOptions {
  baseUrl: string;
  /** Who is on the other end, as a person would name it. Used in error messages. */
  service: string;
  /** Sent with every request. Holds the credentials, so it is never logged or put in errors. */
  headers?: Record<string, string>;
  /** Values that must not appear in an error message, such as the API key. */
  secrets?: readonly string[];
  /** What to suggest when the server says the model doesn't exist. */
  modelNotFoundHint?: string;
  fetch?: typeof fetch;
  /** Limits for streamed replies. */
  timeouts?: Partial<Timeouts>;
  retry?: RetryOptions;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** The model the request is for, named in "not found" errors. */
  model?: string;
  /** Whole-request limit for JSON calls (default 15 s). Streams use the client's timeouts. */
  timeoutMs?: number;
  accept?: string;
}

/** A streamed reply. Always `close()` it: stopping early is what cancels the request. */
export interface StreamHandle extends AsyncIterable<Uint8Array> {
  close(): void;
}

export interface HttpClient {
  getJson<S extends z.ZodType>(
    path: string,
    schema: S,
    request?: RequestOptions,
  ): Promise<z.output<S>>;
  postJson<S extends z.ZodType>(
    path: string,
    body: unknown,
    schema: S,
    request?: RequestOptions,
  ): Promise<z.output<S>>;
  /** POSTs and resolves once the server has started answering with a success status. */
  openStream(path: string, body: unknown, request?: RequestOptions): Promise<StreamHandle>;
  /** Runs `operation` again after backoff while it fails with a retryable error. */
  withRetries<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

type Method = 'GET' | 'POST';

export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { service } = options;
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  // Looked up on every call, so a network guard that wraps the global fetch after this client
  // was built still applies to it.
  const fetchImpl: typeof fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const secrets = options.secrets ?? [];
  const streamTimeouts: Timeouts = { ...STREAM_TIMEOUTS, ...options.timeouts };

  async function send(
    method: Method,
    path: string,
    body: unknown,
    request: RequestOptions,
    timeouts: Timeouts,
  ): Promise<{ response: Response; guard: RequestGuard }> {
    const guard = new RequestGuard(request.signal, service);
    try {
      guard.arm(timeouts.headersMs);
      const response = await fetchImpl(baseUrl + path, {
        method,
        headers: {
          accept: request.accept ?? 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...options.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: guard.signal,
      });
      guard.disarm();
      if (!response.ok) throw await rejection(response, guard, request, timeouts);
      return { response, guard };
    } catch (error) {
      const failure = guard.classify(error);
      guard.close();
      throw failure;
    }
  }

  async function rejection(
    response: Response,
    guard: RequestGuard,
    request: RequestOptions,
    timeouts: Timeouts,
  ): Promise<HttpError> {
    const body = await errorBody(response, guard, timeouts.idleMs);
    const retryAfterMs = parseRetryAfter(response.headers);
    const failure = failureForStatus(response.status, {
      service,
      model: request.model,
      modelNotFoundHint: options.modelNotFoundHint,
      detail: body.message === undefined ? undefined : redact(body.message, secrets),
      serverCode: body.code,
      retryAfterMs,
    });
    return new HttpError(failure, { status: response.status, retryAfterMs });
  }

  async function errorBody(response: Response, guard: RequestGuard, idleMs: number) {
    try {
      return describeErrorBody(await readText(response, guard, idleMs, ERROR_BODY_LIMIT));
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'aborted') throw error;
      // The status already says what failed; the body would only have added detail.
      return {};
    }
  }

  async function requestJson<S extends z.ZodType>(
    method: Method,
    path: string,
    body: unknown,
    schema: S,
    request: RequestOptions,
  ): Promise<z.output<S>> {
    const limit = request.timeoutMs ?? QUICK_TIMEOUT_MS;
    const { response, guard } = await send(method, path, body, request, {
      headersMs: limit,
      idleMs: limit,
    });
    try {
      return parseBody(await readText(response, guard, limit), schema);
    } finally {
      guard.close();
    }
  }

  function parseBody<S extends z.ZodType>(text: string, schema: S): z.output<S> {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (cause) {
      throw badResponse(service, "a reply Architect couldn't read", cause);
    }
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw badResponse(service, 'a reply in an unexpected shape', parsed.error);
    return parsed.data;
  }

  return {
    getJson: (path, schema, request = {}) => requestJson('GET', path, undefined, schema, request),
    postJson: (path, body, schema, request = {}) =>
      requestJson('POST', path, body, schema, request),
    async openStream(path, body, request = {}) {
      const { response, guard } = await send('POST', path, body, request, streamTimeouts);
      return {
        [Symbol.asyncIterator]: () => readChunks(response, guard, streamTimeouts.idleMs),
        close: () => guard.close(),
      };
    },
    withRetries: (operation, signal) => withRetries(operation, options.retry, signal),
  };
}
