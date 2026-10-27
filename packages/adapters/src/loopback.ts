const IPV4_LOOPBACK = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * True only when the URL points at this machine: `localhost`, anything in 127.0.0.0/8, or `::1`.
 * A URL that doesn't parse is not loopback. The URL parser normalizes shorthand such as
 * `127.1` and `2130706433` first, so the checks below see the address the socket would use.
 */
export function isLoopbackUrl(url: string | URL): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }
  return hostname === 'localhost' || hostname === '[::1]' || IPV4_LOOPBACK.test(hostname);
}
