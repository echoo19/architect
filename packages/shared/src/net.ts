const IPV4_LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** `localhost`, anything in 127.0.0.0/8, or `::1`, as the URL parser writes host names. */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host === '[::1]' || IPV4_LOOPBACK.test(host);
}

/**
 * True only when the URL points at this machine. A URL that doesn't parse is not loopback. The
 * URL parser normalizes shorthand such as `127.1` and `2130706433` first, so the check sees the
 * address the socket would use.
 */
export function isLoopbackUrl(url: string | URL): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return isLoopbackHostname(hostname);
}

/**
 * Why a base URL can't be a model server on this computer, or null when it can: it must be
 * http(s), name this machine (`127.0.0.1`, `localhost` or `[::1]`) and carry a port.
 */
export function loopbackEndpointIssue(baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'Enter the address as a URL, such as http://127.0.0.1:8000/v1.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Use an http address, such as http://127.0.0.1:8000/v1.';
  }
  if (!isLoopbackHostname(url.hostname)) {
    return `${url.hostname} is not on this computer. A model on this computer is reached at 127.0.0.1, localhost or [::1].`;
  }
  if (url.port === '') {
    return 'Add the port the server listens on, such as http://127.0.0.1:8000/v1.';
  }
  return null;
}
