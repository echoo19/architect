import dgram from 'node:dgram';
import dns from 'node:dns';
import { lookup as lookupFromModule } from 'node:dns/promises';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';
import { GuardError } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  installLoopbackOnlyGuard,
  type BlockedConnection,
  type LoopbackGuard,
} from '../src/agent-host/guard/install';

// Taken before the guard is installed, the way a module loaded earlier would hold them.
const connectBeforeGuard = net.connect;
const fetchBeforeGuard = globalThis.fetch;

/** Reserved for documentation (RFC 5737): nothing answers there, whatever happens. */
const PUBLIC_ADDRESS = '198.51.100.7';

const reported: BlockedConnection[] = [];
let guard: LoopbackGuard;
let server: net.Server;
let web: http.Server;

beforeAll(async () => {
  guard = installLoopbackOnlyGuard({ onBlocked: (attempt) => reported.push(attempt) });
  server = net.createServer((socket) => socket.end());
  web = http.createServer((_request, response) => response.end('ok'));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => web.listen(0, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  web.closeAllConnections();
  await new Promise((resolve) => web.close(resolve));
});

const portOf = (listening: net.Server | http.Server) =>
  (listening.address() as net.AddressInfo).port;
const isNetworkGuard = { name: 'GuardError', guard: 'network' };

/** Connects and resolves once connected, or with the error the socket reported. */
function outcome(socket: net.Socket): Promise<'connected' | Error> {
  return new Promise((resolve) => {
    socket.once('connect', () => {
      socket.destroy();
      resolve('connected');
    });
    socket.once('error', resolve);
  });
}

describe('the loopback-only guard', () => {
  it('blocks fetch to a public host', async () => {
    await expect(fetch('https://example.com')).rejects.toMatchObject(isNetworkGuard);
    expect(reported.at(-1)).toMatchObject({ api: 'fetch', target: 'example.com:443' });
  });

  it('blocks http and https requests to a public host', () => {
    expect(() => http.get('http://example.com/')).toThrow(GuardError);
    expect(() => https.get('https://example.com/')).toThrow(GuardError);
    expect(() => http.request({ hostname: 'example.com', path: '/' })).toThrow(GuardError);
    expect(() => https.request(new URL('https://api.example.com/v1'))).toThrow(GuardError);
    expect(reported.at(-1)).toMatchObject({ api: 'https.request', target: 'api.example.com:443' });
  });

  it('blocks connections to a public address, even through references taken before it', async () => {
    expect(() => net.connect(443, PUBLIC_ADDRESS)).toThrow(GuardError);
    expect(() => connectBeforeGuard(443, PUBLIC_ADDRESS)).toThrow(GuardError);
    expect(() => new net.Socket().connect({ host: PUBLIC_ADDRESS, port: 443 })).toThrow(GuardError);
    expect(() => tls.connect(443, 'example.com')).toThrow(GuardError);
    await expect(fetchBeforeGuard('https://example.com/')).rejects.toMatchObject({
      cause: isNetworkGuard,
    });
    expect(reported.at(-1)).toMatchObject({ target: 'example.com:443' });
  });

  it('blocks DNS lookups and queries for public names', async () => {
    expect(() => dns.lookup('example.com', () => undefined)).toThrow(GuardError);
    await expect(dns.promises.lookup('example.com')).rejects.toMatchObject(isNetworkGuard);
    await expect(lookupFromModule('example.com')).rejects.toMatchObject(isNetworkGuard);
    expect(() => dns.resolve4('example.com', () => undefined)).toThrow(GuardError);
    expect(() => new dns.Resolver().resolveTxt('example.com', () => undefined)).toThrow(GuardError);
    await expect(new dns.promises.Resolver().resolve4('localhost')).rejects.toMatchObject(
      isNetworkGuard,
    );
    expect(reported.at(-1)).toMatchObject({
      api: 'dns.promises.Resolver.resolve4',
      target: 'a DNS query for localhost',
    });
  });

  it('blocks datagrams to a public address', () => {
    const socket = dgram.createSocket('udp4');
    try {
      expect(() => socket.send('ping', 53, PUBLIC_ADDRESS)).toThrow(GuardError);
      expect(() => socket.connect(53, PUBLIC_ADDRESS)).toThrow(GuardError);
    } finally {
      socket.close();
    }
  });

  it('checks the address a local name resolves to', async () => {
    const socket = net.connect({
      host: 'localhost',
      port: 80,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: PUBLIC_ADDRESS, family: 4 }]);
        else callback(null, PUBLIC_ADDRESS, 4);
      },
    });
    expect(await outcome(socket)).toMatchObject(isNetworkGuard);
    expect(reported.at(-1)).toMatchObject({ target: `${PUBLIC_ADDRESS}:80` });
  });

  it('lets this machine through: 127.0.0.1, localhost, ::1 and local pipes', async () => {
    const before = guard.blocked().length;
    const port = portOf(server);
    expect(await outcome(net.connect(port, '127.0.0.1'))).toBe('connected');
    expect(await outcome(net.connect({ host: 'localhost', port }))).toBe('connected');
    expect(await outcome(connectBeforeGuard(port, '127.0.0.1'))).toBe('connected');
    // Nothing may listen on ::1 here; what matters is that the guard let the attempt through.
    expect(await outcome(net.connect(port, '::1'))).not.toBeInstanceOf(GuardError);
    const response = await fetch(`http://127.0.0.1:${portOf(web)}/`);
    expect(await response.text()).toBe('ok');

    const pipe =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\architect-guard-${process.pid}`
        : join(tmpdir(), `architect-guard-${process.pid}.sock`);
    const pipeServer = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => pipeServer.listen(pipe, resolve));
    try {
      expect(await outcome(net.connect(pipe))).toBe('connected');
    } finally {
      await new Promise((resolve) => pipeServer.close(resolve));
      if (process.platform !== 'win32') await rm(pipe, { force: true });
    }
    expect(guard.blocked()).toHaveLength(before);
  });

  it('blocks named pipes on other machines', () => {
    expect(() => net.connect('\\\\files.example.com\\pipe\\shared')).toThrow(GuardError);
    expect(reported.at(-1)).toMatchObject({ target: '\\\\files.example.com\\pipe\\shared' });
  });

  it('records every blocked call for diagnostics and tells its listeners', () => {
    expect(guard.blocked()).toEqual(reported);
    const seen: BlockedConnection[] = [];
    const stop = guard.onBlocked((attempt) => seen.push(attempt));
    expect(() => net.connect(80, PUBLIC_ADDRESS)).toThrow(GuardError);
    stop();
    expect(() => net.connect(81, PUBLIC_ADDRESS)).toThrow(GuardError);
    expect(seen).toEqual([expect.objectContaining({ target: `${PUBLIC_ADDRESS}:80` })]);
  });

  it('installs once', () => {
    const connect = net.Socket.prototype.connect;
    const guardedFetch = globalThis.fetch;
    expect(installLoopbackOnlyGuard()).toBe(guard);
    expect(net.Socket.prototype.connect).toBe(connect);
    expect(globalThis.fetch).toBe(guardedFetch);
  });
});
