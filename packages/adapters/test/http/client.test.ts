import { AdapterError } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHttpClient, type HttpClient, type HttpClientOptions } from '../../src/http/client';
import { HttpError } from '../../src/http/errors';
import {
  openEventStream,
  pause,
  sendJson,
  startServer,
  stopServers,
  whenClosed,
  type FakeServer,
} from '../helpers/server';

afterEach(stopServers);

const API_KEY = 'sk-test-0123456789';

function clientFor(server: FakeServer, overrides: Partial<HttpClientOptions> = {}): HttpClient {
  return createHttpClient({
    baseUrl: `${server.url}/v1`,
    service: 'Testhost',
    headers: { authorization: `Bearer ${API_KEY}` },
    secrets: [API_KEY],
    retry: { sleep: async () => {}, random: () => 0 },
    ...overrides,
  });
}

async function caught(promise: Promise<unknown>): Promise<AdapterError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AdapterError);
  return error as AdapterError;
}

async function readAll(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = '';
  for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  return text;
}

const Pong = z.object({ pong: z.boolean() });

describe('JSON requests', () => {
  it('sends the credentials and parses the reply', async () => {
    const server = await startServer((_req, res) => sendJson(res, 200, { pong: true, extra: 1 }));
    const client = clientFor(server, { baseUrl: `${server.url}/v1/` });

    expect(await client.getJson('/ping', Pong)).toEqual({ pong: true });

    const [request] = server.requests;
    expect(request?.method).toBe('GET');
    expect(request?.path).toBe('/v1/ping');
    expect(request?.headers.authorization).toBe(`Bearer ${API_KEY}`);
    expect(request?.headers.accept).toBe('application/json');
  });

  it('posts a JSON body', async () => {
    const server = await startServer((_req, res) => sendJson(res, 200, { pong: true }));
    await clientFor(server).postJson('/echo', { hello: 'world' }, Pong);

    const [request] = server.requests;
    expect(request?.method).toBe('POST');
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.json()).toEqual({ hello: 'world' });
  });

  it('reports a reply that is not JSON, or has the wrong shape, as a bad response', async () => {
    const notJson = await startServer((_req, res) => {
      res.end('<html>nope</html>');
    });
    const wrongShape = await startServer((_req, res) => sendJson(res, 200, { pong: 'yes' }));

    expect(await caught(clientFor(notJson).getJson('/ping', Pong))).toMatchObject({
      code: 'bad_response',
    });
    expect(await caught(clientFor(wrongShape).getJson('/ping', Pong))).toMatchObject({
      code: 'bad_response',
    });
  });

  it('gives up on a server that never answers', async () => {
    const server = await startServer(() => {});
    const error = await caught(clientFor(server).getJson('/ping', Pong, { timeoutMs: 60 }));
    expect(error.code).toBe('timeout');
    expect(error.message).toContain('Testhost stopped responding');
  });
});

