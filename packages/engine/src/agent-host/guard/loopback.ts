import { BlockList, isIP } from 'node:net';

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addAddress('::1', 'ipv6');

/** A Windows path that starts like `\\server\share` names another machine, unless it is a local pipe. */
const UNC_PATH = process.platform === 'win32' ? /^[\\/]{2}/ : /^\\\\/;
const LOCAL_PIPE = /^[\\/]{2}[.?][\\/]pipe[\\/]/i;

/** True for an address on this machine's loopback interface: 127.0.0.0/8 or ::1, mapped or not. */
export function isLoopbackAddress(address: string): boolean {
  const plain = address.replace(/%.*$/, '');
  const family = isIP(plain);
  if (family === 0) return false;
  return LOOPBACK.check(plain, family === 4 ? 'ipv4' : 'ipv6');
}

/** True for `localhost` or a loopback address, as written in a URL (`[::1]`) or socket options. */
export function isLoopbackHost(host: string): boolean {
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  return bare.toLowerCase() === 'localhost' || isLoopbackAddress(bare);
}

/** Unix domain sockets and this machine's named pipes; `\\server\pipe\...` reaches another one. */
export function isLocalPipe(path: string): boolean {
  return !UNC_PATH.test(path) || LOCAL_PIPE.test(path);
}
