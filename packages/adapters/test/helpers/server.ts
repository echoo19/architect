import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
  /** The request body parsed as a JSON object. */
  json(): Record<string, unknown>;
}

export type Handler = (request: RecordedRequest, response: ServerResponse) => void | Promise<void>;

export interface FakeServer {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  /** Every request received so far, in order. */
  readonly requests: RecordedRequest[];
}

const running: { close(): Promise<void> }[] = [];

/** Starts a server on a free loopback port. Call `stopServers` in `afterEach`. */
export async function startServer(handler: Handler): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (part: Buffer) => parts.push(part));
    req.on('end', () => {
      const body = Buffer.concat(parts).toString('utf8');
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        path: req.url ?? '/',
        headers: req.headers,
        body,
        json: () => JSON.parse(body) as Record<string, unknown>,
      };
      requests.push(recorded);
      Promise.resolve(handler(recorded, res)).catch((error: unknown) => {
        res.statusCode = 500;
        res.end(String(error));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  running.push({
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests };
}

export async function stopServers(): Promise<void> {
  await Promise.all(running.splice(0).map((server) => server.close()));
}

export const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

export function openEventStream(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  res.flushHeaders();
}

/** One server-sent event. Strings such as `[DONE]` go out as written; objects as JSON. */
export const eventData = (payload: unknown): string =>
  `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`;

export function sendEventStream(res: ServerResponse, payloads: unknown[]): void {
  openEventStream(res);
  for (const payload of payloads) res.write(eventData(payload));
  res.end();
}

/** Writes pieces with a short pause between them, so the client reads them as separate chunks. */
export async function writeInPieces(res: ServerResponse, pieces: string[]): Promise<void> {
  for (const piece of pieces) {
    res.write(piece);
    await pause(15);
  }
}

/** A `fetch` that sends any URL to the fake server, keeping the path, so tests can use real base URLs. */
export function routeTo(server: FakeServer): typeof fetch {
  const target = new URL(server.url);
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    url.protocol = target.protocol;
    url.host = target.host;
    return fetch(url, init);
  };
}

/** Resolves when the client drops the connection, which is how an aborted request shows up. */
export function whenClosed(res: ServerResponse): Promise<void> {
  return new Promise((resolve) => res.on('close', resolve));
}
