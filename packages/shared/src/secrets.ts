/**
 * The keys Architect can store, by ref, with the service each unlocks and the hosts it may be sent
 * to. Jobs and settings name a key by its ref, never by its value, and a stored key only ever goes
 * to its own service's hosts, so a job file can't send it anywhere else.
 */
export const SECRET_SERVICES = {
  meta: { label: 'Meta Model API', hosts: ['api.meta.ai'] },
  baseten: { label: 'Baseten', hosts: ['inference.baseten.co', '*.api.baseten.co'] },
  modal: { label: 'Modal', hosts: ['*.modal.direct', '*.modal.run'] },
  together: { label: 'Together', hosts: ['api.together.ai', 'api.together.xyz'] },
  openrouter: { label: 'OpenRouter', hosts: ['openrouter.ai'] },
  deepinfra: { label: 'DeepInfra', hosts: ['api.deepinfra.com'] },
} as const satisfies Record<string, { label: string; hosts: readonly string[] }>;

export type SecretRef = keyof typeof SECRET_SERVICES;

export const SECRET_REFS = Object.keys(SECRET_SERVICES) as [SecretRef, ...SecretRef[]];

export function isSecretRef(ref: string): ref is SecretRef {
  return Object.hasOwn(SECRET_SERVICES, ref);
}

/** Whether the key stored under `ref` may be sent to `url`: HTTPS, and one of its service's hosts. */
export function keyMayGoTo(ref: string, url: string): boolean {
  if (!isSecretRef(ref)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return SECRET_SERVICES[ref].hosts.some((pattern) =>
    pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern,
  );
}

/** Why a key may not go to `url`, written for the person using the app; null when it may. */
export function keyDestinationProblem(ref: string, url: string): string | null {
  if (keyMayGoTo(ref, url)) return null;
  if (!isSecretRef(ref)) return `There is no stored key called "${ref}".`;
  const service = SECRET_SERVICES[ref];
  const host = URL.canParse(url) ? new URL(url).host : url;
  return `This would send your ${service.label} key to ${host}. Architect only sends it to ${service.hosts.join(', ')} over HTTPS. Check the job's mentor and student settings.`;
}
