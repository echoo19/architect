import type { JsonValue, Task } from '@architect/shared';
import { LETTERS, TODAY } from '../academy/build';
import type { Academy, Attempt, Question, Student, Topic } from '../academy/build';
import { MATH_KINDS, makeSolveItem } from '../academy/topics';
import type { Random } from '../lib/random';
import {
  eligibleQuestions,
  firstHints,
  nextIds,
  readPolicy,
  topicHistory,
} from '../reference/rules';
import type { JobFiles } from '../reference/tools';

/**
 * The six kinds of request Phil answers, eight of each per academy, written the way a tutor or
 * a student would ask. Expected values come from the construction where it decides them (the
 * right choice and the error behind each wrong one) and otherwise from the reference rules
 * applied to the academy's own files.
 */

export const SKILLS = ['diagnose', 'solve', 'hint', 'history', 'assign', 'after_wrong'] as const;
export type Skill = (typeof SKILLS)[number];
const PER_SKILL = 8;
/** An earlier cutoff some history requests ask about. */
const EARLIER = '2026-10-15';

/** A wrong answer as a request names it: who, which test, where in it, and the choice. */
export interface WrongAnswer {
  student: string;
  test_name: string;
  section: string;
  module: number;
  number: number;
  chosen: string;
}

export interface HistoryRequest {
  student: string;
  topic: string;
  as_of: string;
}

export interface AssignRequest {
  student: string;
  topic: string;
}

export interface SolveRequest {
  stem: string;
  choices: string[];
}

const ANSWER_LINES = {
  diagnose:
    'End with: ANSWER: {"topic": "<topic label>", "correct": "<A-D>", "error": "<error id>"}',
  hint: 'End with: ANSWER: {"topic": "<topic label>", "hint_id": "<hint id>"}',
  history:
    'End with: ANSWER: {"as_of": "<YYYY-MM-DD>", "window": <number>, "attempts": <number>, "correct": <number>, "accuracy_pct": <number>, "escalate": <true or false>}',
  assign: 'End with: ANSWER: {"assigned": <number of questions assigned>}',
  solve: 'End with: ANSWER: {"choice": "<A-D>", "answer": <number>, "step": <number>}',
  after_wrong:
    'End with: ANSWER: {"topic": "<topic label>", "correct": "<A-D>", "error": "<error id>", "hint_id": "<hint id>", "video_id": "<video id>", "assigned": <number>, "staff_note": <true or false>}',
} as const;

const TODAY_TEXT = "It's Monday, November 16, 2026.";

export interface TaskOptions {
  /** Prefer an escalation in the first tutoring turn, so two academies' turns visibly differ. */
  demoEscalates: boolean;
}

export function buildTasks(
  random: Random,
  academy: Academy,
  files: JobFiles,
  options: TaskOptions,
): Task[] {
  const context = new Context(academy, files);
  const tasks: Task[] = [
    ...diagnoseTasks(random.fork('diagnose'), context),
    ...solveTasks(random.fork('solve'), context),
    ...hintTasks(random.fork('hint'), context),
    ...historyTasks(random.fork('history'), context),
    ...assignTasks(random.fork('assign'), context),
    ...afterWrongTasks(random.fork('after_wrong'), context, options),
  ];
  return tasks;
}

/** What the task builders share: the academy, its files read as the agent's code reads them. */
class Context {
  readonly org: string;
  readonly policy;
  /** Wrong answers already used by a task, so each skill asks about different ones. */
  readonly taken = new Set<Attempt>();
  private readonly questions: Map<string, Question>;

  constructor(
    readonly academy: Academy,
    readonly files: JobFiles,
  ) {
    this.org = academy.style.id;
    this.policy = readPolicy(files.text('policy.md'));
    this.questions = new Map(academy.questions.map((q) => [q.question_id, q]));
  }

  question(id: string): Question {
    return this.questions.get(id)!;
  }

  student(id: string): Student {
    return this.academy.students.find((s) => s.student_id === id)!;
  }

  topic(label: string): Topic {
    return this.academy.topics.find((t) => t.label === label)!;
  }

