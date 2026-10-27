import { describe, expect, it } from 'vitest';
import {
  describeErrorBody,
  failureForNetworkError,
  failureForStatus,
  parseRetryAfter,
  redact,
} from '../../src/http/failures';

const service = 'Meta';

describe('failureForStatus', () => {
  it.each([
    [401, 'auth', /didn't accept the API key/, /Settings/],
    [403, 'auth', /won't let this key/, /Settings/],
    [402, 'quota', /no credit or no billing/, /Add credit/],
    [408, 'timeout', /gave up waiting/, /Try again/],
    [413, 'bad_request', /too large/, /Shorten/],
    [429, 'rate_limit', /rate limiting/, /try again/],
    [500, 'server', /problem on its side/, /temporary/],
    [503, 'server', /problem on its side/, /temporary/],
    [504, 'server', /gave up waiting for the model/, /reasoning effort/],
  ] as const)('maps %i to %s', (status, code, summary, hint) => {
    const failure = failureForStatus(status, { service });
    expect(failure.code).toBe(code);
    expect(failure.summary).toMatch(summary);
    expect(failure.summary).toContain(`HTTP ${status}`);
    expect(failure.hint).toMatch(hint);
  });

  it('names the model in a 404 and suggests the caller-supplied fix', () => {
    const plain = failureForStatus(404, { service, model: 'muse-x' });
    expect(plain).toMatchObject({ code: 'not_found' });
    expect(plain.summary).toContain('"muse-x"');
    expect(plain.hint).toContain('model id');

    const custom = failureForStatus(404, {
      service: 'Ollama',
      model: 'muse-x',
      modelNotFoundHint: 'Pull muse-x first.',
    });
    expect(custom.hint).toBe('Pull muse-x first.');
  });

  it('blames the address, not a model, when the request names none', () => {
    const failure = failureForStatus(404, { service });
    expect(failure.summary).toContain('nothing at that address');
    expect(failure.hint).toContain('base URL');
  });

  it('quotes the server for rejected requests and server errors', () => {
    const rejected = failureForStatus(400, { service, detail: "Unsupported parameter: 'stop'" });
    expect(rejected).toMatchObject({ code: 'bad_request' });
    expect(rejected.summary).toBe(
      "Meta rejected the request (HTTP 400). Unsupported parameter: 'stop'.",
    );
    expect(failureForStatus(502, { service, detail: 'Upstream is down.' }).summary).toContain(
      'Upstream is down.',
    );
  });

  it('reports a policy violation as blocked, not as a bad request', () => {
    const failure = failureForStatus(400, {
      service,
      serverCode: 'content_policy_violation',
      detail: 'Image rejected',
    });
    expect(failure.code).toBe('blocked');
  });

  it('says how long a rate limit asked for', () => {
    expect(failureForStatus(429, { service, retryAfterMs: 30_000 }).hint).toBe(
      'It asked for a wait of 30 seconds.',
    );
    expect(failureForStatus(429, { service, retryAfterMs: 400 }).hint).toBe(
      'It asked for a wait of 1 second.',
    );
  });

  it('treats other client errors as bad requests and odd statuses as bad responses', () => {
    expect(failureForStatus(422, { service }).code).toBe('bad_request');
    expect(failureForStatus(302, { service }).code).toBe('bad_response');
  });
});

describe('failureForNetworkError', () => {
  const wrapped = (code: string) => new TypeError('fetch failed', { cause: { code } });

  it('says when nothing is listening', () => {
    const failure = failureForNetworkError(wrapped('ECONNREFUSED'), 'Ollama');
    expect(failure).toMatchObject({ code: 'network' });
    expect(failure.summary).toBe("Couldn't connect to Ollama.");
  });

  it('says when the host cannot be found', () => {
    expect(failureForNetworkError(wrapped('ENOTFOUND'), 'api.meta.ai').summary).toContain(
      "Couldn't find api.meta.ai",
    );
  });

  it('treats undici timeouts as timeouts', () => {
    expect(failureForNetworkError(wrapped('UND_ERR_HEADERS_TIMEOUT'), service).code).toBe(
      'timeout',
    );
  });

  it('explains certificate problems', () => {
    const failure = failureForNetworkError(wrapped('CERT_HAS_EXPIRED'), service);
    expect(failure.code).toBe('network');
    expect(failure.summary).toContain('secure connection');
  });

  it('reports a malformed address as a bad request', () => {
    expect(failureForNetworkError(wrapped('ERR_INVALID_URL'), service).code).toBe('bad_request');
  });

  it('falls back to a dropped connection', () => {
    expect(failureForNetworkError(new Error('socket hang up'), service).summary).toContain(
      'dropped',
    );
  });
});

describe('describeErrorBody', () => {
  it('reads the OpenAI error shape', () => {
    expect(
      describeErrorBody(
        '{"error":{"message":"Bad parameter","type":"invalid_request_error","code":null}}',
      ),
    ).toEqual({ message: 'Bad parameter', code: 'invalid_request_error' });
    expect(describeErrorBody('{"error":{"message":"x","code":"model_not_found"}}')).toEqual({
      message: 'x',
      code: 'model_not_found',
    });
  });

  it('reads a numeric code', () => {
    expect(describeErrorBody('{"error":{"message":"Slow down","code":429}}').code).toBe('429');
  });

  it('reads Ollama and FastAPI shapes', () => {
    expect(describeErrorBody('{"error":"model \'x\' not found"}')).toEqual({
      message: "model 'x' not found",
    });
    expect(describeErrorBody('{"detail":[{"msg":"field required"},{"msg":"bad type"}]}')).toEqual({
      message: 'field required; bad type',
    });
    expect(describeErrorBody('{"message":"Forbidden"}')).toEqual({ message: 'Forbidden' });
  });

  it('keeps short plain text and ignores HTML and empty bodies', () => {
    expect(describeErrorBody('Service Unavailable')).toEqual({ message: 'Service Unavailable' });
    expect(describeErrorBody('<html><body>502</body></html>')).toEqual({});
    expect(describeErrorBody('   ')).toEqual({});
    expect(describeErrorBody('{"unrelated":true}')).toEqual({});
  });

  it('flattens whitespace and caps the length', () => {
    const message = describeErrorBody(JSON.stringify({ message: `a\n\n${'b'.repeat(500)}` }));
    expect(message.message).toMatch(/^a b+…$/);
    expect(message.message?.length).toBe(300);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');

  it('reads seconds, including fractions', () => {
    expect(parseRetryAfter(new Headers({ 'retry-after': '3' }), now)).toBe(3000);
    expect(parseRetryAfter(new Headers({ 'retry-after': '0.5' }), now)).toBe(500);
  });

  it('reads an HTTP date and never goes negative', () => {
    expect(
      parseRetryAfter(new Headers({ 'retry-after': 'Mon, 27 Oct 2026 12:00:07 GMT' }), now),
    ).toBe(7000);
    expect(
      parseRetryAfter(new Headers({ 'retry-after': 'Mon, 27 Oct 2026 11:59:00 GMT' }), now),
    ).toBe(0);
  });

  it('prefers retry-after-ms when both are present', () => {
    const headers = new Headers({ 'retry-after-ms': '250', 'retry-after': '9' });
    expect(parseRetryAfter(headers, now)).toBe(250);
  });

  it('ignores junk and absence', () => {
    expect(parseRetryAfter(new Headers(), now)).toBeUndefined();
    expect(parseRetryAfter(new Headers({ 'retry-after': 'soon' }), now)).toBeUndefined();
    expect(parseRetryAfter(new Headers({ 'retry-after-ms': 'x' }), now)).toBeUndefined();
  });
});

describe('redact', () => {
  it('removes every occurrence of a secret', () => {
    expect(redact('key sk-secret-123 and again sk-secret-123.', ['sk-secret-123'])).toBe(
      'key [redacted] and again [redacted].',
    );
  });

  it('leaves text alone when there is nothing to hide', () => {
    expect(redact('plain', [])).toBe('plain');
    expect(redact('plain', ['abc'])).toBe('plain');
  });
});
