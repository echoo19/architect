const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** LF line endings and no byte-order mark, so a file reads the same on every platform. */
export function normalizeText(text: string): string {
  const withoutMark = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  return withoutMark.replace(/\r\n?/g, '\n');
}

export function byteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/** Code-unit order, so sorting gives the same result on every machine and locale. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
