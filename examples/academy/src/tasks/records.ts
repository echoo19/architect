import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TaskSchema } from '@architect/shared';
import type { JsonValue, Task } from '@architect/shared';
import { addDays, longDate, monthDay } from '../lib/calendar';
import { Random } from '../lib/random';
import {
  eligibleQuestions,
  historyWindow,
  nextIds,
  readPolicy,
  topicHistory,
  topicKey,
} from '../reference/rules';
import type { Policy } from '../reference/rules';
import { JobFiles, cell } from '../reference/tools';
import type { CodeRow } from '../reference/tools';

/**
 * Tasks built from an academy's records alone, as the agent's code reads them. The synthetic
 * academies use these for `history` and `assign`, and a real academy's export, which has no
 * question text, no errors and no hints, gets only these: `history`, `assign`, and `diagnose`
 * limited to the topic and the right choice.
 */

export const SKILLS = ['diagnose', 'solve', 'hint', 'history', 'assign', 'after_wrong'] as const;
export type Skill = (typeof SKILLS)[number];
export const PER_SKILL = 8;

/**
 * A wrong answer as a request names it: who, which test, where in it, and the choice. Where an
 * academy numbers its tests straight through, a request names no section or module; where the
 * records leave the module blank, it names no module.
 */
export interface WrongAnswer {
  student: string;
  test_name: string;
  section: string | null;
  module: number | null;
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
  diagnose_records: 'End with: ANSWER: {"topic": "<topic label>", "correct": "<A-D>"}',
  hint: 'End with: ANSWER: {"topic": "<topic label>", "hint_id": "<hint id>"}',
  history:
    'End with: ANSWER: {"as_of": "<YYYY-MM-DD>", "window": <number>, "attempts": <number>, "correct": <number>, "accuracy_pct": <number>, "escalate": <true or false>}',
  assign: 'End with: ANSWER: {"assigned": <number of questions assigned>}',
  solve: 'End with: ANSWER: {"choice": "<A-D>", "answer": <number>, "step": <number>}',
  after_wrong:
    'End with: ANSWER: {"topic": "<topic label>", "correct": "<A-D>", "error": "<error id>", "hint_id": "<hint id>", "video_id": "<video id>", "assigned": <number>, "staff_note": <true or false>}',
} as const;

/** An academy's records, read the way the agent's code reads them, and what tasks share. */
export class Records {
  readonly policy: Policy;
  readonly todayText: string;
  /** Wrong answers already used by a task, so each skill asks about different ones. */
  readonly taken = new Set<CodeRow>();

  constructor(
    readonly files: JobFiles,
    readonly org: string,
    /** The date the requests are made on, and the records are current as of. */
    readonly today: string,
  ) {
    this.policy = readPolicy(files.text('policy.md'));
    this.todayText = `It's ${longDate(today)}.`;
  }

  rows(name: string): readonly CodeRow[] {
    return this.files.has(name) ? this.files.codeRows(name) : [];
  }

  /** The rows of a table on a topic, however each row writes its label. */
  onTopic(name: string, topic: string): CodeRow[] {
    return this.rows(name).filter((row) => topicKey(cell(row, 'topic')) === topicKey(topic));
  }

  /** A topic's label as the academy lists it, for a label written any other way. */
  label(topic: string): string {
    const label = this.topics().find((t) => topicKey(t) === topicKey(topic));
    if (label === undefined) throw new Error(`No topic reads "${topic}"`);
    return label;
  }

  /** Whether the academy's tests number their questions straight through, one number a question. */
  numberedThrough(): boolean {
    const seen = new Set<string>();
    for (const row of this.rows('tests.csv')) {
      const position = `${row.test_id} ${row.number}`;
      if (seen.has(position)) return false;
      seen.add(position);
    }
    return true;
  }

  students(): readonly CodeRow[] {
    return this.rows('students.csv');
  }

  student(id: string): CodeRow {
    return this.students().find((s) => s.student_id === id)!;
  }

