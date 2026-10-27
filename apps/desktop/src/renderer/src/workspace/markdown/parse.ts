/*
 * A small Markdown reader for agent replies: paragraphs, headings, lists, fenced code, quotes,
 * rules, GitHub tables, and bold, italic, strikethrough and inline code. It builds a tree that
 * React renders as text, so raw HTML in a reply is never interpreted. Replies arrive while they
 * are still streaming, so anything left unclosed (a fence, a `**`) reads sensibly as it is.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'del'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'break' };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: number; children: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { type: 'quote'; children: Block[] }
  | { type: 'rule' };

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
const PUNCTUATION = /^[!-/:-@[-`{-~]$/;
const WORD = /[\p{L}\p{N}]/u;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n').map(expandLeadingTabs);
  return parseBlocks(lines);
}

function expandLeadingTabs(line: string): string {
  const lead = /^[ \t]*/.exec(line)?.[0] ?? '';
  return lead.includes('\t') ? lead.replace(/\t/g, '    ') + line.slice(lead.length) : line;
}

const isBlank = (line: string) => line.trim() === '';
const indentOf = (line: string) => line.length - line.trimStart().length;

function nextNonBlank(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) if (!isBlank(lines[i]!)) return i;
  return -1;
}

interface ListMarker {
  ordered: boolean;
  start: number;
  /** Columns a line needs to belong to this item rather than end it. */
  contentIndent: number;
  content: string;
}

