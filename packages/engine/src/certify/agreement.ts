import { createHash } from 'node:crypto';
import type { CheckOutcome, FileChange, JsonValue } from '@architect/shared';
import { deriveSeed } from '../loop/seeds';

/**
 * Agreement across k attempts at one request (decision 077): each attempt's canonical answer is
 * its parsed structured answer with its file changes, normalized, and the graduate answers with
 * the most common one when enough attempts share it.
 */

/** Object keys sorted at every depth, so the same answer is the same text. */
function sorted(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sorted(value[key] as JsonValue)]),
  );
}

function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A table change by its rows in any order; any other file by its diff, trailing space dropped. */
function normalizedChange(change: FileChange): JsonValue {
  if (change.rows === undefined) {
    return { path: change.path, patch: change.patch.replace(/[ \t]+$/gm, '').trimEnd() };
  }
  const rows = (list: readonly unknown[]) => list.map((row) => JSON.stringify(row)).sort(byText);
  return {
    path: change.path,
    added: rows(change.rows.added),
    removed: rows(change.rows.removed),
    changed: rows(change.rows.changed),
  };
}

/**
 * A reply in words as two attempts that say the same thing share it: lowercase, each number
 * written one way (1,000.50 and 1000.5 alike), punctuation and spacing dropped.
 */
export function normalizedReply(text: string): string {
  const tokens = text.toLowerCase().match(/(?<![\p{L}\p{N}])-?\d[\d,]*(?:\.\d+)?|[\p{L}\p{N}]+/gu);
  return (tokens ?? [])
    .map((token) => {
      if (!/^-?\d/.test(token)) return token;
      const number = Number(token.replace(/,/g, ''));
      return Number.isFinite(number) ? String(number) : token;
    })
    .join(' ');
}

/**
 * The attempt's answer as one text two agreeing attempts share: answer, refusal and changes. A
 * chat reply's `text` counts only when it gave neither a structured answer nor a change, so
 * replies in words agree only when they say the same thing.
 */
export function canonicalAnswer(
  outcome: Pick<CheckOutcome, 'answer' | 'stopReason'>,
  changes: readonly FileChange[] = [],
  text?: string,
): string {
  const answer: JsonValue =
    outcome.stopReason === 'refused'
      ? { refused: true }
      : outcome.answer !== null
        ? { answer: sorted(outcome.answer) }
        : text !== undefined && changes.length === 0
          ? { said: normalizedReply(text) }
          : { none: true };
  const files = [...changes].sort((a, b) => byText(a.path, b.path)).map(normalizedChange);
  return JSON.stringify({ ...(answer as object), files });
}

/**
 * A sealed attempt's answer as a hash salted by its run: attempts at one task can be compared
 * without the store keeping what any of them answered.
 */
export function answerKey(
  runId: string,
  outcome: Pick<CheckOutcome, 'answer' | 'stopReason'>,
  changes?: readonly FileChange[],
): string {
  return createHash('sha256')
    .update(`${runId}\n${canonicalAnswer(outcome, changes)}`)
    .digest('hex');
}

/**
 * The k sampler seeds of a certified evaluation: the locked test's first seed, so its attempts
 * count, and k - 1 drawn from it.
 */
export function agreementSeeds(first: number, k: number): number[] {
  return Array.from({ length: k }, (_, index) =>
    index === 0 ? first : deriveSeed(first, `agree-${index + 1}`),
  );
}

export interface Vote<T> {
  /** The most common answer; ties go to the one an earlier attempt gave. */
  mode: string;
  /** Attempts that gave it. */
  votes: number;
  /** The first attempt that gave it. */
  chosen: T;
}

/** The most common of the attempts' answers, in attempt order; null when there are none. */
export function vote<T>(attempts: readonly T[], keyOf: (attempt: T) => string): Vote<T> | null {
  const counts = new Map<string, { votes: number; chosen: T }>();
  for (const attempt of attempts) {
    const key = keyOf(attempt);
    const seen = counts.get(key);
    if (seen) seen.votes += 1;
    else counts.set(key, { votes: 1, chosen: attempt });
  }
  let best: Vote<T> | null = null;
  for (const [mode, { votes, chosen }] of counts) {
    if (best === null || votes > best.votes) best = { mode, votes, chosen };
  }
  return best;
}