  /** The topic labels: topics.csv, or the topics the attempts name when there is none. */
  topics(): string[] {
    const listed = this.rows('topics.csv').map((row) => cell(row, 'topic'));
    const named =
      listed.length > 0 ? listed : this.rows('attempts.csv').map((r) => cell(r, 'topic'));
    const byKey = new Map<string, string>();
    for (const label of named) if (!byKey.has(topicKey(label))) byKey.set(topicKey(label), label);
    return [...byKey.values()];
  }

  /** The name of a student's tutor, or null when the records don't give one. */
  tutorName(student: CodeRow): string | null {
    return this.rows('staff.csv').find((s) => s.staff_id === student.tutor_id)?.name ?? null;
  }

  wrongAnswer(attempt: CodeRow): WrongAnswer {
    const test = this.rows('tests.csv').find((t) => t.test_id === attempt.test_id)!;
    const through = this.numberedThrough();
    return {
      student: cell(this.student(cell(attempt, 'student_id')), 'name'),
      test_name: cell(test, 'test_name'),
      section: through ? null : cell(attempt, 'section'),
      module: through || attempt.module === '' ? null : Number(attempt.module),
      number: Number(attempt.number),
      chosen: cell(attempt, 'selected'),
    };
  }

  /** A student's attempts on a topic. */
  attemptsOn(studentId: string, topic: string): CodeRow[] {
    return this.onTopic('attempts.csv', topic).filter((row) => row.student_id === studentId);
  }

  history(studentId: string, topic: string, asOf: string) {
    return topicHistory(this.attemptsOn(studentId, topic), this.policy, asOf);
  }

  /**
   * Whether the new assignment ids are bookkeeping any distinct ids will do for: the file has no
   * ids to number on from and the policy states no first id, as a real academy's doesn't.
   */
  idsAreFree(): boolean {
    return (
      this.rows('assignments.csv').length === 0 && !/\bA-0001\b/.test(this.files.text('policy.md'))
    );
  }

  /** What assigning practice on a topic to a student must do. */
  practice(student: CodeRow, topic: string) {
    const id = cell(student, 'student_id');
    const ofStudent = (name: string) =>
      new Set(
        this.rows(name)
          .filter((r) => r.student_id === id)
          .map((r) => cell(r, 'question_id')),
      );
    const questions = this.onTopic('questions.csv', topic);
    const eligible = eligibleQuestions(
      questions,
      ofStudent('attempts.csv'),
      ofStudent('assignments.csv'),
      this.policy,
    );
    const count = Math.min(eligible.length, this.policy.practiceCount);
    return {
      eligible,
      params: {
        student_id: id,
        topic,
        count: this.policy.practiceCount,
        expected_count: count,
        band_low: this.policy.bandLow,
        band_high: this.policy.bandHigh,
        assigned_on: this.today,
        assigned_by: cell(student, 'tutor_id'),
        assignment_ids: this.idsAreFree()
          ? null
          : nextIds(
              this.rows('assignments.csv').map((row) => cell(row, 'assignment_id')),
              count,
            ),
      },
    };
  }

  task(
    skill: Skill,
    index: number,
    family: string,
    prompt: string,
    rest: Pick<Task, 'expected' | 'meta'>,
    answerLine: keyof typeof ANSWER_LINES = skill,
  ): Task {
    return {
      id: `${this.org}-${skill}-${String(index + 1).padStart(2, '0')}`,
      type: skill,
      family: `${this.org}:${family}`,
      org: this.org,
      prompt: `${this.todayText} ${prompt}\n${ANSWER_LINES[answerLine]}`,
      expected: rest.expected,
      meta: rest.meta,
    };
  }
}

/** Where a wrong answer is, the way the academy's staff name it. */
export const where = (w: WrongAnswer) =>
  w.section === null
    ? `question ${w.number} on ${w.test_name}`
    : `question ${w.number} of ${w.section}${w.module === null ? '' : ` module ${w.module}`} on ${w.test_name}`;

/**
 * Wrong answers spread over students and topics, half from each section, not yet used, and
 * `usable` when that is given.
 */
