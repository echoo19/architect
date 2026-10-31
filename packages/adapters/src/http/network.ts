import { AdapterError, contactHost, insideNetwork } from '@architect/shared';
import { current, type NetworkDeps } from '../deps';

/** The typed refusal for a request a closed network doesn't admit, saying how to recover. */
export function outsideNetwork(service: string, url: string): AdapterError {
  const host = contactHost(url);
  const where = service === host ? host : `${service} at ${host}`;
  return new AdapterError(
    'outside_network',
    `${where} is outside the closed network, so nothing was sent there. Add ${host} to the closed network in Settings, or choose a model inside it.`,
  );
}

/**
 * Throws the refusal when a closed network is on and `url` isn't inside it. With `contact`, the
 * request is about to be sent, so its host is told to whoever records them.
 */
export function admit(
  network: NetworkDeps | undefined,
  service: string,
  url: string,
  contact: boolean,
): void {
  if (network === undefined) return;
  const allowed = network.allowed === undefined ? undefined : current(network.allowed);
  const inside = allowed !== undefined && insideNetwork(url, allowed);
  if (allowed !== undefined && !inside) throw outsideNetwork(service, url);
  if (contact) network.contacted?.(contactHost(url), inside);
}

/**
 * Refuses a request the app is about to make on a person's behalf, outside an adapter, such as a
 * sign-in's key exchange, when a closed network is on and `url` isn't inside it.
 */
export function assertInsideNetwork(
  network: NetworkDeps | undefined,
  service: string,
  url: string,
): void {
  admit(network, service, url, false);
}