  tutorName(student: Student): string {
    return this.academy.staff.find((s) => s.staff_id === student.tutor_id)!.name;
  }

  wrongAnswer(attempt: Attempt): WrongAnswer {
    return {
      student: this.student(attempt.student_id).name,
      test_name: this.academy.tests.find((t) => t.test_id === attempt.test_id)!.test_name,
      section: attempt.section,
      module: attempt.module,
      number: attempt.number,
      chosen: attempt.selected,
    };
  }

  /** The error ids behind a wrong choice, from how the question was built. */
  errorsBehind(attempt: Attempt): string[] {
    const item = this.question(attempt.question_id).item;
    const codes = item.errors[LETTERS.indexOf(attempt.selected as (typeof LETTERS)[number])]!;
    return this.academy.errors.filter((e) => codes.includes(e.code)).map((e) => e.error_id);
  }

  hintIds(attempt: Attempt): string[] {
    const rows = this.files.codeRows('hints.csv').filter((row) => row.topic === attempt.topic);
    return firstHints(rows, this.errorsBehind(attempt), this.policy);
  }

  history(studentId: string, topic: string, asOf: string) {
    const rows = this.files
      .codeRows('attempts.csv')
      .filter((row) => row.student_id === studentId && row.topic === topic);
    return topicHistory(rows, this.policy, asOf);
  }

  /** What assigning practice on a topic to a student must do. */
  practice(student: Student, topic: string) {
    const attempted = new Set(
      this.academy.attempts
        .filter((a) => a.student_id === student.student_id)
        .map((a) => a.question_id),
    );
    const assigned = new Set(
      this.academy.assignments
        .filter((a) => a.student_id === student.student_id)
        .map((a) => a.question_id),
    );
    const rows = this.files.codeRows('questions.csv').filter((row) => row.topic === topic);
    const eligible = eligibleQuestions(rows, attempted, assigned, this.policy);
    const count = Math.min(eligible.length, this.policy.practiceCount);
    return {
      eligible,
      params: {
        student_id: student.student_id,
        topic,
        count: this.policy.practiceCount,
        expected_count: count,
        band_low: this.policy.bandLow,
        band_high: this.policy.bandHigh,
        assigned_on: TODAY,
        assigned_by: student.tutor_id,
        assignment_ids: nextIds(
          this.academy.assignments.map((a) => a.assignment_id),
          count,
        ),
      },
    };
  }

  task(skill: Skill, index: number, family: string, prompt: string, rest: Partial<Task>): Task {
    return {
      id: `${this.org}-${skill}-${String(index + 1).padStart(2, '0')}`,
      type: skill,
      family: `${this.org}:${family}`,
      org: this.org,
      prompt: `${prompt}\n${ANSWER_LINES[skill]}`,
      expected: rest.expected!,
      meta: rest.meta!,
    };
  }
}

const where = (w: WrongAnswer) =>
  `question ${w.number} of ${w.section} module ${w.module} on ${w.test_name}`;

/** Wrong answers spread over students and topics, half from each section. */
function pickWrong(random: Random, context: Context, count: number, taken: Set<Attempt>) {
  const wrong = context.academy.attempts.filter((a) => a.result === 'wrong' && !taken.has(a));
  const picked: Attempt[] = [];
  for (const section of ['Math', 'Reading and Writing']) {
    const pool = random.shuffle(wrong.filter((a) => a.section === section));
    const seen = new Set<string>();
    for (const attempt of pool) {
      if (picked.length >= (section === 'Math' ? count / 2 : count)) break;
      const key = `${attempt.student_id} ${attempt.topic}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(attempt);
    }
  }
  picked.forEach((a) => taken.add(a));
  return picked;
}

function diagnoseTasks(random: Random, context: Context): Task[] {
  return pickWrong(random, context, PER_SKILL, context.taken).map((attempt, i) => {
    const w = context.wrongAnswer(attempt);
    const student = context.student(attempt.student_id);
    const prompt = random.chance(0.5)
      ? `${TODAY_TEXT} ${context.tutorName(student)} here. ${w.student} got ${where(w)} wrong and chose ${w.chosen}. What topic is it, what is the right choice, and which of our listed errors produces ${w.chosen}?`
      : `${TODAY_TEXT} Hi, I'm ${w.student}. I picked ${w.chosen} on ${where(w)} and it was wrong. Which topic was that, what was the right answer, and which error did my choice come from?`;
    return context.task('diagnose', i, `${attempt.student_id}:${attempt.topic}`, prompt, {
      expected: {
        kind: 'end_state',
        validator: 'diagnosis',
        params: {
          topic: attempt.topic,
          correct: attempt.correct,
          errors: context.errorsBehind(attempt),
        },
      },
      meta: { request: w as unknown as JsonValue, summary: `${attempt.topic}, ${attempt.correct}` },
    });
  });
}