export function pickWrong(
  random: Random,
  records: Records,
  count: number,
  usable: (attempt: CodeRow) => boolean = () => true,
): CodeRow[] {
  const wrong = records
    .rows('attempts.csv')
    .filter(
      (a) =>
        a.result === 'wrong' && a.taken_on! <= records.today && !records.taken.has(a) && usable(a),
    );
  const picked: CodeRow[] = [];
  for (const section of ['Math', 'Reading and Writing']) {
    const pool = random.shuffle(wrong.filter((a) => a.section === section));
    const seen = new Set<string>();
    for (const attempt of pool) {
      if (picked.length >= (section === 'Math' ? count / 2 : count)) break;
      const key = `${attempt.student_id} ${topicKey(cell(attempt, 'topic'))}`;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(attempt);
    }
  }
  picked.forEach((a) => records.taken.add(a));
  return picked;
}

/**
 * Diagnose tasks. With `errorsOf` (a synthetic academy, which knows the error behind each wrong
 * choice) the request also asks for the error; without it, only the topic and the right choice.
 */
export function diagnoseTasks(
  random: Random,
  records: Records,
  attempts: readonly CodeRow[],
  errorsOf?: (attempt: CodeRow) => string[],
): Task[] {
  return attempts.map((attempt, i) => {
    const w = records.wrongAnswer(attempt);
    const tutor = records.tutorName(records.student(cell(attempt, 'student_id')));
    const asking = errorsOf
      ? `What topic is it, what is the right choice, and which of our listed errors produces ${w.chosen}?`
      : 'What topic is it, and what is the right choice?';
    const mine = errorsOf
      ? 'Which topic was that, what was the right answer, and which error did my choice come from?'
      : 'Which topic was that, and what was the right answer?';
    const prompt =
      random.chance(0.5) && tutor !== null
        ? `${tutor} here. ${w.student} got ${where(w)} wrong and chose ${w.chosen}. ${asking}`
        : `Hi, I'm ${w.student}. I picked ${w.chosen} on ${where(w)} and it was wrong. ${mine}`;
    const topic = records.label(cell(attempt, 'topic'));
    const params: Record<string, JsonValue> = { topic, correct: cell(attempt, 'correct') };
    if (errorsOf) params.errors = errorsOf(attempt);
    return records.task(
      'diagnose',
      i,
      `${attempt.student_id}:${topic}`,
      prompt,
      {
        expected: { kind: 'end_state', validator: 'diagnosis', params },
        meta: {
          request: w as unknown as JsonValue,
          summary: `${topic}, ${attempt.correct}`,
        },
      },
      errorsOf ? 'diagnose' : 'diagnose_records',
    );
  });
}

export function historyTasks(random: Random, records: Records, perSkill = PER_SKILL): Task[] {
  const earlier = addDays(records.today, -32);
  const candidates = random
    .shuffle(
      records.students().flatMap((student) =>
        records.topics().flatMap((topic) =>
          [records.today, earlier].map((asOf) => ({
            student,
            topic,
            asOf,
            history: records.history(cell(student, 'student_id'), topic, asOf),
          })),
        ),
      ),
    )
    .filter((c) => c.history.attempts > 0);
  // First one whose window holds a right answer entered another way than the key, when there is
  // one; then half that call for escalation, half that don't, and three of the eight as of an
  // earlier date.
  const picked: typeof candidates = [];
  const seen = new Set<string>();
  const take = (c: (typeof candidates)[number]) => {
    const key = `${c.student.student_id} ${c.topic}`;
    if (seen.has(key) || picked.length === perSkill) return false;
    seen.add(key);
    picked.push(c);
    return true;
  };
  const enteredOtherwise = (c: (typeof candidates)[number]) =>
    historyWindow(
      records.attemptsOn(cell(c.student, 'student_id'), c.topic),
      records.policy,
      c.asOf,
    ).latest.some((row) => row.result === 'right' && row.selected !== row.correct);
  const other = candidates.find(enteredOtherwise);
  if (other) take(other);
  for (const [escalate, asOf, count] of [
    [true, records.today, 3],
    [false, records.today, 2],
    [true, earlier, 1],
    [false, earlier, 2],
  ] as const) {
    let added = 0;
    for (const c of candidates) {
      if (added === count || c.history.escalate !== escalate || c.asOf !== asOf) continue;
      if (take(c)) added += 1;
    }
  }
  candidates.forEach(take);
  return picked.map((c, i) => {
    const when = c.asOf === records.today ? 'as of today' : `as of ${monthDay(c.asOf)}`;
    const name = cell(c.student, 'name');
    const tutor = records.tutorName(c.student);
    const prompt =
      random.chance(0.5) && tutor !== null
        ? `${tutor} here. How is ${name} doing on ${c.topic}, ${when}? Use the history rules in our policy.`
        : `Before Thursday's session: what does ${name}'s history on ${c.topic} look like ${when}, and does it call for escalation?`;
    return records.task('history', i, `${c.student.student_id}:${c.topic}`, prompt, {
      expected: {
        kind: 'facts',
        facts: [
          { path: 'as_of', value: c.asOf },
          { path: 'window', value: records.policy.window },
          { path: 'attempts', value: c.history.attempts },
          { path: 'correct', value: c.history.correct },
          { path: 'accuracy_pct', value: c.history.accuracy_pct },
          { path: 'escalate', value: c.history.escalate },
        ],
      },
      meta: {
        request: { student: name, topic: c.topic, as_of: c.asOf },
        summary: `${c.history.correct}/${c.history.attempts}${c.history.escalate ? ', escalate' : ''}`,
      },
    });
  });
}

