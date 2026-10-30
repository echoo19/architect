import type { JsonValue, Task } from '@architect/shared';
import { LETTERS } from '../academy/build';
import type { Academy, Question } from '../academy/build';
import { MATH_KINDS, makeSolveItem } from '../academy/topics';
import type { Random } from '../lib/random';
import { firstHints, nextIds } from '../reference/rules';
import { cell } from '../reference/tools';
import type { CodeRow, JobFiles } from '../reference/tools';
import {
  PER_SKILL,
  Records,
  assignTasks,
  diagnoseTasks,
  historyTasks,
  pickWrong,
  where,
} from './records';

export { SKILLS } from './records';
export type { AssignRequest, HistoryRequest, Skill, SolveRequest, WrongAnswer } from './records';

/**
 * The six kinds of request Phil answers at a synthetic academy, eight of each, written the way a
 * tutor or a student would ask. Expected values come from the construction where it decides them
 * (the right choice and the error behind each wrong one) and otherwise from the reference rules
 * applied to the academy's own files.
 */

export interface TaskOptions {
  /** Prefer an escalation in the first tutoring turn, so two academies' turns visibly differ. */
  demoEscalates: boolean;
}

/** Diagnose tasks whose wrong choice two errors produce, when the academy has such answers. */
const AMBIGUOUS_DIAGNOSES = 2;

export function buildTasks(
  random: Random,
  academy: Academy,
  files: JobFiles,
  options: TaskOptions,
): Task[] {
  const context = new Synthetic(academy, files);
  const errorsOf = (attempt: CodeRow) => context.errorsBehind(attempt);
  const ambiguous = random.fork('ambiguous').sample(
    context
      .rows('attempts.csv')
      .filter((a) => a.result === 'wrong' && hasChoices(a) && errorsOf(a).length > 1),
    AMBIGUOUS_DIAGNOSES,
  );
  ambiguous.forEach((a) => context.taken.add(a));
  const wrong = [
    ...ambiguous,
    ...pickWrong(random.fork('diagnose'), context, PER_SKILL - ambiguous.length, hasChoices),
  ];
  return [
    ...diagnoseTasks(random.fork('diagnose prompts'), context, wrong, errorsOf),
    ...solveTasks(random.fork('solve'), context),
    ...hintTasks(random.fork('hint'), context),
    ...historyTasks(random.fork('history'), context),
    ...assignTasks(random.fork('assign'), context),
    ...afterWrongTasks(random.fork('after_wrong'), context, options),
  ];
}

/**
 * Whether an answer was to a question with choices. A grid-in has no choices and no errors behind
 * them, so diagnosing, hinting and tutoring ask only about questions with choices.
 */
const hasChoices = (attempt: CodeRow) => LETTERS.some((letter) => letter === attempt.correct);

/** A synthetic academy's records, with what its construction knows about each question. */
class Synthetic extends Records {
  private readonly questions: Map<string, Question>;

  constructor(
    readonly academy: Academy,
    files: JobFiles,
  ) {
    super(files, academy.style.id, academy.style.today);
    this.questions = new Map(academy.questions.map((q) => [q.question_id, q]));
  }

  /** The error ids behind a wrong choice, from how the question was built. */
  errorsBehind(attempt: CodeRow): string[] {
    const item = this.questions.get(cell(attempt, 'question_id'))!.item;
    const codes = item.errors[LETTERS.indexOf(attempt.selected as (typeof LETTERS)[number])]!;
    return this.academy.errors.filter((e) => codes.includes(e.code)).map((e) => e.error_id);
  }

  hintIds(attempt: CodeRow): string[] {
    const rows = this.onTopic('hints.csv', cell(attempt, 'topic'));
    return firstHints(rows, this.errorsBehind(attempt), this.policy);
  }

  folder(topic: string): string {
    return this.academy.topics.find((t) => t.label === this.label(topic))!.folder;
  }
}

function solveTasks(random: Random, context: Synthetic): Task[] {
  const kinds = [...MATH_KINDS, ...random.sample(MATH_KINDS, PER_SKILL - MATH_KINDS.length)];
  // A question from outside the keyed bank, so its answer can't be read off the files.
  const banked = new Set(context.academy.questions.map((q) => q.item.stem));
  return kinds.map((kind, i) => {
    let item = makeSolveItem(random, kind.kind, context.academy.style.phrasing);
    while (banked.has(item.stem)) {
      item = makeSolveItem(random, kind.kind, context.academy.style.phrasing);
    }
    banked.add(item.stem);
    const choices = item.choices.map((text, c) => `${LETTERS[c]}) ${text}`).join('\n');
    const open = random.chance(0.5)
      ? 'A student brought in this question from another book:'
      : 'Can you work this one? It is from a worksheet, not our bank:';
    const prompt = `${open}\n\n${item.stem}\n${choices}\n\nGive the right choice, the answer, and as step ${item.stepLabel}.`;
    return context.task('solve', i, `solve-${i + 1}`, prompt, {
      expected: {
        kind: 'facts',
        facts: [
          { path: 'choice', value: LETTERS[item.correct]! },
          { path: 'answer', value: item.answer! },
          { path: 'step', value: item.step! },
        ],
      },
      meta: {
        request: { stem: item.stem, choices: item.choices },
        summary: `${kind.kind}: ${item.answer}`,
      },
    });
  });
}

