import {
  costUsd,
  STUDENT_PRESETS,
  type CheckOutcome,
  type Expected,
  type Job,
  type Score,
  type StudentEndpoint,
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