export function assignTasks(random: Random, records: Records, perSkill = PER_SKILL): Task[] {
  const candidates = random.shuffle(
    records.students().flatMap((student) => records.topics().map((topic) => ({ student, topic }))),
  );
  const practiced = candidates.map((c) => ({ ...c, ...records.practice(c.student, c.topic) }));
  const count = records.policy.practiceCount;
  // Most with enough questions to choose from; two where fewer than the count qualify.
  const short = practiced.filter((c) => c.eligible.length > 0 && c.eligible.length < count);
  const plenty = [
    ...practiced.filter((c) => c.eligible.length > count),
    ...practiced.filter((c) => c.eligible.length === count),
  ];
  const picked = [...short.slice(0, 2)];
  picked.push(...plenty.slice(0, perSkill - picked.length));
  return picked.map((c, i) => {
    const name = cell(c.student, 'name');
    const tutor = records.tutorName(c.student);
    const prompt =
      random.chance(0.5) && tutor !== null
        ? `${tutor} here. Please set ${name}'s follow-up practice on ${c.topic}.`
        : `${name} wants more practice on ${c.topic}. Assign it the way our policy says.`;
    return records.task('assign', i, `${c.student.student_id}:${c.topic}`, prompt, {
      expected: { kind: 'end_state', validator: 'practice_assigned', params: c.params },
      meta: {
        request: { student: name, topic: c.topic },
        summary: `${c.params.expected_count} of ${c.eligible.length} eligible`,
      },
    });
  });
}

export interface RecordTaskOptions {
  /** The organization id the tasks name and their ids start with. */
  org: string;
  seed: number;
  /** The date the requests are made on; attempts after it are not asked about. */
  asOf: string;
  /** Tasks of each skill at most; eight when not given. */
  perSkill?: number;
}

/**
 * Tasks for an existing academy folder in this schema that has no question text, errors or
 * hints, such as a real academy's anonymized export: `diagnose` (topic and right choice),
 * `history` and `assign`, up to `perSkill` of each (eight by default). The same files, seed, date
 * and count give the same tasks.
 */
export function buildRecordTasks(files: ReadonlyMap<string, string>, options: RecordTaskOptions) {
  const perSkill = options.perSkill ?? PER_SKILL;
  const random = new Random(options.seed);
  const records = new Records(new JobFiles(files), options.org, options.asOf);
  const wrong = pickWrong(random.fork('diagnose'), records, perSkill);
  return [
    ...diagnoseTasks(random.fork('diagnose prompts'), records, wrong),
    ...historyTasks(random.fork('history'), records, perSkill),
    ...assignTasks(random.fork('assign'), records, perSkill),
  ].map((task) => TaskSchema.parse(task));
}

/** Every file of an academy folder, by name. */
export function readAcademyFolder(dir: string): Map<string, string> {
  return new Map(
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => [entry.name, readFileSync(join(dir, entry.name), 'utf8')]),
  );
}
