import { POLICY_SETTINGS } from '../academy/files';
import { MATH_SPECS, TOPIC_KINDS, numbersIn } from '../academy/topics';
import { addDays } from '../lib/calendar';
import type { CodeRow } from './tools';

/**
 * The academy's rules as the reference applies them, to rows as the agent's code reads them
 * (every value text). Every fact comes from the academy's own files: the numbers from the table
 * in policy.md, the labels, error ids and hint ids from the tables. What the reference knows on
 * its own is only the subject matter: how each kind of question is worked and how each named
 * error turns a right answer into a wrong one.
 */

export interface Policy {
  practiceCount: number;
  bandLow: number;
  bandHigh: number;
  window: number;
  escalateWrong: number;
  escalateDays: number;
  counts: 'first' | 'every';
  hintRule: 'targeted' | 'general';
}

/** The policy's numbers, from the table at the end of policy.md. */
export function readPolicy(text: string): Policy {
  const value = (setting: string): string => {
    const line = text.split('\n').find((row) => row.startsWith(`| ${setting} |`));
    if (!line) throw new Error(`policy.md has no row "${setting}"`);
    return line.split('|')[2]!.trim();
  };
  const number = (setting: string) => Number(value(setting));
  return {
    practiceCount: number(POLICY_SETTINGS.practiceCount),
    bandLow: number(POLICY_SETTINGS.bandLow),
    bandHigh: number(POLICY_SETTINGS.bandHigh),
    window: number(POLICY_SETTINGS.window),
    escalateWrong: number(POLICY_SETTINGS.escalateWrong),
    escalateDays: number(POLICY_SETTINGS.escalateDays),
    counts: value(POLICY_SETTINGS.counts).startsWith('first') ? 'first' : 'every',
    hintRule: value(POLICY_SETTINGS.hintRule).includes('error') ? 'targeted' : 'general',
  };
}

export interface History {
  attempts: number;
  correct: number;
  accuracy_pct: number;
  escalate: boolean;
}

/** A student's history on one topic from their attempts on it, as of a date. */
export function topicHistory(rows: readonly CodeRow[], policy: Policy, asOf: string): History {
  const ordered = rows
    .filter((row) => row.taken_on! <= asOf)
    .sort(
      (a, b) =>
        compare(a.taken_on!, b.taken_on!) ||
        Number(a.module) - Number(b.module) ||
        Number(a.number) - Number(b.number),
    );
  const counted =
    policy.counts === 'first'
      ? ordered.filter(
          (row, i) => ordered.findIndex((other) => other.question_id === row.question_id) === i,
        )
      : ordered;
  const latest = counted.slice(-policy.window);
  const correct = latest.filter((row) => row.result === 'right').length;
  const since = addDays(asOf, 1 - policy.escalateDays);
  const recentWrong = counted.filter(
    (row) => row.taken_on! >= since && row.result === 'wrong',
  ).length;
  return {
    attempts: latest.length,
    correct,
    accuracy_pct: latest.length === 0 ? 0 : Math.floor((100 * correct) / latest.length + 0.5),
    escalate: recentWrong >= policy.escalateWrong,
  };
}

/**
 * The bank questions a student may be assigned on a topic: never attempted by them, not already
 * assigned to them, and inside the policy's difficulty band. In bank order.
 */
export function eligibleQuestions(
  topicQuestions: readonly CodeRow[],
  attempted: ReadonlySet<string>,
  assigned: ReadonlySet<string>,
  policy: Policy,
): string[] {
  return topicQuestions
    .filter((row) => {
      const difficulty = Number(row.difficulty_pct);
      return (
        !attempted.has(row.question_id!) &&
        !assigned.has(row.question_id!) &&
        difficulty >= policy.bandLow &&
        difficulty <= policy.bandHigh
      );
    })
    .map((row) => row.question_id!);
}

/**
 * The next `count` ids after the highest in `existing`, in its format. A file with no ids yet
 * starts after `none` (A-0001 first, as the policy says).
 */
