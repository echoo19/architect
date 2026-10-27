import { createHash } from 'node:crypto';
import type { Task } from '@architect/shared';
import { z } from 'zod';

/** Long enough to be specific to one prompt, short enough to catch a partial copy. */
export const GRAM_WORDS = 8;
/** Prompts shorter than this are too generic to recognize as a whole. */
export const MIN_PROMPT_WORDS = 4;

export const FingerprintSchema = z.object({
  format: z.literal(1),
  jobId: z.string(),
  /** sha256 of test.jsonl, checked every time the locked test is opened. */
  testFileSha256: z.string(),
  gramWords: z.literal(GRAM_WORDS),
  tasks: z.array(
    z.object({
      id: z.string(),
      /** The prompt's words, when no other split's prompt contains them all in a row. */
      prompt: z.string().nullable(),
      /** Hashes of the prompt's word 8-grams that appear in no other split's prompt. */
      grams: z.array(z.string()),
    }),
  ),
});
export type Fingerprint = z.infer<typeof FingerprintSchema>;

export interface LeakScan {
  leaked: boolean;
  /** Ids of the test tasks whose wording appears in the text. Never the wording itself. */
  matchedIds: string[];
}

export interface LeakDetector {
  scan(text: string): LeakScan;
}

/**
 * The parts of each test prompt that identify it: n-grams and whole prompts that no train, dev
 * or calibration prompt shares, so template wording common to every split never counts as a leak.
 */
export function fingerprintTests(
  jobId: string,
  tests: readonly Task[],
  others: readonly Task[],
  testFileSha256: string,
): Fingerprint {
  const otherWords = others.map((task) => words(task.prompt));
  const otherGrams = new Set(otherWords.flatMap(gramHashes));
  const otherTexts = otherWords.map((tokens) => ` ${tokens.join(' ')} `);
  return {
    format: 1,
    jobId,
    testFileSha256,
    gramWords: GRAM_WORDS,
    tasks: tests.map((task) => {
      const tokens = words(task.prompt);
      const prompt = tokens.join(' ');
      const distinctive =
        tokens.length >= MIN_PROMPT_WORDS &&
        !otherTexts.some((text) => text.includes(` ${prompt} `));
      return {
        id: task.id,
        prompt: distinctive ? prompt : null,
        grams: [...new Set(gramHashes(tokens))].filter((hash) => !otherGrams.has(hash)),
      };
    }),
  };
}

export function createLeakDetector(fingerprint: Fingerprint): LeakDetector {
  const byGram = new Map<string, string[]>();
  for (const task of fingerprint.tasks) {
    for (const gram of task.grams) byGram.set(gram, [...(byGram.get(gram) ?? []), task.id]);
  }
  const prompts = fingerprint.tasks.flatMap((task) =>
    task.prompt === null ? [] : [{ id: task.id, text: ` ${task.prompt} ` }],
  );
  return {
    scan(text) {
      const tokens = words(text);
      const joined = ` ${tokens.join(' ')} `;
      const matched = new Set<string>();
      for (const prompt of prompts) if (joined.includes(prompt.text)) matched.add(prompt.id);
      for (const gram of gramHashes(tokens)) {
        for (const id of byGram.get(gram) ?? []) matched.add(id);
      }
      const matchedIds = [...matched].sort();
      return { leaked: matchedIds.length > 0, matchedIds };
    },
  };
}

/**
 * Lowercase words of a text. JSON string escapes are decoded first, so a prompt inside a
 * serialized payload reads the same as on its own.
 */
export function words(text: string): string[] {
  const decoded = text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\[nrtbf]/g, ' ');
  return (
    decoded
      .normalize('NFKC')
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function gramHashes(tokens: readonly string[]): string[] {
  const hashes: string[] = [];
  for (let start = 0; start + GRAM_WORDS <= tokens.length; start += 1) {
    const gram = tokens.slice(start, start + GRAM_WORDS).join(' ');
    hashes.push(createHash('sha256').update(gram).digest('hex').slice(0, 16));
  }
  return hashes;
}
