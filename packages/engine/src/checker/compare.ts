import type { AnswerCompare, JsonValue } from '@architect/shared';
import { parseNumber } from '../data/numbers';

type Segment = string | number;
type JsonObject = { [key: string]: JsonValue };

/** A job's task definition is inconsistent, so it can't be graded as written. */
export class TaskDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskDefinitionError';
  }
}

/**
 * Compares an answer with the expected value and returns the first difference as one sentence,
 * or null when they match. Strings compare trimmed, case-insensitive and with whitespace
 * collapsed; a number equals the same number written as text; object key order doesn't matter.
 */
export function compareAnswer(
  actual: JsonValue,
  expected: JsonValue,
  compare: AnswerCompare,
): string | null {
  const tolerance = compare.mode === 'number' ? (compare.tolerance ?? 0) : 0;
  if ((compare.keys || compare.setKeys) && isObject(expected)) {
    return compareKeys(actual, expected, compare, tolerance);
  }
  if (compare.mode === 'set' && Array.isArray(expected)) return setDifference(actual, expected, []);
  return difference(actual, expected, [], tolerance);
}

/** Checks that every dotted path (`customer.name`, `items.0.cents`) in the answer holds its value. */
export function checkFacts(
  answer: JsonValue,
  facts: readonly { path: string; value: JsonValue }[],
): string | null {
  for (const fact of facts) {
    const path = parsePath(fact.path);
    const found = lookup(answer, path);
    if (found === undefined) {
      return `The answer has no ${describePath(path)}; expected ${show(fact.value)}.`;
    }
    const mismatch = difference(found, fact.value, path, 0);
    if (mismatch) return mismatch;
  }
  return null;
}

function compareKeys(
  actual: JsonValue,
  expected: JsonObject,
  compare: AnswerCompare,
  tolerance: number,
): string | null {
  if (!isObject(actual)) return `Expected the answer to be an object, but it is ${show(actual)}.`;
  const setKeys = new Set(compare.setKeys ?? []);
  for (const key of compare.keys ?? Object.keys(expected).sort()) {
    const wanted = expected[key];
    if (wanted === undefined) {
      throw new TaskDefinitionError(
        `The task compares "${key}", but its expected value has no such key.`,
      );
    }
    if (!Object.hasOwn(actual, key)) return `The answer has no ${key}; expected ${show(wanted)}.`;
    const value = actual[key] as JsonValue;
    const useSet = Array.isArray(wanted) && (setKeys.has(key) || compare.mode === 'set');
    const mismatch = useSet
      ? setDifference(value, wanted, [key])
      : difference(value, wanted, [key], tolerance);
    if (mismatch) return mismatch;
  }
  if (!compare.keys) return unexpectedKey(actual, expected, []);
  return null;
}

function difference(
  actual: JsonValue,
  expected: JsonValue,
  path: Segment[],
  tolerance: number,
): string | null {
  const where = describePath(path);
  const expectedNumber = asNumber(expected);
  if (expectedNumber !== null) {
    const actualNumber = asNumber(actual);
    if (actualNumber !== null && Math.abs(actualNumber - expectedNumber) <= tolerance) return null;
    const within = tolerance > 0 ? ` (within ${tolerance})` : '';
    return `Expected ${where} to be ${show(expected)}${within}, but it is ${show(actual)}.`;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return `Expected ${where} to be a list, but it is ${show(actual)}.`;
    const shared = Math.min(actual.length, expected.length);
    for (let index = 0; index < shared; index += 1) {
      const mismatch = difference(
        actual[index] as JsonValue,
        expected[index] as JsonValue,
        [...path, index],
        tolerance,
      );
      if (mismatch) return mismatch;
    }
    if (actual.length !== expected.length) {
      return `Expected ${where} to have ${count(expected.length, 'item')}, but it has ${actual.length}.`;
    }
    return null;
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return `Expected ${where} to be an object, but it is ${show(actual)}.`;
    for (const key of Object.keys(expected).sort()) {
      const inner = [...path, key];
      if (!Object.hasOwn(actual, key)) {
        return `The answer has no ${describePath(inner)}; expected ${show(expected[key] as JsonValue)}.`;
      }
      const mismatch = difference(
        actual[key] as JsonValue,
        expected[key] as JsonValue,
        inner,
        tolerance,
      );
      if (mismatch) return mismatch;
    }
    return unexpectedKey(actual, expected, path);
  }
  return canonicalKey(actual) === canonicalKey(expected)
    ? null
    : `Expected ${where} to be ${show(expected)}, but it is ${show(actual)}.`;
}

function setDifference(
  actual: JsonValue,
  expected: readonly JsonValue[],
  path: Segment[],
): string | null {
  const where = describePath(path);
  if (!Array.isArray(actual)) return `Expected ${where} to be a list, but it is ${show(actual)}.`;
  const have = new Set(actual.map(canonicalKey));
  const want = new Set(expected.map(canonicalKey));
  const missing = expected.find((item) => !have.has(canonicalKey(item)));
  if (missing !== undefined)
    return `Expected ${where} to include ${show(missing)}, but it does not.`;
  const extra = actual.find((item) => !want.has(canonicalKey(item)));
  if (extra !== undefined) {
    return `${capitalize(where)} includes ${show(extra)}, which was not expected.`;
  }
  return null;
}

function unexpectedKey(actual: JsonObject, expected: JsonObject, path: Segment[]): string | null {
  const extra = Object.keys(actual)
    .sort()
    .find((key) => !Object.hasOwn(expected, key));
  return extra === undefined
    ? null
    : `The answer has an unexpected key ${describePath([...path, extra])}.`;
}

/** Text is compared trimmed, lowercase and with single spaces; numeric text as a number. */
function canonical(value: JsonValue): JsonValue {
  if (typeof value === 'string') {
    return parseNumber(value) ?? value.trim().replace(/\s+/g, ' ').toLowerCase();
  }
  if (typeof value === 'number') return value === 0 ? 0 : value;
  if (Array.isArray(value)) return value.map(canonical);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key] as JsonValue)]),
    );
  }
  return value;
}

function canonicalKey(value: JsonValue): string {
  return JSON.stringify(canonical(value));
}

function asNumber(value: JsonValue): number | null {
  if (typeof value === 'number') return value;
  return typeof value === 'string' ? parseNumber(value) : null;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePath(path: string): Segment[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment !== '')
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function lookup(value: JsonValue, path: readonly Segment[]): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const segment of path) {
    if (Array.isArray(current) && typeof segment === 'number') current = current[segment];
    else if (isObject(current) && Object.hasOwn(current, String(segment))) {
      current = current[String(segment)];
    } else return undefined;
  }
  return current;
}

/** `customers[2].overdue_cents`, or `the answer[0]` when the answer itself is a list. */
function describePath(path: readonly Segment[]): string {
  if (path.length === 0) return 'the answer';
  const rendered = path
    .map((segment, index) =>
      typeof segment === 'number' ? `[${segment}]` : index === 0 ? segment : `.${segment}`,
    )
    .join('');
  return typeof path[0] === 'number' ? `the answer${rendered}` : rendered;
}

function show(value: JsonValue): string {
  const text = JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
