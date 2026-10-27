import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { GuardError } from '@architect/shared';
import {
  datagramDestination,
  describeDestination,
  dnsQueryDestination,
  fetchDestination,
  isAllowed,
  lookupDestination,
  requestDestination,
  socketDestination,
  type Destination,
} from './destinations';
import { isLoopbackAddress } from './loopback';

/** One network call the guard stopped. */
export interface BlockedConnection {
  /** The function that was called, e.g. `fetch` or `net.Socket.connect`. */
  api: string;
  /** Where it tried to go: a host and port, a pipe, or a DNS query. Never a whole URL. */
  target: string;
  at: string;
}

export interface LoopbackGuard {
  /** Every call blocked since the guard was installed, oldest first. */
  blocked(): BlockedConnection[];
  /** Calls `listener` for every call blocked from now on. */
  onBlocked(listener: (attempt: BlockedConnection) => void): () => void;
}

export interface LoopbackGuardOptions {
  onBlocked?(attempt: BlockedConnection): void;
}

/** How a log line about a blocked call starts, so logs can be searched for them. */
export const BLOCKED_LOG_PREFIX = 'Blocked a network call';

export function describeBlocked(attempt: BlockedConnection): string {
  return `${BLOCKED_LOG_PREFIX} to ${attempt.target} (${attempt.api}).`;
}

/** `dns.resolve*` and `dns.reverse`, which ask name servers over the network. */
const DNS_QUERIES = [
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTlsa',
  'resolveTxt',
  'reverse',
] as const;

let installed: LoopbackGuard | undefined;

/**
 * Makes every network API in this process refuse destinations other than this machine:
 * 127.0.0.0/8, ::1, `localhost`, Unix sockets and local named pipes pass; anything else throws
 * (or rejects) a `GuardError('network')` before a byte leaves. Sockets are guarded on
 * `net.Socket.prototype`, so code that kept a reference to `net.connect`, `http.request` or
 * `fetch` from before the guard is stopped there all the same. Installing again changes nothing
 * but adds the listener.
 */
export function installLoopbackOnlyGuard(options: LoopbackGuardOptions = {}): LoopbackGuard {
  installed ??= install();
  if (options.onBlocked) installed.onBlocked(options.onBlocked);
  return installed;
}

function install(): LoopbackGuard {
  const blocked: BlockedConnection[] = [];
  const listeners = new Set<(attempt: BlockedConnection) => void>();

  /** The error for a destination that isn't allowed, after recording the attempt; else null. */
  function refuse(api: string, destination: Destination): GuardError | null {
    if (isAllowed(destination)) return null;
    const attempt = { api, target: describeDestination(destination), at: new Date().toISOString() };
    blocked.push(attempt);
    for (const listener of listeners) {
      try {
        listener(attempt);
      } catch (error) {
        process.emitWarning(`A network guard listener failed: ${String(error)}`);
      }
    }
    return new GuardError(
      'network',
      `Blocked a connection to ${attempt.target}. Graduates work offline: they only reach the model runtime on this computer.`,
    );
  }

  /** Replaces `target[key]` with a function that checks where the call goes before it runs. */
  function guard(
    target: object,
    key: string,
    api: string,
    destination: (args: unknown[]) => Destination,
    failure: 'throw' | 'reject' = 'throw',
  ): void {
    const original: unknown = Reflect.get(target, key);
    // An API this version of Node doesn't have can't be called either.
    if (typeof original !== 'function') return;
    const guarded = function (this: unknown, ...args: unknown[]): unknown {
      const error = refuse(api, destination(args));
      if (error) {
        if (failure === 'reject') return Promise.reject(error);
        throw error;
      }
      return Reflect.apply(original, this, args);
    };
    Object.defineProperty(guarded, 'name', { value: original.name });
    Reflect.set(target, key, guarded);
  }

  guardSocketConnect(refuse);
  guard(net, 'connect', 'net.connect', socketDestination);
  guard(net, 'createConnection', 'net.createConnection', socketDestination);
  guard(tls, 'connect', 'tls.connect', socketDestination);
  for (const [name, module, port] of [
    ['http', http, '80'],
    ['https', https, '443'],
  ] as const) {
    guard(module, 'request', `${name}.request`, (args) => requestDestination(args, port));
    guard(module, 'get', `${name}.get`, (args) => requestDestination(args, port));
  }
  guard(globalThis, 'fetch', 'fetch', ([input]) => fetchDestination(input), 'reject');
  guard(dns, 'lookup', 'dns.lookup', lookupDestination);
  guard(dns, 'lookupService', 'dns.lookupService', lookupDestination);
  guard(dns.promises, 'lookup', 'dns.promises.lookup', lookupDestination, 'reject');
  guard(dns.promises, 'lookupService', 'dns.promises.lookupService', lookupDestination, 'reject');
  for (const query of DNS_QUERIES) {
    // The module functions are bound copies, so the prototypes need guarding as well.
    guard(dns, query, `dns.${query}`, dnsQueryDestination);
    guard(dns.Resolver.prototype, query, `dns.Resolver.${query}`, dnsQueryDestination);
    guard(dns.promises, query, `dns.promises.${query}`, dnsQueryDestination, 'reject');
    guard(
      dns.promises.Resolver.prototype,
      query,
      `dns.promises.Resolver.${query}`,
      dnsQueryDestination,
      'reject',
    );
  }
  guard(dgram.Socket.prototype, 'send', 'dgram.send', (args) => datagramDestination(args, 1));
  guard(dgram.Socket.prototype, 'connect', 'dgram.connect', (args) => datagramDestination(args, 0));
  // ES module imports such as `import { connect } from 'node:net'` see the guarded functions too.
  syncBuiltinESMExports();

  return {
    blocked: () => [...blocked],
    onBlocked(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Every TCP, TLS and pipe connection in Node goes through `net.Socket.prototype.connect`, so this
 * is the patch nothing gets around. A host name passes only as `localhost`; the address it
 * resolves to is checked as well, in case a custom lookup maps it somewhere else.
 */
function guardSocketConnect(
  refuse: (api: string, destination: Destination) => GuardError | null,
): void {
  const api = 'net.Socket.connect';
  const original = net.Socket.prototype.connect;
  const watched = new WeakSet<net.Socket>();
  const connect = function (this: net.Socket, ...args: unknown[]): unknown {
    const destination = socketDestination(args);
    const error = refuse(api, destination);
    if (error) throw error;
    if (destination.kind === 'host' && net.isIP(destination.host) === 0 && !watched.has(this)) {
      watched.add(this);
      this.prependListener('lookup', (lookupError: Error | null, address: unknown) => {
        if (lookupError || typeof address !== 'string' || isLoopbackAddress(address)) return;
        const resolved = refuse(api, { kind: 'host', host: address, port: destination.port });
        if (resolved) this.destroy(resolved);
      });
    }
    return Reflect.apply(original, this, args);
  };
  Object.defineProperty(connect, 'name', { value: original.name });
  Reflect.set(net.Socket.prototype, 'connect', connect);
}
