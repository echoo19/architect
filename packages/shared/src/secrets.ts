import { isLoopbackHostname } from './net';

/**
 * The keys Architect can store, by ref, with the service each unlocks and the hosts it may be
 * sent to. Jobs and settings name a key by its ref, never by its value, and a stored key only ever
 * goes to its own service's hosts, so a job file can't send it anywhere else.
 */
export const SECRET_SERVICES = {
  meta: { label: 'Meta Model API', hosts: ['api.meta.ai'] },
  openai: { label: 'OpenAI', hosts: ['api.openai.com'] },
  anthropic: { label: 'Anthropic', hosts: ['api.anthropic.com'] },
  gemini: { label: 'Google Gemini', hosts: ['generativelanguage.googleapis.com'] },
  openrouter: { label: 'OpenRouter', hosts: ['openrouter.ai'] },
  groq: { label: 'Groq', hosts: ['api.groq.com'] },
  together: { label: 'Together', hosts: ['api.together.ai', 'api.together.xyz'] },
  deepinfra: { label: 'DeepInfra', hosts: ['api.deepinfra.com'] },
  fireworks: { label: 'Fireworks', hosts: ['api.fireworks.ai'] },
  baseten: { label: 'Baseten', hosts: ['inference.baseten.co', '*.api.baseten.co'] },
  modal: { label: 'Modal', hosts: ['*.modal.direct', '*.modal.run'] },
  // The Hub's API host only: its upload and download hosts get signed addresses, never the key.
  huggingface: { label: 'Hugging Face', hosts: ['huggingface.co'] },
} as const satisfies Record<string, { label: string; hosts: readonly string[] }>;

export type NamedSecretRef = keyof typeof SECRET_SERVICES;

/**
 * The key for an endpoint the user added by its address. The ref carries the host and port, so
 * the key is bound to exactly the place the user typed: `custom:api.example.com`.
 */
export type CustomSecretRef = `custom:${string}`;

export type SecretRef = NamedSecretRef | CustomSecretRef;

/** The services Architect knows by name. Keys for added endpoints are stored beside them. */
export const SECRET_REFS = Object.keys(SECRET_SERVICES) as [NamedSecretRef, ...NamedSecretRef[]];

const CUSTOM_PREFIX = 'custom:';

/** A host as `URL.host` writes it: a name or an IPv4 address, or a bracketed IPv6 one, then a port. */
const HOST = /^(?:[a-z0-9_-]+(?:\.[a-z0-9_-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/;

export function isNamedSecretRef(ref: string): ref is NamedSecretRef {
  return Object.hasOwn(SECRET_SERVICES, ref);
}

export function isCustomSecretRef(ref: string): ref is CustomSecretRef {
  return ref.startsWith(CUSTOM_PREFIX) && HOST.test(ref.slice(CUSTOM_PREFIX.length));
}

export function isSecretRef(ref: string): ref is SecretRef {
  return isNamedSecretRef(ref) || isCustomSecretRef(ref);
}

/** Where a key for an endpoint the user entered is stored: under its host and port. */
export function customSecretRef(baseUrl: string): CustomSecretRef {
  return `${CUSTOM_PREFIX}${new URL(baseUrl).host.toLowerCase()}`;
}

function customHost(ref: CustomSecretRef): string {
  return ref.slice(CUSTOM_PREFIX.length);
}

/** Who issued a key, as people know them: "OpenAI", or the host of an endpoint the user added. */
export function secretLabel(ref: SecretRef): string {
  return isNamedSecretRef(ref) ? SECRET_SERVICES[ref].label : customHost(ref);
}

/**
 * Whether the key stored under `ref` may be sent to `url`. A named service's key goes over HTTPS
 * to one of its hosts. An added endpoint's key goes only to the host and port it was saved for,
 * over HTTPS, or over plain HTTP when that host is this computer.
 */
export function keyMayGoTo(ref: string, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (isNamedSecretRef(ref)) {
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return SECRET_SERVICES[ref].hosts.some((pattern) =>
      pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern,
    );
  }
  if (isCustomSecretRef(ref)) {
    if (parsed.host.toLowerCase() !== customHost(ref)) return false;
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname);
  }
  return false;
}

/** Why a key may not go to `url`, written for the person using the app; null when it may. */
export function keyDestinationProblem(ref: string, url: string): string | null {
  if (keyMayGoTo(ref, url)) return null;
  if (!isSecretRef(ref)) return `There is no stored key called "${ref}".`;
  const host = URL.canParse(url) ? new URL(url).host : url;
  const check = "Check the job's mentor and student settings.";
  if (isCustomSecretRef(ref)) {
    const bound = customHost(ref);
    const how = isLoopbackHostname(bound.replace(/:\d+$/, '')) ? '' : ' over HTTPS';
    return `This would send the key for ${bound} to ${host}. Architect only sends it to ${bound}${how}. ${check}`;
  }
  const service = SECRET_SERVICES[ref];
  return `This would send your ${service.label} key to ${host}. Architect only sends it to ${service.hosts.join(', ')} over HTTPS. ${check}`;
}