function listMarker(line: string): ListMarker | null {
  const match = LIST_ITEM.exec(line);
  if (!match || RULE.test(line)) return null;
  const [, lead = '', marker = '', gap = '', content = ''] = match;
  const ordered = /\d/.test(marker);
  const spaces = gap.length === 0 || gap.length > 4 ? 1 : gap.length;
  return {
    ordered,
    start: ordered ? Number.parseInt(marker, 10) : 1,
    contentIndent: lead.length + marker.length + spaces,
    content,
  };
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < row.length; i++) {
    const char = row[i]!;
    if (char === '\\' && row[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return left ? 'left' : null;
}

function isTableStart(lines: string[], index: number): boolean {
  const head = lines[index];
  const delimiter = lines[index + 1];
  if (head === undefined || delimiter === undefined || !head.includes('|')) return false;
  if (!TABLE_DELIMITER.test(delimiter)) return false;
  return splitRow(head).length === splitRow(delimiter).length;
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index]!;
  return (
    FENCE_OPEN.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    listMarker(line) !== null ||
    isTableStart(lines, index)
  );
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const [, lead = '', marks = '', lang = ''] = fence;
      const closing = new RegExp(`^ {0,3}${marks[0]}{${marks.length},}[ \\t]*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        if (closing.test(lines[i]!)) {
          i++;
          break;
        }
        const text = lines[i]!;
        body.push(text.slice(Math.min(lead.length, indentOf(text))));
        i++;
      }
      blocks.push({ type: 'code', lang, text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const [, hashes = '#', text = ''] = heading;
      blocks.push({ type: 'heading', level: hashes.length, children: parseInline(text) });
      i++;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) {
        body.push(QUOTE.exec(lines[i]!)?.[1] ?? '');
        i++;
      }
      blocks.push({ type: 'quote', children: parseBlocks(body) });
      continue;
    }

    if (isTableStart(lines, i)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]!).map(alignOf);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && !isBlank(lines[i]!) && lines[i]!.includes('|')) {
        const cells = splitRow(lines[i]!);
        rows.push(head.map((_, column) => parseInline(cells[column] ?? '')));
        i++;
      }
      blocks.push({ type: 'table', align, head: head.map((cell) => parseInline(cell)), rows });
      continue;
    }

    const marker = listMarker(line);
    if (marker) {
      const { block, next } = parseList(lines, i, marker.ordered);
      blocks.push(block);
      i = next;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]!) && !startsBlock(lines, i)) {
      paragraph.push(lines[i]!.trim());
      i++;
    }
    blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
  }
  return blocks;
}

function parseList(
  lines: string[],
  start: number,
  ordered: boolean,
): { block: Block; next: number } {
  const items: Block[][] = [];
  const first = listMarker(lines[start]!)!;
  let i = start;
  while (i < lines.length) {
    const marker = listMarker(lines[i]!);
    if (!marker || marker.ordered !== ordered) break;

    const body = [marker.content];
    let j = i + 1;
    let afterBlank = false;
    while (j < lines.length) {
      const line = lines[j]!;
      if (isBlank(line)) {
        const next = nextNonBlank(lines, j);
        if (next === -1 || indentOf(lines[next]!) < marker.contentIndent) break;
        body.push('');
        afterBlank = true;
        j++;
      } else if (indentOf(line) >= marker.contentIndent) {
        body.push(line.slice(marker.contentIndent));
        afterBlank = false;
        j++;
      } else if (!afterBlank && !startsBlock(lines, j)) {
        // A lazy continuation of the item's last paragraph.
        body.push(line.trim());
        j++;
      } else {
        break;
      }
    }
    items.push(parseBlocks(body));
    i = j;

    if (i < lines.length && isBlank(lines[i]!)) {
      const next = nextNonBlank(lines, i);
      if (next === -1 || listMarker(lines[next]!)?.ordered !== ordered) break;
      i = next;
    }
  }
  return { block: { type: 'list', ordered, start: first.start, items }, next: i };
}

function runLength(text: string, from: number, char: string): number {
  let end = from;
  while (text[end] === char) end++;
  return end - from;
}

/** Where a backtick run of exactly `length` starts, at or after `from`, or -1. */
function findBacktickRun(text: string, from: number, length: number): number {
  for (let i = from; i < text.length; i++) {
    if (text[i] !== '`') continue;
    const run = runLength(text, i, '`');
    if (run === length) return i;
    i += run - 1;
  }
  return -1;
}

function codeSpanText(raw: string): string {
  const text = raw.replace(/\n/g, ' ');
  return text.length > 2 && text.startsWith(' ') && text.endsWith(' ') && text.trim() !== ''
    ? text.slice(1, -1)
    : text;
}

const DELIMITERS = ['**', '__', '~~', '*', '_'] as const;
type Delimiter = (typeof DELIMITERS)[number];

const KIND: Record<Delimiter, 'strong' | 'em' | 'del'> = {
  '**': 'strong',
  __: 'strong',
  '~~': 'del',
  '*': 'em',
  _: 'em',
};

/** The emphasis delimiter that opens at `i`, if one does. */
function openingAt(text: string, i: number): Delimiter | null {
  const char = text[i];
  if (char !== '*' && char !== '_' && char !== '~') return null;
  const run = runLength(text, i, char);
  const delimiter = DELIMITERS.find((d) => d[0] === char && d.length === Math.min(run, 2));
  if (!delimiter) return null;
  const after = text[i + delimiter.length];
  if (after === undefined || /\s/.test(after)) return null;
  // Underscores inside words (snake_case, file_names.csv) are never emphasis.
  if (char === '_' && i > 0 && WORD.test(text[i - 1]!)) return null;
  return delimiter;
}

/** Where the delimiter that closes one opened before `from` starts, or -1. */
function closingFor(text: string, from: number, delimiter: Delimiter): number {
  const char = delimiter[0]!;
  for (let j = from; j < text.length; j++) {
    const current = text[j];
    if (current === '\\') {
      j++;
      continue;
    }
    if (current === '`') {
      const run = runLength(text, j, '`');
      const close = findBacktickRun(text, j + run, run);
      j = close === -1 ? j + run - 1 : close + run - 1;
      continue;
    }
    if (current !== char) continue;
    const run = runLength(text, j, char);
    // In a run like `***`, the outer delimiter is the one at the run's end.
    const at = delimiter.length === 2 ? j + run - 2 : run === 2 ? -1 : j + run - 1;
    const before = text[at - 1];
    const after = text[at + delimiter.length];
    const closes =
      at > from &&
      run >= delimiter.length &&
      before !== undefined &&
      !/\s/.test(before) &&
      !(char === '_' && after !== undefined && WORD.test(after));
    if (closes) return at;
    j += run - 1;
  }
  return -1;
}

export function parseInline(text: string): Inline[] {
  const nodes: Inline[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) nodes.push({ type: 'text', text: buffer });
    buffer = '';
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i]!;

    if (char === '\\' && i + 1 < text.length && PUNCTUATION.test(text[i + 1]!)) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (char === '\n') {
      flush();
      nodes.push({ type: 'break' });
      i++;
      continue;
    }

    if (char === '`') {
      const run = runLength(text, i, '`');
      const close = findBacktickRun(text, i + run, run);
      if (close === -1) {
        buffer += text.slice(i, i + run);
      } else {
        flush();
        nodes.push({ type: 'code', text: codeSpanText(text.slice(i + run, close)) });
        i = close;
      }
      i += run;
      continue;
    }

    const delimiter = openingAt(text, i);
    if (delimiter) {
      const close = closingFor(text, i + delimiter.length, delimiter);
      if (close !== -1) {
        flush();
        nodes.push({
          type: KIND[delimiter],
          children: parseInline(text.slice(i + delimiter.length, close)),
        });
        i = close + delimiter.length;
        continue;
      }
    }

    // An unmatched run is literal text; consuming it whole keeps `**` from becoming `*` + `*`.
    const run = char === '*' || char === '_' || char === '~' ? runLength(text, i, char) : 1;
    buffer += text.slice(i, i + run);
    i += run;
  }
  flush();
  return nodes;
}
