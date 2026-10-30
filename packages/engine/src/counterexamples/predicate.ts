import type { CounterexamplePredicate, JsonValue, Task } from '@architect/shared';
import type { SandboxOutcome } from '../sandbox/types';

export type Scalar = string | number | boolean;

function isScalar(value: JsonValue | undefined): value is Scalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function isObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The single values the checker's expectation holds, by field: a fact's last path segment, an
 * end-state validator's parameter, an object answer's key. Lists and objects are left out.
 */
export function expectedFields(task: Task): Record<string, Scalar> {
  const { expected } = task;
  const entries: [string, JsonValue][] =
    expected.kind === 'facts'
      ? expected.facts.map((fact) => [fact.path.split('.').at(-1) ?? fact.path, fact.value])
      : expected.kind === 'end_state'
        ? Object.entries(expected.params)
        : isObject(expected.value)
          ? Object.entries(expected.value)
          : [];
  const fields: Record<string, Scalar> = {};
  for (const [field, value] of entries) if (isScalar(value)) fields[field] = value;
  return fields;
}

/** Text with spaces, capitals and surrounding blanks set aside. */
export function normalText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A number written plainly or as a fraction (`0.125`, `1/8`), or null. */
function numberOf(value: Scalar): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const fraction = /^(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text);
  if (fraction) return Number(fraction[2]) === 0 ? null : Number(fraction[1]) / Number(fraction[2]);
  if (text === '' || !/^-?(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  return Number(text);
}

/** Two single values that say the same: the same number however written, or the same words. */
export function sameValue(a: JsonValue, b: JsonValue): boolean {
  if (!isScalar(a) || !isScalar(b)) return JSON.stringify(a) === JSON.stringify(b);
  const x = numberOf(a);
  const y = numberOf(b);
  if (x !== null && y !== null) return Math.abs(x - y) < 1e-9;
  return normalText(String(a)) === normalText(String(b));
}

/** Every value under `key` anywhere in a JSON value, depth first. */
export function valuesAt(value: JsonValue, key: string): JsonValue[] {
  if (Array.isArray(value)) return value.flatMap((item) => valuesAt(item, key));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([name, inner]) => [
    ...(name === key ? [inner] : []),
    ...valuesAt(inner, key),
  ]);
}

/**
 * An error message without the place in the code it was thrown from, so the same error thrown
 * from another line of a changed helper is still the same error.
 */
export function errorText(message: string): string {
  return message.replace(/\s*\([^()]*\.js:\d+(:\d+)?\)\s*$/, '');
}

/**
 * The failure of one helper call, or null when it did nothing wrong that can be shown. It threw;
 * or its output names a field the checker expects, and no value it gives there is the expected
 * one. A field the output doesn't name is no evidence: a lookup needn't return every field.
 */
export function detectFailure(
  outcome: SandboxOutcome,
  expected: Record<string, Scalar>,
): CounterexamplePredicate | null {
  if (!outcome.ok) return { kind: 'threw', message: errorText(outcome.failure.message) };
  for (const [field, value] of Object.entries(expected)) {
    const given = valuesAt(outcome.value, field);
    const got = given[0];
    if (got !== undefined && !given.some((one) => sameValue(one, value))) {
      return { kind: 'contradicts', field, expected: value, got };
    }
  }
  return null;
}

/**
 * Whether a run shows the same failure: the same error message, or the same wrong value in the
 * same field with the expected value nowhere in it.
 */
export function failureHolds(predicate: CounterexamplePredicate, outcome: SandboxOutcome): boolean {
  if (predicate.kind === 'threw') {
    return !outcome.ok && errorText(outcome.failure.message) === predicate.message;
  }
  if (!outcome.ok) return false;
  const given = valuesAt(outcome.value, predicate.field);
  return (
    given.some((one) => sameValue(one, predicate.got)) &&
    !given.some((one) => sameValue(one, predicate.expected))
  );
}
