import {
  costUsd,
  STUDENT_PRESETS,
  type CheckOutcome,
  type CheckResult,
  type Expected,
  type Job,
  type JsonValue,
  type Score,
  type StudentEndpoint,
  type Task,
  type TypeScore,
  type Usage,
} from '@architect/shared';
import { scoreByType } from '../mentor/view';
import type { StoredAttempt } from '../store/records';

const SUMMARY_MAX = 80;

function shorten(text: string): string {
  return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1)}…`;
}

/** The agent's answer in a few words, for result tables. */
export function answerSummary(outcome: CheckOutcome): string {
  if (outcome.stopReason === 'refused') return 'Refused';
  if (outcome.answer === null) return outcome.answerError ? 'Malformed answer' : 'No answer';
  return shorten(JSON.stringify(outcome.answer));
}

/** The expected result in a few words, shown next to a wrong answer. */
export function expectedSummary(expected: Expected): string {
  switch (expected.kind) {
    case 'answer':
      return shorten(JSON.stringify(expected.value));
    case 'facts':
      return shorten(
        expected.facts.map((fact) => `${fact.path} = ${JSON.stringify(fact.value)}`).join(', '),
      );
    case 'end_state':
      return shorten(`${expected.validator} ${JSON.stringify(expected.params)}`);
  }
}

/** Names a locked-test reason may show: letters and underscores, so an id used as a key never is. */
const FIELD_NAME = /^[A-Za-z][A-Za-z_]*$/;

function keysOf(value: JsonValue): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

/** The names a task's expected result is made of: its answer's keys, fact paths or params. */
function expectedFields(expected: Expected): string[] {
  switch (expected.kind) {
    case 'answer':
      return keysOf(expected.value);
    case 'facts':
      return expected.facts.flatMap((fact) => fact.path.split(/[.[\]]/));
    case 'end_state':
      return keysOf(expected.params);
  }
}

/** The field a reason mentions first, as a whole word, or null when it names none. */
function namedField(reason: string, fields: readonly string[]): string | null {
  let first: { field: string; at: number } | null = null;
  for (const field of new Set(fields)) {
    if (!FIELD_NAME.test(field)) continue;
    const at = reason.search(new RegExp(`(?<![A-Za-z0-9_])${field}(?![A-Za-z0-9_])`));
    if (at >= 0 && (first === null || at < first.at)) first = { field, at };
  }
  return first?.field ?? null;
}

/**
 * What a locked-test attempt keeps of its check: pass or fail and, for a failure, the field of
 * the task's expected result that the checker's reason names first. No expected or actual value
 * and no details survive, so test answers stay in the vault.
 */
export function lockedCheck(task: Task, check: CheckResult): CheckResult {
  if (check.pass) return { pass: true, reason: 'Passed.' };
  const field = namedField(check.reason, expectedFields(task.expected));
  return { pass: false, reason: field === null ? 'Failed.' : `Failed: ${field} is wrong.` };
}

/** Dollars for one student call: free on this machine, list price for a known hosted copy. */
export function studentPrice(
  endpoint: StudentEndpoint,
  isLocal: boolean,
): (usage: Usage) => number | null {
  if (isLocal) return () => 0;
  const pricing = STUDENT_PRESETS.find(
    (preset) => preset.baseUrl === endpoint.baseUrl && preset.model === endpoint.model,
  )?.pricing;
  return pricing ? (usage) => costUsd(pricing, usage) : () => null;
}

export interface EvaluationResult {
  score: Score;
  perType: TypeScore[];
}

export function resultOf(attempts: readonly StoredAttempt[], job: Job): EvaluationResult {
  return {
    score: {
      pass: attempts.filter((attempt) => attempt.check.pass).length,
      total: attempts.length,
    },
    perType: scoreByType(
      attempts.map((attempt) => ({ type: attempt.taskType, pass: attempt.check.pass })),
      job,
    ),
  };
}
