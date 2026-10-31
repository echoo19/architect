import { z } from 'zod';
import { isLoopbackHostname } from './net';

/*
 * A closed network (decision 098): the hosts teaching may reach, for a team whose data can't
 * leave its building. This computer is always inside it. A graduate is held to less: it reaches
 * only the model runtime on this computer (invariant 3), whatever this setting says.
 */

/** The most hosts a closed network names. */
export const MAX_NETWORK_HOSTS = 50;

/**
 * Why `text` can't name a host in a closed network, or null when it can: a name or an address,
 * with a port when only that port is meant (`spark.lab.internal`, `10.0.4.7:8000`), and nothing
 * else: no scheme, path, user or query.
 */
export function networkHostProblem(text: string): string | null {
  const host = text.trim().toLowerCase();
  if (host === '') return 'Enter a host, such as spark.lab.internal or 10.0.4.7:8000.';
  if (host.includes('://') || /[/?#@\s]/.test(host)) {
    return 'Enter only the host and, if you like, its port, such as vllm.lab.internal:8000.';
  }
  let url: URL;
  try {
    url = new URL(`http://${host}`);
  } catch {
    return `${text.trim()} isn't a host name or address.`;
  }
  // The parser writes a default port away, so `host:80` reads back as `host`; both are fine.
  const written = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`;
  if (written !== host && `${url.hostname}:80` !== host) {
    return `${text.trim()} isn't a host name or address.`;
  }
  return null;
}

/** A host as a closed network keeps it: trimmed and in lower case. */
export function normalizeNetworkHost(text: string): string {
  return text.trim().toLowerCase();
}

export const NetworkHostSchema = z
  .string()
  .transform(normalizeNetworkHost)
  .superRefine((host, ctx) => {
    const problem = networkHostProblem(host);
    if (problem !== null) ctx.addIssue({ code: 'custom', message: problem });
  });

export const ClosedNetworkSchema = z.object({
  on: z.boolean(),
  hosts: z.array(NetworkHostSchema).max(MAX_NETWORK_HOSTS),
});
export type ClosedNetwork = z.infer<typeof ClosedNetworkSchema>;

/** The hosts teaching may reach besides this computer, or undefined while no closed network is on. */
export function allowedHostsOf(network: ClosedNetwork | undefined): string[] | undefined {
  return network?.on === true ? [...network.hosts] : undefined;
}

/**
 * The host a request to `url` goes to, as a run records it: the name or address, and the port when
 * the URL names one. Never the path or the query, which can carry secrets.
 */
export function contactHost(url: string | URL): string {
  return new URL(url).host.toLowerCase();
}

function defaultPort(protocol: string): string {
  return protocol === 'https:' ? '443' : '80';
}

/**
 * True when a request to `url` stays inside a closed network naming `hosts`: it goes to this
 * computer, or to a named host (on any port, or on the one port the entry names).
 */
export function insideNetwork(url: string | URL, hosts: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (isLoopbackHostname(parsed.hostname)) return true;
  const port = parsed.port === '' ? defaultPort(parsed.protocol) : parsed.port;
  return hosts.some((entry) => {
    const named = new URL(`http://${entry}`);
    if (named.hostname !== parsed.hostname.toLowerCase()) return false;
    const pinned = named.port !== '' || entry.endsWith(':80');
    return !pinned || (named.port === '' ? '80' : named.port) === port;
  });
}

/** A host one run contacted: how many requests went there, and whether all were inside a closed network. */
export const RunContactSchema = z.object({
  host: z.string().min(1),
  requests: z.number().int().positive(),
  /** True when a closed network was on and admitted every one of those requests. */
  inside: z.boolean(),
});
export type RunContact = z.infer<typeof RunContactSchema>;

/** "Contacted 2 hosts, both inside the network": what a run's records say about where it went. */
export function contactsLine(contacts: readonly RunContact[]): string {
  const count = contacts.length;
  if (count === 0) return 'Contacted no hosts';
  const hosts = count === 1 ? '1 host' : `${count} hosts`;
  const inside = contacts.filter((contact) => contact.inside).length;
  if (inside === count) {
    const all = count === 1 ? '' : count === 2 ? 'both ' : 'all ';
    return `Contacted ${hosts}, ${all}inside the network`;
  }
  if (inside === 0) return `Contacted ${hosts}, with no closed network on`;
  return `Contacted ${hosts}, ${inside} of them inside the network`;
}

