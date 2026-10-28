const BYTE_ORDER_MARK = '﻿';

/** How a file was written on disk, so saving it again keeps its line breaks and byte-order mark. */
export interface TextFormat {
  linebreak: '\n' | '\r\n';
  bom: boolean;
}

/** A file's text as the agent works with it: LF line breaks, no byte-order mark. */
export function fromDisk(raw: string): { text: string; format: TextFormat } {
  const bom = raw.startsWith(BYTE_ORDER_MARK);
  const body = bom ? raw.slice(1) : raw;
  return {
    text: body.replace(/\r\n?/g, '\n'),
    format: { linebreak: body.includes('\r\n') ? '\r\n' : '\n', bom },
  };
}

/** The text as it goes back to disk, with the file's own line breaks and byte-order mark. */
export function toDisk(text: string, format: TextFormat): string {
  const body = format.linebreak === '\n' ? text : text.replace(/\n/g, '\r\n');
  return format.bom ? `${BYTE_ORDER_MARK}${body}` : body;
}

/** Text the agent wrote, with LF line breaks whatever it sent. */
export function normalizeBreaks(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** The lines of a text, without the empty one after a final line break. */
export function linesOf(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

export function lineCount(text: string): number {
  return linesOf(text).length;
}

/** "1 line", "3 rows". */
export function count(n: number, noun: string): string {
  return `${n.toLocaleString('en-US')} ${noun}${n === 1 ? '' : 's'}`;
}