function solveTasks(random: Random, context: Context): Task[] {
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
    const prompt = `${TODAY_TEXT} ${open}\n\n${item.stem}\n${choices}\n\nGive the right choice, the answer, and as step ${item.stepLabel}.`;
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

function hintTasks(random: Random, context: Context): Task[] {
  return pickWrong(random, context, PER_SKILL, context.taken).map((attempt, i) => {
    const w = context.wrongAnswer(attempt);
    const student = context.student(attempt.student_id);
    const prompt = random.chance(0.5)
      ? `${TODAY_TEXT} ${context.tutorName(student)} here. ${w.student} just chose ${w.chosen} on ${where(w)}. Before they try it again, which approved first hint should they get?`
      : `${TODAY_TEXT} This is ${w.student}. I chose ${w.chosen} on ${where(w)} and got it wrong. Can I have a hint before I try again? Don't tell me the answer.`;
    return context.task('hint', i, `${attempt.student_id}:${attempt.topic}`, prompt, {
      expected: {
        kind: 'end_state',
        validator: 'hint_chosen',
        params: { topic: attempt.topic, hint_ids: context.hintIds(attempt) },
      },
      meta: { request: w as unknown as JsonValue, summary: context.hintIds(attempt).join(' or ') },
    });
  });
}

function historyTasks(random: Random, context: Context): Task[] {
  const { academy } = context;
  const candidates = random
    .shuffle(
      academy.students.flatMap((student) =>
        academy.topics.flatMap((topic) =>
          [TODAY, EARLIER].map((asOf) => ({
            student,
            topic: topic.label,
            asOf,
            history: context.history(student.student_id, topic.label, asOf),
          })),
        ),
      ),
    )
    .filter((c) => c.history.attempts > 0);
  // Half that call for escalation, half that don't, and three of the eight as of an earlier date.
  const picked: typeof candidates = [];
  const seen = new Set<string>();
  for (const [escalate, asOf, count] of [
    [true, TODAY, 3],
    [false, TODAY, 2],
    [true, EARLIER, 1],
    [false, EARLIER, 2],
  ] as const) {
    let added = 0;
    for (const c of candidates) {
      const key = `${c.student.student_id} ${c.topic}`;
      if (added === count || seen.has(key)) continue;
      if (c.history.escalate !== escalate || c.asOf !== asOf) continue;
      seen.add(key);
      picked.push(c);
      added += 1;
    }
  }
  for (const c of candidates) {
    const key = `${c.student.student_id} ${c.topic}`;
    if (picked.length === PER_SKILL) break;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(c);
  }
  return picked.map((c, i) => {
    const when = c.asOf === TODAY ? 'as of today' : 'as of October 15, 2026';
    const prompt = random.chance(0.5)
      ? `${TODAY_TEXT} ${context.tutorName(c.student)} here. How is ${c.student.name} doing on ${c.topic}, ${when}? Use the history rules in our policy.`
      : `${TODAY_TEXT} Before Thursday's session: what does ${c.student.name}'s history on ${c.topic} look like ${when}, and does it call for escalation?`;
    const window = context.policy.window;
    return context.task('history', i, `${c.student.student_id}:${c.topic}`, prompt, {
      expected: {
        kind: 'facts',
        facts: [
          { path: 'as_of', value: c.asOf },
          { path: 'window', value: window },
          { path: 'attempts', value: c.history.attempts },
          { path: 'correct', value: c.history.correct },
          { path: 'accuracy_pct', value: c.history.accuracy_pct },
          { path: 'escalate', value: c.history.escalate },
        ],
      },
      meta: {
        request: { student: c.student.name, topic: c.topic, as_of: c.asOf },
        summary: `${c.history.correct}/${c.history.attempts}${c.history.escalate ? ', escalate' : ''}`,
      },
    });
  });
}

function assignTasks(random: Random, context: Context): Task[] {
  const { academy } = context;
  const candidates = random.shuffle(
    academy.students.flatMap((student) =>
      academy.topics.map((topic) => ({ student, topic: topic.label })),
    ),
  );
  const practiced = candidates.map((c) => ({ ...c, ...context.practice(c.student, c.topic) }));
  const count = context.policy.practiceCount;
  // Most with enough questions to choose from; two where fewer than the count qualify.
  const short = practiced.filter((c) => c.eligible.length > 0 && c.eligible.length < count);
  const plenty = [
    ...practiced.filter((c) => c.eligible.length > count),
    ...practiced.filter((c) => c.eligible.length === count),
  ];
  const picked = [...short.slice(0, 2)];
  picked.push(...plenty.slice(0, PER_SKILL - picked.length));
  return picked.map((c, i) => {
    const tutor = context.tutorName(c.student);
    const prompt = random.chance(0.5)
      ? `${TODAY_TEXT} ${tutor} here. Please set ${c.student.name}'s follow-up practice on ${c.topic}.`
      : `${TODAY_TEXT} ${c.student.name} wants more practice on ${c.topic}. Assign it the way our policy says.`;
    return context.task('assign', i, `${c.student.student_id}:${c.topic}`, prompt, {
      expected: { kind: 'end_state', validator: 'practice_assigned', params: c.params },
      meta: {
        request: { student: c.student.name, topic: c.topic },
        summary: `${c.params.expected_count} of ${c.eligible.length} eligible`,
      },
    });
  });
}

function afterWrongTasks(random: Random, context: Context, options: TaskOptions): Task[] {
  const { academy } = context;
  // Only answers from a student's latest sitting: the turn comes right after the wrong answer.
  const latest = new Map<string, string>();
  for (const a of academy.attempts) latest.set(a.student_id, `${a.taken_on} ${a.test_id}`);
  const fresh = academy.attempts.filter(
    (a) =>
      a.result === 'wrong' &&
      !context.taken.has(a) &&
      latest.get(a.student_id) === `${a.taken_on} ${a.test_id}`,
  );
  const escalates = (a: Attempt) => context.history(a.student_id, a.topic, TODAY).escalate;
  // The first is the same kind of wrong answer at every academy: agreement with the nearer noun.
  const nearer = academy.errors.find((e) => e.code === 'agreement-nearer-noun')!.error_id;
  // It assigns the policy's full count, and calls for a staff note or not as the options prefer.
  const full = (a: Attempt) => {
    const { params } = context.practice(context.student(a.student_id), a.topic);
    return params.expected_count === params.count;
  };
  const fit = (a: Attempt) => Number(full(a)) * 2 + Number(escalates(a) === options.demoEscalates);
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
  return picked.map((attempt, i) => {
    const w = context.wrongAnswer(attempt);
    const student = context.student(attempt.student_id);
    const practice = context.practice(student, attempt.topic);
    const escalate = escalates(attempt);
    const prompt = random.chance(0.5)
      ? `${TODAY_TEXT} ${w.student} just missed ${where(w)}; they chose ${w.chosen}. Take the tutoring turn our policy describes.`
      : `${TODAY_TEXT} I'm ${w.student}. I just got ${where(w)} wrong, I picked ${w.chosen}. What now?`;
    const note = nextIds(
      academy.notes.map((n) => n.note_id),
      1,
    )[0]!;
    return context.task('after_wrong', i, `${attempt.student_id}:${attempt.topic}`, prompt, {
      expected: {
        kind: 'end_state',
        validator: 'tutoring_turn',
        params: {
          correct: attempt.correct,
          errors: context.errorsBehind(attempt),
          hint_ids: context.hintIds(attempt),
          folder: context.topic(attempt.topic).folder,
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
