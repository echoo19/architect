import { isLocalPipe, isLoopbackHost } from './loopback';

/** Where a call would send data, read from its arguments the way Node reads them. */
export type Destination =
  | { kind: 'host'; host: string; port?: string }
  | { kind: 'pipe'; path: string }
  /** A DNS query, which goes to the configured name servers whatever name it asks about. */
  | { kind: 'dns'; name: string }
  /** Nothing leaves the process: a `data:` or `blob:` URL, or TLS over an existing socket. */
  | { kind: 'none' }
  /** Arguments too unusual to read. Refused, since where they lead can't be checked. */
  | { kind: 'unclear'; detail: string };

type Options = Record<string, unknown>;

const isOptions = (value: unknown): value is Options =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** net reads a string argument as a port when it is a number of 0 or more, as a pipe otherwise. */
const isPortText = (value: string): boolean => Number(value) >= 0;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const portText = (value: unknown): string | undefined =>
  typeof value === 'number' || typeof value === 'string' ? String(value) : undefined;

export function isAllowed(destination: Destination): boolean {
  switch (destination.kind) {
    case 'host':
      return isLoopbackHost(destination.host);
    case 'pipe':
      return isLocalPipe(destination.path);
    case 'none':
      return true;
    case 'dns':
    case 'unclear':
      return false;
  }
}

/** A destination as diagnostics show it. Never a whole URL: paths and queries can carry secrets. */
export function describeDestination(destination: Destination): string {
  switch (destination.kind) {
    case 'host': {
      if (destination.port === undefined) return destination.host;
      const bracketed = destination.host.includes(':') && !destination.host.startsWith('[');
      return `${bracketed ? `[${destination.host}]` : destination.host}:${destination.port}`;
    }
    case 'pipe':
      return destination.path;
    case 'dns':
      return `a DNS query for ${destination.name}`;
    case 'none':
      return 'nowhere';
    case 'unclear':
      return destination.detail;
  }
}

/**
 * The destination of `net.Socket#connect`, `net.connect` or `tls.connect`. Every options object
 * among the first arguments counts, because tls.connect also takes one after a port or a path;
 * reading one more than Node would only ever refuse more, never less.
 */
export function socketDestination(args: readonly unknown[]): Destination {
  // net.connect hands the socket its arguments already normalized, as a single array.
  const list: readonly unknown[] = Array.isArray(args[0]) ? args[0] : args;
  const [first, second] = list;
  const options: Options = {};
  if (typeof first === 'string' && !isPortText(first)) {
    options.path = first;
  } else if (typeof first === 'number' || typeof first === 'string') {
    options.port = first;
    if (typeof second === 'string') options.host = second;
  }
  for (const arg of list.slice(0, 3)) {
    if (!isOptions(arg)) continue;
    for (const key of ['host', 'port', 'path', 'socket']) {
      if (arg[key] !== undefined) options[key] = arg[key];
    }
  }
  if (options.socket !== undefined && options.socket !== null) return { kind: 'none' };
  const path = text(options.path);
  if (path !== undefined) return { kind: 'pipe', path };
  return { kind: 'host', host: text(options.host) ?? 'localhost', port: portText(options.port) };
}

/** The destination of `http.request`, `http.get` and their https twins. */
export function requestDestination(args: readonly unknown[], defaultPort: string): Destination {
  const [first, second] = args;
  const options: Options = {};
  const copy = (from: Options) => {
    for (const key of ['hostname', 'host', 'port', 'socketPath']) {
      if (from[key] !== undefined) options[key] = from[key];
    }
  };
  if (typeof first === 'string' || first instanceof URL) {
    const url = parseUrl(first);
    if (!url) return { kind: 'unclear', detail: 'an address that is not a valid URL' };
    options.hostname = url.hostname;
    if (url.port !== '') options.port = url.port;
    if (isOptions(second)) copy(second);
  } else if (isOptions(first)) {
    copy(first);
  }
  const socketPath = text(options.socketPath);
  if (socketPath !== undefined) return { kind: 'pipe', path: socketPath };
  const host = text(options.hostname) ?? text(options.host) ?? 'localhost';
  return { kind: 'host', host, port: portText(options.port) ?? defaultPort };
}

/** The destination of `fetch`: a URL string, a URL, or a Request. */
export function fetchDestination(input: unknown): Destination {
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : isOptions(input) && typeof input.url === 'string'
          ? input.url
          : undefined;
  const url = href === undefined ? null : parseUrl(href);
  if (!url) return { kind: 'unclear', detail: 'a request without a readable URL' };
  if (url.protocol === 'data:' || url.protocol === 'blob:') return { kind: 'none' };
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { kind: 'unclear', detail: `a ${url.protocol} URL` };
  }
  const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80';
  return { kind: 'host', host: url.hostname, port };
}

/** The name a `dns.lookup` or the address a `dns.lookupService` call resolves locally. */
export function lookupDestination(args: readonly unknown[]): Destination {
  const [name] = args;
  return typeof name === 'string'
    ? { kind: 'host', host: name }
    : { kind: 'unclear', detail: 'a lookup without a name' };
}

/** A `dns.resolve*` or `dns.reverse` query, always answered by name servers over the network. */
export function dnsQueryDestination(args: readonly unknown[]): Destination {
  const [name] = args;
  return { kind: 'dns', name: typeof name === 'string' ? name : 'an unnamed host' };
}

/**
 * Where a datagram goes: the last argument from `from` on that is an address rather than a port.
 * A socket without one sends to loopback, and a connected socket was checked when it connected.
 */
export function datagramDestination(args: readonly unknown[], from: number): Destination {
  const address = args
    .slice(from)
    .filter((arg): arg is string => typeof arg === 'string' && !/^\d+$/.test(arg))
    .at(-1);
  return { kind: 'host', host: address ?? 'localhost' };
}

function parseUrl(value: string | URL): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}