export function nextIds(existing: readonly string[], count: number, none = 'A-0000'): string[] {
  const parsed = (existing.length > 0 ? existing : [none]).map((id) => {
    const match = /^(.*?)(\d+)$/.exec(id);
    if (!match) throw new Error(`An id without a number: ${id}`);
    return { prefix: match[1]!, digits: match[2]!, number: Number(match[2]) };
  });
  const highest = parsed.reduce((best, id) => (id.number > best.number ? id : best));
  return Array.from(
    { length: count },
    (_, i) => highest.prefix + String(highest.number + i + 1).padStart(highest.digits.length, '0'),
  );
}

/** The ids of the approved first hints the policy allows, given the errors behind the choice. */
export function firstHints(
  topicHints: readonly CodeRow[],
  errorIds: readonly string[],
  policy: Policy,
): string[] {
  const general = topicHints.filter((row) => row.error_id === '').map((row) => row.hint_id!);
  if (policy.hintRule === 'general') return general;
  const targeted = topicHints
    .filter((row) => errorIds.includes(row.error_id!))
    .map((row) => row.hint_id!);
  return targeted.length > 0 ? targeted : general;
}

/**
 * The ids of the errors (of the question's topic) that produce the chosen choice. For math the
 * numbers of the question are put through each error; for grammar the chosen phrase is read
 * against the right one.
 */
export function errorsBehind(
  question: CodeRow,
  chosen: string,
  topicErrors: readonly CodeRow[],
): string[] {
  const choice = (letter: string) => question[`choice_${letter.toLowerCase()}`]!;
  const picked = choice(chosen);
  const right = choice(question.correct!);
  return topicErrors
    .filter((row) => producesChoice(row.name!, question.stem!, right, picked))
    .map((row) => row.error_id!);
}

function producesChoice(errorName: string, stem: string, right: string, picked: string): boolean {
  const kind = TOPIC_KINDS.find((topic) => topic.errors.some((e) => e.name === errorName));
  if (!kind) throw new Error(`No error named "${errorName}"`);
  const code = kind.errors.find((e) => e.name === errorName)!.code;
  const spec = MATH_SPECS.find((s) => s.kind === kind.kind);
  if (spec) {
    const error = spec.errors.find((e) => e.code === code)!;
    return error.value(numbersIn(stem)) === Number(picked);
  }
  return grammarError(kind.kind, right, picked) === code;
}

// Present-tense verbs whose plural is not the singular without its final s.
const PLURALS: Record<string, string> = { is: 'are', has: 'have' };
const TRANSITION_CODES: Record<string, string> = {
  However: 'transition-contrast',
  Therefore: 'transition-result',
  'For example': 'transition-example',
  'In addition': 'transition-addition',
};

/** The error a wrong grammar choice shows, read from the phrase itself. */
function grammarError(kind: string, right: string, picked: string): string {
  switch (kind) {
    case 'agreement':
      if (picked.endsWith('ing')) return 'agreement-no-main-verb';
      if (picked === (PLURALS[right] ?? right.replace(/s$/, ''))) return 'agreement-nearer-noun';
      return 'agreement-tense-shift';
    case 'pronoun':
      if (picked === 'their') return 'pronoun-plural';
      if (picked === "it's") return 'pronoun-contraction';
      return 'pronoun-person';
    case 'comparison':
      if (picked.endsWith("'s")) return 'comparison-double-possessive';
      if (/^(that|those) of /.test(picked)) return 'comparison-number';
      return 'comparison-illogical';
    case 'tense':
      if (/^(has|have) /.test(picked)) return 'tense-perfect';
      if (picked.startsWith('will ')) return 'tense-future';
      return 'tense-present';
    case 'boundary':
      if (picked.includes('; and ')) return 'boundary-semicolon-conjunction';
      if (picked.includes(',')) return 'boundary-comma-splice';
      return 'boundary-fused';
    case 'transition':
      return TRANSITION_CODES[picked] ?? `not a transition: ${right}`;
    default:
      throw new Error(`No grammar kind ${kind}`);
  }
}

/** Works a math question given in a request: its kind from the wording, then the numbers. */
export function workQuestion(stem: string): { answer: number; step: number } {
  const spec = MATH_SPECS.find((s) => s.pattern.test(stem));
  if (!spec) throw new Error(`No math kind reads "${stem}"`);
  const numbers = numbersIn(stem);
  return { answer: spec.answer(numbers), step: spec.step(numbers) };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