function hintTasks(random: Random, context: Synthetic): Task[] {
  return pickWrong(random, context, PER_SKILL, hasChoices).map((attempt, i) => {
    const w = context.wrongAnswer(attempt);
    const tutor = context.tutorName(context.student(cell(attempt, 'student_id')));
    const prompt = random.chance(0.5)
      ? `${tutor} here. ${w.student} just chose ${w.chosen} on ${where(w)}. Before they try it again, which approved first hint should they get?`
      : `This is ${w.student}. I chose ${w.chosen} on ${where(w)} and got it wrong. Can I have a hint before I try again? Don't tell me the answer.`;
    const topic = context.label(cell(attempt, 'topic'));
    return context.task('hint', i, `${attempt.student_id}:${topic}`, prompt, {
      expected: {
        kind: 'end_state',
        validator: 'hint_chosen',
        params: { topic, hint_ids: context.hintIds(attempt) },
      },
      meta: { request: w as unknown as JsonValue, summary: context.hintIds(attempt).join(' or ') },
    });
  });
}

function afterWrongTasks(random: Random, context: Synthetic, options: TaskOptions): Task[] {
  const attempts = context.rows('attempts.csv');
  // Only answers from a student's latest sitting: the turn comes right after the wrong answer.
  const latest = new Map<string, string>();
  for (const a of attempts) latest.set(cell(a, 'student_id'), `${a.taken_on} ${a.test_id}`);
  const fresh = attempts.filter(
    (a) =>
      a.result === 'wrong' &&
      hasChoices(a) &&
      !context.taken.has(a) &&
      latest.get(cell(a, 'student_id')) === `${a.taken_on} ${a.test_id}`,
  );
  const escalates = (a: CodeRow) =>
    context.history(cell(a, 'student_id'), cell(a, 'topic'), context.today).escalate;
  const practiceOf = (a: CodeRow) =>
    context.practice(context.student(cell(a, 'student_id')), context.label(cell(a, 'topic')));
  // The first is the same kind of wrong answer at every academy: agreement with the nearer noun.
  // It assigns the policy's full count, and calls for a staff note or not as the options prefer.
  const nearer = context.academy.errors.find((e) => e.code === 'agreement-nearer-noun')!.error_id;
  const full = (a: CodeRow) => {
    const { params } = practiceOf(a);
    return params.expected_count === params.count;
  };
  const fit = (a: CodeRow) => Number(full(a)) * 2 + Number(escalates(a) === options.demoEscalates);
  const demo = random
    .shuffle(fresh.filter((a) => context.errorsBehind(a).includes(nearer)))
    .sort((a, b) => fit(b) - fit(a))[0];
  if (!demo) throw new Error(`${context.org} has no fresh nearer-noun answer for the demo turn`);
  const picked = [demo];
  const seen = new Set([demo.student_id]);
  for (const attempt of random.shuffle(fresh)) {
    if (picked.length === PER_SKILL) break;
    if (seen.has(attempt.student_id)) continue;
    seen.add(attempt.student_id);
    picked.push(attempt);
  }
  const note = nextIds(
    context.academy.notes.map((n) => n.note_id),
    1,
  )[0]!;
  return picked.map((attempt, i) => {
    const w = context.wrongAnswer(attempt);
    const practice = practiceOf(attempt);
    const escalate = escalates(attempt);
    const prompt = random.chance(0.5)
      ? `${w.student} just missed ${where(w)}; they chose ${w.chosen}. Take the tutoring turn our policy describes.`
      : `I'm ${w.student}. I just got ${where(w)} wrong, I picked ${w.chosen}. What now?`;
    const topic = context.label(cell(attempt, 'topic'));
    return context.task('after_wrong', i, `${attempt.student_id}:${topic}`, prompt, {
      expected: {
        kind: 'end_state',
        validator: 'tutoring_turn',
        params: {
          correct: cell(attempt, 'correct'),
          errors: context.errorsBehind(attempt),
          hint_ids: context.hintIds(attempt),
          folder: context.folder(topic),
          ...practice.params,
          escalate,
          note_id: escalate ? note : null,
        },
      },
      meta: {
        request: w as unknown as JsonValue,
        summary: `${practice.params.expected_count} assigned${escalate ? ', staff note' : ''}`,
        ...(i === 0 ? { demo: 'nearer-noun' } : {}),
      },
    });
  });
}
