import { createHash } from 'node:crypto';
import type { Expected, JsonValue, Task } from '@architect/shared';
import { z } from 'zod';

/** Long enough to be specific to one prompt, short enough to catch a partial copy. */
export const GRAM_WORDS = 8;
/** Prompts shorter than this are too generic to recognize as a whole. */
export const MIN_PROMPT_WORDS = 4;
/** Letters and digits an id needs before it points at one task, like `INV-2367`. */
export const MIN_ID_CHARS = 5;
/** Digits an amount needs; shorter numbers turn up by chance in the student's own arithmetic. */
export const MIN_AMOUNT_DIGITS = 6;

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
      /**
       * Hashes of the word 8-grams of the prompt and of the expected result, as the task states
       * it and with its keys sorted, that no other task's prompt or expected result contains.
       */
      grams: z.array(z.string()),
      /**
       * The words of the task's id and of the long ids and amounts its expected result holds,
       * when no other task and none of the job's data contains them. Older fingerprints have none.
       */
      values: z.array(z.string()).default([]),
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
 * What identifies each test task: its prompt, whole and in n-grams; its expected result in
 * n-grams; and its id with the long ids and amounts it expects. Whatever another split's task
 * or the job's data also holds is left out, so template wording and the values every attempt
 * reads from the data never count as a leak.
 */
export function fingerprintTests(
  jobId: string,
  tests: readonly Task[],
  others: readonly Task[],
  data: readonly string[],
  testFileSha256: string,
): Fingerprint {
  const otherPrompts = others.map((task) => words(task.prompt));
  const otherTexts = otherPrompts.map((tokens) => ` ${tokens.join(' ')} `);
  const otherGrams = new Set(
    others
      .flatMap((task) => [words(task.prompt), ...expectedWords(task.expected)])
      .flatMap(gramHashes),
  );
  const knownWords = [...others.flatMap(taskTexts), ...data].map((text) => words(text).join(' '));
  const known = ` ${knownWords.join(' ')} `;
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
      const grams = [tokens, ...expectedWords(task.expected)].flatMap(gramHashes);
      const values = [task.id, ...expectedScalars(task.expected)]
        .map((value) => words(String(value)))
        .filter(specific)
        .map((value) => value.join(' '));
      return {
        id: task.id,
        prompt: distinctive ? prompt : null,
        grams: [...new Set(grams)].filter((hash) => !otherGrams.has(hash)),
        values: [...new Set(values)].filter((value) => !known.includes(` ${value} `)),
      };
    }),
  };
}

export function createLeakDetector(fingerprint: Fingerprint): LeakDetector {
  const byGram = new Map<string, string[]>();
  for (const task of fingerprint.tasks) {
    for (const gram of task.grams) byGram.set(gram, [...(byGram.get(gram) ?? []), task.id]);
  }
  const wholes = fingerprint.tasks.flatMap((task) =>
    [...(task.prompt === null ? [] : [task.prompt]), ...task.values].map((text) => ({
      id: task.id,
      text: ` ${text} `,
    })),
  );
  return {
    scan(text) {
      const tokens = words(text);
      const joined = ` ${tokens.join(' ')} `;
      const matched = new Set<string>();
      for (const whole of wholes) if (joined.includes(whole.text)) matched.add(whole.id);
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

/** Everything a task says: its id, its prompt and its expected result. */
function taskTexts(task: Task): string[] {
  return [task.id, task.prompt, JSON.stringify(task.expected)];
}

/** The expected result's words, as the task states it and with every object's keys sorted. */
function expectedWords(expected: Expected): string[][] {
  return [JSON.stringify(expected), JSON.stringify(sortedKeys(expected))].map(words);
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (value === null || typeof value !== 'object') return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(object)
      .sort()
      .map((key) => [key, sortedKeys(object[key])]),
  );
}

/** The strings and numbers a task expects, wherever they sit in its expected result. */
function expectedScalars(expected: Expected): (string | number)[] {
  switch (expected.kind) {
    case 'answer':
      return leaves(expected.value);
    case 'facts':
      return expected.facts.flatMap((fact) => leaves(fact.value));
    case 'end_state':
      return leaves(expected.params);
  }
}

function leaves(value: JsonValue): (string | number)[] {
  if (typeof value === 'string' || typeof value === 'number') return [value];
  if (Array.isArray(value)) return value.flatMap(leaves);
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(leaves);
}

/** A long id (`INV-2367`, `B-3001`) or a long amount: specific enough to point at one task. */
function specific(tokens: readonly string[]): boolean {
  const [first] = tokens;
  if (first === undefined) return false;
  if (tokens.length === 1 && /^\p{N}+$/u.test(first)) return first.length >= MIN_AMOUNT_DIGITS;
  return (
    /^\p{L}/u.test(first) &&
    tokens.some((token) => /\p{N}/u.test(token)) &&
    tokens.join('').length >= MIN_ID_CHARS
  );
}
