import dns from 'node:dns';
import { appendFileSync } from 'node:fs';
import net from 'node:net';

/*
 * Loaded with --import into the agent host's process ahead of its entry, so the network guard
 * wraps these functions rather than the other way round. That makes this a record of what really
 * leaves the process, kept by code the guard doesn't own: every socket connect and name lookup
 * that gets past the guard (or happens without one), and every connection that opens.
 */

const log = process.env.ARCHITECT_CONNECTION_LOG;
if (!log) throw new Error('Set ARCHITECT_CONNECTION_LOG to the file the observer writes.');
const file = log;

export type ObservedConnection =
  /** `guarded` is false when nothing has wrapped this observer, meaning no guard is installed. */
  | { type: 'connect'; host?: unknown; port?: unknown; path?: unknown; guarded: boolean }
  | { type: 'connected'; address?: string; port?: number }
  | { type: 'lookup'; name: unknown };

function record(entry: ObservedConnection): void {
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

const connect = net.Socket.prototype.connect;
const lookup = dns.lookup;

function observedConnect(this: net.Socket, ...args: unknown[]): unknown {
  const first: unknown = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options =
    typeof first === 'object' && first !== null
      ? (first as Record<string, unknown>)
      : typeof first === 'string' && Number.isNaN(Number(first))
        ? { path: first }
        : { port: first, host: args[1] };
  record({
    type: 'connect',
    host: options.host,
    port: options.port,
    path: options.path,
    guarded: net.Socket.prototype.connect !== observedConnect,
  });
  this.once('connect', () =>
    record({ type: 'connected', address: this.remoteAddress, port: this.remotePort }),
  );
  return Reflect.apply(connect, this, args);
}

function observedLookup(this: unknown, ...args: unknown[]): unknown {
  record({ type: 'lookup', name: args[0] });
  return Reflect.apply(lookup, this, args);
}

Reflect.set(net.Socket.prototype, 'connect', observedConnect);
Reflect.set(dns, 'lookup', observedLookup);
