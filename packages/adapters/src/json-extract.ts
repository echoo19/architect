export type JsonObject = Record<string, unknown>;

type JsonExtraction = { ok: true; value: JsonObject } | { ok: false; error: string };

const FENCE = /```([A-Za-z0-9_+-]*)[^\n]*\n([\s\S]*?)```/g;

/**
 * Finds the JSON object in a model's reply: inside a fenced block when there is one (blocks
 * marked `json` first), otherwise anywhere in the text. The first complete object that parses
 * wins. An object that is cut off or malformed is reported as an error, never replaced by
 * whatever complete object happens to sit inside it.
 */
export function extractJsonObject(text: string): JsonExtraction {
  if (text.trim() === '') return { ok: false, error: 'The reply was empty.' };

  let firstError: string | undefined;
  for (const source of sources(text)) {
    const found = firstObjectIn(source);
    if (found.ok) return found;
    firstError ??= found.error;
  }
  return { ok: false, error: firstError ?? 'The reply contains no JSON object.' };
}

function sources(text: string): string[] {
  const blocks = [...text.matchAll(FENCE)].map((match) => ({
    tag: (match[1] ?? '').toLowerCase(),
    body: match[2] ?? '',
  }));
  return [
    ...blocks.filter((block) => block.tag === 'json').map((block) => block.body),
    ...blocks.filter((block) => block.tag !== 'json').map((block) => block.body),
    text,
  ];
}

function firstObjectIn(
  source: string,
): { ok: true; value: JsonObject } | { ok: false; error?: string } {
  let error: string | undefined;
  let start = source.indexOf('{');
  while (start !== -1) {
    const end = matchingBrace(source, start);
    if (end === -1) {
      // Everything after an unclosed brace belongs to it, so a reply cut off mid-object ends here.
      return {
        ok: false,
        error: error ?? 'The JSON object is not closed; the reply may have been cut off.',
      };
    }
    try {
      const value: unknown = JSON.parse(source.slice(start, end + 1));
      if (isObject(value)) return { ok: true, value };
      error ??= 'The reply holds JSON, but not an object.';
    } catch (cause) {
      error ??= cause instanceof Error ? cause.message : String(cause);
    }
    // Skip the whole failed object instead of looking inside it.
    start = source.indexOf('{', end + 1);
  }
  return error === undefined ? { ok: false } : { ok: false, error };
}

/** Index of the brace that closes the one at `start`, ignoring braces inside strings; -1 if none. */
function matchingBrace(source: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
