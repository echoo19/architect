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
