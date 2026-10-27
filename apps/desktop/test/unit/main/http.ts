import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeServer {
  /** `http://127.0.0.1:<port>` */
  readonly url: string;
  /** Every request received so far: method, path and authorization header. */
  readonly requests: { method: string; path: string; authorization?: string }[];
  close(): Promise<void>;
}

/** A server on a free loopback port, so tests never leave this computer. */
export async function fakeServer(
  handle: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<FakeServer> {
  const requests: FakeServer['requests'] = [];
  const server = createServer((request, response) => {
    requests.push({
      method: request.method ?? 'GET',
      path: request.url ?? '/',
      ...(request.headers.authorization ? { authorization: request.headers.authorization } : {}),
    });
    request.resume();
    request.on('end', () => handle(request, response));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export function sendJson(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** A loopback address where nothing is listening. */
export async function closedUrl(): Promise<string> {
  const server = await fakeServer((_request, response) => response.end());
  await server.close();
  return server.url;
}
