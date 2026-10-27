import { ANSWER_PREFIX, type JsonValue } from '@architect/shared';

export interface ParsedAnswer {
  /** The parsed value, or null when the line is missing or its JSON is invalid. */
  answer: JsonValue | null;
  /** Why there is no answer, in words the report and the mentor can show. */
  error?: string;
}

const FENCE_LINE = /^```[\w-]*$/;

/**
 * Reads the last line that starts with `ANSWER:` and parses the JSON after it strictly. Backticks
 * around the line or the JSON, and JSON that continues on the following lines (fenced or not),
 * are tolerated; anything else is reported as an error.
 */
export function parseAnswerLine(text: string): ParsedAnswer {
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = stripBackticks(lines[index] ?? '');
    if (!line.startsWith(ANSWER_PREFIX)) continue;
    return parseJsonAfter(line.slice(ANSWER_PREFIX.length), lines.slice(index + 1));
  }
  return { answer: null, error: `No line starts with ${ANSWER_PREFIX}` };
}

function parseJsonAfter(rest: string, following: readonly string[]): ParsedAnswer {
  const inline = stripBackticks(rest.trim().replace(/^```[\w-]*/, ''));
  const block = blockAfter(following);
  if (inline === '' && block === '') {
    return { answer: null, error: `The ${ANSWER_PREFIX} line has no JSON after it.` };
  }
  const candidates = inline === '' ? [block] : [inline, `${inline}\n${block}`];
  let firstError = '';
  for (const candidate of candidates) {
    try {
      return { answer: JSON.parse(candidate) as JsonValue };
    } catch (error) {
      firstError ||= error instanceof Error ? error.message : String(error);
    }
  }
  return { answer: null, error: `The JSON after ${ANSWER_PREFIX} is not valid: ${firstError}` };
}

/** The lines after the ANSWER line, up to a closing code fence, without an opening fence. */
function blockAfter(lines: readonly string[]): string {
  const trimmed = lines.map((line) => line.trim());
  const start = FENCE_LINE.test(trimmed[0] ?? '') ? 1 : 0;
  const end = trimmed.findIndex((line, index) => index >= start && line.startsWith('```'));
  return trimmed
    .slice(start, end === -1 ? undefined : end)
    .join('\n')
    .trim();
}

function stripBackticks(text: string): string {
  return text.trim().replace(/^`+/, '').replace(/`+$/, '').trim();
}