describe('error mapping', () => {
  it.each([
    [400, 'bad_request', false],
    [401, 'auth', false],
    [402, 'quota', false],
    [403, 'auth', false],
    [404, 'not_found', false],
    [413, 'bad_request', false],
    [429, 'rate_limit', true],
    [500, 'server', true],
    [503, 'server', true],
    [529, 'server', true],
  ] as const)('maps HTTP %i to %s', async (status, code, retryable) => {
    const server = await startServer((_req, res) =>
      sendJson(res, status, { error: { message: 'nope', type: 'some_error' } }),
    );
    const error = await caught(clientFor(server).getJson('/ping', Pong, { model: 'muse-x' }));
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
    expect(error.retryable).toBe(retryable);
  });

  it('tells the person to check the key in Settings', async () => {
    const server = await startServer((_req, res) => sendJson(res, 401, { error: 'bad key' }));
    for (const message of [
      (await caught(clientFor(server).getJson('/ping', Pong))).message,
      (await caught(clientFor(server).openStream('/chat', {}))).message,
    ]) {
      expect(message).toContain("Testhost didn't accept the API key (HTTP 401).");
      expect(message).toContain('Check the key in Settings.');
    }
  });

  it('names the missing model on a 404', async () => {
    const server = await startServer((_req, res) => sendJson(res, 404, {}));
    const error = await caught(
      clientFor(server, { modelNotFoundHint: 'Pull it first.' }).getJson('/ping', Pong, {
        model: 'muse-x',
      }),
    );
    expect(error.code).toBe('not_found');
    expect(error.message).toContain('"muse-x"');
    expect(error.message).toContain('Pull it first.');
  });

  it('quotes what the server said about a rejected request', async () => {
    const server = await startServer((_req, res) =>
      sendJson(res, 400, { error: { message: "Unsupported parameter: 'stop'", code: null } }),
    );
    const error = await caught(clientFor(server).openStream('/chat', {}));
    expect(error.message).toContain("Unsupported parameter: 'stop'.");
  });

  it('never repeats the API key, even when the server echoes it', async () => {
    const server = await startServer((_req, res) =>
      sendJson(res, 400, { error: { message: `Invalid key ${API_KEY} for this model` } }),
    );
    const error = await caught(clientFor(server).getJson('/ping', Pong));
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).toContain('[redacted]');
  });

  it('carries the wait the server asked for', async () => {
    const server = await startServer((_req, res) =>
      sendJson(res, 429, { error: { message: 'slow down' } }, { 'retry-after': '4' }),
    );
    const error = await caught(clientFor(server).getJson('/ping', Pong));
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).retryAfterMs).toBe(4000);
    expect(error.message).toContain('4 seconds');
  });

  it('still reports the status when the error body never finishes', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.write('{"error":');
    });
    const error = await caught(clientFor(server).getJson('/ping', Pong, { timeoutMs: 80 }));
    expect(error.code).toBe('server');
    expect(error.status).toBe(500);
  });

  it('says so when nothing is listening', async () => {
    const server = await startServer((_req, res) => sendJson(res, 200, {}));
    const client = clientFor(server);
    await stopServers();

    const error = await caught(client.getJson('/ping', Pong));
    expect(error.code).toBe('network');
    expect(error.message).toContain("Couldn't connect to Testhost.");
    expect(error.retryable).toBe(true);
  });
});

