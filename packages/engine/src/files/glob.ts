import { DataError } from '../data/errors';

/** The longest pattern accepted, and the most paths its `{a,b}` choices may spell. */
const MAX_PATTERN_CHARS = 300;
const MAX_CHOICES = 64;

type Token =
  | { kind: 'char'; char: string }
  | { kind: 'one' }
  | { kind: 'set'; test: (char: string) => boolean }
  /** `*`: any characters within one name. */
  | { kind: 'star' }
  /** `**` inside a name: any characters, folders included. */
  | { kind: 'any' }
  /** `**` followed by `/`: zero or more whole folders. */
  | { kind: 'folders' };

/**
 * A glob pattern as a test on paths in the agent's folder. `*` matches within one name, `**`
 * across folders, `?` one character, `{a,b}` either alternative and `[abc]` one of a set. A
 * pattern without a "/" matches a file's name in any folder, as `*.csv` finds every CSV file.
 * Matching walks the path once per part of the pattern, so no pattern can make it slow, and a
 * pattern it can't read is a DataError the agent sees.
 */
export function globMatcher(pattern: string): (path: string) => boolean {
  const trimmed = pattern
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '');
  if (trimmed.length > MAX_PATTERN_CHARS) {
    throw new DataError(
      `The pattern is ${trimmed.length} characters; keep it under ${MAX_PATTERN_CHARS}.`,
    );
  }
  const byName = !trimmed.includes('/');
  const choices = expandBraces(trimmed).map(tokenize);
  return (path) => {
    const subject = byName ? path.slice(path.lastIndexOf('/') + 1) : path;
    return choices.some((tokens) => matches(tokens, subject));
  };
}

/** Every pattern `{a,b}` choices spell out, braces not nested. A lone `{` is just a character. */
function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf('{');
  const close = open === -1 ? -1 : pattern.indexOf('}', open);
  if (close === -1) return [pattern];
  const head = pattern.slice(0, open);
  const rest = expandBraces(pattern.slice(close + 1));
  const out: string[] = [];
  for (const choice of pattern.slice(open + 1, close).split(',')) {
    for (const tail of rest) {
      out.push(`${head}${choice}${tail}`);
      if (out.length > MAX_CHOICES) {
        throw new DataError(
          `The pattern spells more than ${MAX_CHOICES} paths with its { } choices.`,
        );
      }
    }
  }
  return out;
}

function tokenize(glob: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob.charAt(index);
    if (char === '*') {
      if (glob.charAt(index + 1) !== '*') {
        tokens.push({ kind: 'star' });
        continue;
      }
      let end = index + 1;
      while (glob.charAt(end + 1) === '*') end += 1;
      const wholeName =
        (index === 0 || glob.charAt(index - 1) === '/') && glob.charAt(end + 1) === '/';
      tokens.push({ kind: wholeName ? 'folders' : 'any' });
      index = wholeName ? end + 1 : end;
    } else if (char === '?') {
      tokens.push({ kind: 'one' });
    } else if (char === '[' && glob.indexOf(']', index + 2) !== -1) {
      const end = glob.indexOf(']', index + 2);
      tokens.push({ kind: 'set', test: setTest(glob.slice(index + 1, end)) });
      index = end;
    } else {
      tokens.push({ kind: 'char', char });
    }
  }
  return tokens;
}

/** A test for `[abc]`, `[a-z]` and `[!abc]` (or `[^abc]`). */
function setTest(body: string): (char: string) => boolean {
  const negated = body.startsWith('!') || body.startsWith('^');
  const members = negated ? body.slice(1) : body;
  const ranges: [string, string][] = [];
  for (let at = 0; at < members.length; at += 1) {
    const from = members.charAt(at);
    if (members.charAt(at + 1) === '-' && at + 2 < members.length) {
      const to = members.charAt(at + 2);
      if (to < from)
        throw new DataError(`[${body}] has a range that runs backwards, ${from}-${to}.`);
      ranges.push([from, to]);
      at += 2;
    } else {
      ranges.push([from, from]);
    }
  }
  return (char) => ranges.some(([from, to]) => char >= from && char <= to) !== negated;
}

/** Whether the tokens match the whole path: each token moves the set of reachable positions on. */
function matches(tokens: readonly Token[], path: string): boolean {
  const length = path.length;
  let reach = new Uint8Array(length + 1);
  reach[0] = 1;
  for (const token of tokens) {
    const next = new Uint8Array(length + 1);
    let any = false;
    const mark = (position: number) => {
      next[position] = 1;
      any = true;
    };
    if (token.kind === 'star' || token.kind === 'any' || token.kind === 'folders') {
      let open = false;
      for (let position = 0; position <= length; position += 1) {
        if (reach[position]) {
          open = true;
          mark(position);
        } else if (open && (token.kind !== 'folders' || path.charAt(position - 1) === '/')) {
          mark(position);
        }
        if (token.kind === 'star' && path.charAt(position) === '/') open = false;
      }
    } else {
      for (let position = 0; position < length; position += 1) {
        if (!reach[position]) continue;
        const char = path.charAt(position);
        const ok =
          token.kind === 'char'
            ? char === token.char
            : char !== '/' && (token.kind === 'one' || token.test(char));
        if (ok) mark(position + 1);
      }
    }
    if (!any) return false;
    reach = next;
  }
  return reach[length] === 1;
}