/** Where Ollama pulls a model whose name names no registry. */
export const OLLAMA_REGISTRY = 'registry.ollama.ai';

const OLLAMA_HOST = /^[A-Za-z0-9][A-Za-z0-9._-]*(:\d{1,5})?$/;
const OLLAMA_PART = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const OLLAMA_TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/**
 * Why `name` isn't a model name Ollama pulls, or null when it is: `[registry/][namespace/]model`
 * with an optional `:tag`, as Ollama reads one (`muse-glimmer:30b`, `hf.co/owner/repo:Q4_K_M`).
 */
export function ollamaNameProblem(name: string): string | null {
  const plain = "isn't a model name Ollama can pull. Use a name such as muse-glimmer:30b.";
  if (name.length === 0 || name.length > 200 || /\s/.test(name)) return `"${name}" ${plain}`;
  const slash = name.lastIndexOf('/');
  const colon = name.lastIndexOf(':');
  const tagged = colon > slash;
  const path = tagged ? name.slice(0, colon) : name;
  if (tagged && !OLLAMA_TAG.test(name.slice(colon + 1))) return `"${name}" ${plain}`;
  const parts = path.split('/');
  if (parts.length > 3) return `"${name}" ${plain}`;
  const [first, ...rest] = parts;
  const host = parts.length === 3 ? first : undefined;
  if (host !== undefined && !OLLAMA_HOST.test(host)) return `"${name}" ${plain}`;
  const names = host === undefined ? parts : rest;
  if (!names.every((part) => OLLAMA_PART.test(part))) return `"${name}" ${plain}`;
  return null;
}

/** The registry Ollama would pull `name` from: the one it names, or Ollama's own. */
export function ollamaRegistryOf(name: string): string {
  const slash = name.lastIndexOf('/');
  const colon = name.lastIndexOf(':');
  const parts = (colon > slash ? name.slice(0, colon) : name).split('/');
  return parts.length === 3 ? (parts[0] ?? OLLAMA_REGISTRY).toLowerCase() : OLLAMA_REGISTRY;
}

/**
 * A closed network as read from a settings file, failing closed (decision 098): `problem` says
 * what couldn't be read, and then the network is on with whatever hosts could be.
 */
export interface StoredClosedNetwork {
  network?: ClosedNetwork;
  problem?: string;
}

function failedClosed(hosts: readonly string[], damage: string): StoredClosedNetwork {
  const kept = hosts.length === 0 ? 'this computer alone' : hosts.join(', ');
  return {
    network: { on: true, hosts: [...hosts] },
    problem: `The saved closed network couldn't be read in full (${damage}), so it stays on with ${kept}. Check it in Settings, Privacy, and save it again.`,
  };
}

/**
 * The closed network a settings file holds. Absent, there is none. Present but damaged (an
 * unreadable switch, a host that isn't one, more hosts than it may name), it is on with the hosts
 * that read, and says what was wrong, rather than silently off.
 */
export function readClosedNetwork(raw: unknown): StoredClosedNetwork {
  if (raw === undefined) return {};
  const parsed = ClosedNetworkSchema.safeParse(raw);
  if (parsed.success) return { network: parsed.data };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return failedClosed([], 'it is not a setting');
  }
  const record = raw as Record<string, unknown>;
  const damage: string[] = [];
  if (typeof record['on'] !== 'boolean') damage.push('whether it is on');
  const listed = Array.isArray(record['hosts']) ? (record['hosts'] as unknown[]) : null;
  if (listed === null) damage.push('its hosts');
  const hosts: string[] = [];
  let unreadable = 0;
  for (const entry of listed ?? []) {
    const host = typeof entry === 'string' ? normalizeNetworkHost(entry) : '';
    if (typeof entry !== 'string' || networkHostProblem(host) !== null) unreadable += 1;
    else if (!hosts.includes(host)) hosts.push(host);
  }
  if (unreadable > 0) damage.push(unreadable === 1 ? '1 host' : `${unreadable} hosts`);
  if (hosts.length > MAX_NETWORK_HOSTS) {
    damage.push(`more than ${MAX_NETWORK_HOSTS} hosts`);
    hosts.length = MAX_NETWORK_HOSTS;
  }
  return failedClosed(hosts, damage.join(', ') || 'its shape');
}

/** A settings file that couldn't be read at all, though it may hold a closed network: on, with none. */
export function unreadableClosedNetwork(): StoredClosedNetwork {
  return failedClosed([], 'the settings file could not be read');
}