describe('streams', () => {
  it('delivers the body as it arrives', async () => {
    const server = await startServer(async (_req, res) => {
      openEventStream(res);
      res.write('data: one\n\n');
      await pause(15);
      res.end('data: two\n\n');
    });
    const stream = await clientFor(server).openStream('/chat', { stream: true });
    try {
      expect(await readAll(stream)).toBe('data: one\n\ndata: two\n\n');
    } finally {
      stream.close();
    }
    expect(server.requests[0]?.json()).toEqual({ stream: true });
  });

  it('asks for an event stream when told to', async () => {
    const server = await startServer((_req, res) => {
      res.end();
    });
    const stream = await clientFor(server).openStream('/chat', {}, { accept: 'text/event-stream' });
    stream.close();
    expect(server.requests[0]?.headers.accept).toBe('text/event-stream');
  });

  it('cancels the request when the stream is closed early', async () => {
    let closed: Promise<void> = Promise.resolve();
    const server = await startServer((_req, res) => {
      closed = whenClosed(res);
      openEventStream(res);
      res.write('data: first\n\n');
    });
    const stream = await clientFor(server).openStream('/chat', {});
    for await (const chunk of stream) {
      expect(new TextDecoder().decode(chunk)).toContain('first');
      break;
    }
    stream.close();
    await closed;
  });

  it('stops with "aborted" when the caller aborts mid-stream, and drops the connection', async () => {
    let closed: Promise<void> = Promise.resolve();
    const server = await startServer((_req, res) => {
      closed = whenClosed(res);
      openEventStream(res);
      res.write('data: first\n\n');
    });
    const controller = new AbortController();
    const stream = await clientFor(server).openStream('/chat', {}, { signal: controller.signal });
    try {
      const error = await caught(
        (async () => {
          for await (const _chunk of stream) controller.abort();
        })(),
      );
      expect(error.code).toBe('aborted');
      expect(error.retryable).toBe(false);
    } finally {
      stream.close();
    }
    await closed;
  });

  it('refuses to start when the signal is already aborted', async () => {
    const server = await startServer((_req, res) => sendJson(res, 200, {}));
    const error = await caught(
      clientFor(server).openStream('/chat', {}, { signal: AbortSignal.abort() }),
    );
    expect(error.code).toBe('aborted');
    expect(server.requests).toHaveLength(0);
  });

  it('times out when the server goes quiet mid-stream', async () => {
    const server = await startServer((_req, res) => {
      openEventStream(res);
      res.write('data: first\n\n');
    });
    const stream = await clientFor(server, { timeouts: { idleMs: 80 } }).openStream('/chat', {});
    try {
      const error = await caught(readAll(stream));
      expect(error.code).toBe('timeout');
      expect(error.message).toContain('Testhost stopped responding for 1 second.');
    } finally {
      stream.close();
    }
  });

  it('times out when the response never starts', async () => {
    const server = await startServer(() => {});
    const error = await caught(
      clientFor(server, { timeouts: { headersMs: 60 } }).openStream('/chat', {}),
    );
    expect(error.code).toBe('timeout');
  });

  it('does not count the consumer being slow as the server going quiet', async () => {
    const server = await startServer((_req, res) => {
      openEventStream(res);
      res.write('data: first\n\n');
      setTimeout(() => res.end('data: second\n\n'), 20);
    });
    const stream = await clientFor(server, { timeouts: { idleMs: 150 } }).openStream('/chat', {});
    try {
      let seen = '';
      for await (const chunk of stream) {
        seen += new TextDecoder().decode(chunk);
        await pause(250);
      }
      expect(seen).toContain('second');
    } finally {
      stream.close();
    }
  });
});

describe('retries', () => {
  it('retries a 429 that asks for a wait, then a 503, and then succeeds', async () => {
    const delays: number[] = [];
    const replies = [
      () => ({ status: 429, headers: { 'retry-after': '2' } }),
      () => ({ status: 503, headers: {} }),
      () => ({ status: 200, headers: {} }),
    ];
    const server = await startServer((_req, res) => {
      const { status, headers } = replies[server.requests.length - 1]!();
      sendJson(
        res,
        status,
        status === 200 ? { pong: true } : { error: { message: 'busy' } },
        headers,
      );
    });
    const client = clientFor(server, {
      retry: {
        sleep: async (ms) => {
          delays.push(ms);
        },
        random: () => 0,
      },
    });

    const reply = await client.withRetries(() => client.getJson('/ping', Pong));

    expect(reply).toEqual({ pong: true });
    expect(server.requests).toHaveLength(3);
    expect(delays).toEqual([2000, 1000]);
  });

  it.each([400, 401, 402, 403, 404, 413])('does not retry HTTP %i', async (status) => {
    const server = await startServer((_req, res) => sendJson(res, status, { error: 'no' }));
    const client = clientFor(server);
    await caught(client.withRetries(() => client.getJson('/ping', Pong)));
    expect(server.requests).toHaveLength(1);
  });

  it('stops after five attempts', async () => {
    const server = await startServer((_req, res) => sendJson(res, 503, { error: 'busy' }));
    const client = clientFor(server);
    const error = await caught(client.withRetries(() => client.getJson('/ping', Pong)));
    expect(error.status).toBe(503);
    expect(server.requests).toHaveLength(5);
  });

  it('does not repeat a gateway timeout', async () => {
    const server = await startServer((_req, res) => sendJson(res, 504, { error: 'slow' }));
    const client = clientFor(server);
    await caught(client.withRetries(() => client.getJson('/ping', Pong)));
    expect(server.requests).toHaveLength(1);
  });
});
