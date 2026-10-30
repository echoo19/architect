import { toCsv } from '../lib/csv';
import type { Academy } from './build';
import { LETTERS, PROGRAM } from './build';
import type { PolicyNumbers } from './style';

/**
 * An academy's files: the CSV tables in the schema the README documents, and policy.md. A real
 * academy's anonymized export is written into the same tables.
 */
export const COLUMNS = {
  'students.csv': ['student_id', 'name', 'grade', 'target_score', 'test_date', 'tutor_id'],
  'staff.csv': ['staff_id', 'name', 'role'],
  'topics.csv': ['topic', 'section', 'video_folder'],
  'errors.csv': ['error_id', 'topic', 'name'],
  'hints.csv': ['hint_id', 'topic', 'error_id', 'text'],
  'questions.csv': [
    'question_id',
    'section',
    'topic',
    'difficulty_pct',
    'stem',
    'choice_a',
    'choice_b',
    'choice_c',
    'choice_d',
    'correct',
  ],
  'tests.csv': ['test_id', 'test_name', 'program', 'section', 'module', 'number', 'question_id'],
  'attempts.csv': [
    'student_id',
    'test_id',
    'taken_on',
    'section',
    'module',
    'number',
    'question_id',
    'topic',
    'selected',
    'correct',
    'result',
  ],
  'videos.csv': ['video_id', 'title', 'folder', 'description', 'minutes'],
  'assignments.csv': ['assignment_id', 'student_id', 'question_id', 'assigned_on', 'assigned_by'],
  'staff_notes.csv': ['note_id', 'student_id', 'staff_id', 'written_on', 'topic', 'note'],
} as const;

export type TableName = keyof typeof COLUMNS;

export function academyFiles(academy: Academy): Map<string, string> {
  const table = (name: TableName, rows: (string | number)[][]) =>
    [name, toCsv(COLUMNS[name], rows)] as const;
  return new Map<string, string>([
    ['policy.md', policyDocument(academy.style.name, academy.style.policy)],
    table(
      'students.csv',
      academy.students.map((s) => [
        s.student_id,
        s.name,
        s.grade,
        s.target_score,
        s.test_date,
        s.tutor_id,
      ]),
    ),
    table(
      'staff.csv',
      academy.staff.map((s) => [s.staff_id, s.name, s.role]),
    ),
    table(
      'topics.csv',
      academy.topics.map((t) => [t.label, t.section, t.folder]),
    ),
    table(
      'errors.csv',
      academy.errors.map((e) => [e.error_id, e.topic, e.name]),
    ),
    table(
      'hints.csv',
      academy.hints.map((h) => [h.hint_id, h.topic, h.error_id, h.text]),
    ),
    table(
      'questions.csv',
      academy.questions.map((q) => [
        q.question_id,
        q.section,
        q.topic,
        q.difficulty_pct,
        q.item.stem,
        ...q.item.choices,
        LETTERS[q.item.correct]!,
      ]),
    ),
    table(
      'tests.csv',
      academy.tests.map((t) => [
        t.test_id,
        t.test_name,
        PROGRAM,
        t.section,
        t.module,
        t.number,
        t.question_id,
      ]),
    ),
    table(
      'attempts.csv',
      academy.attempts.map((a) => [
        a.student_id,
        a.test_id,
        a.taken_on,
        a.section,
        a.module,
        a.number,
        a.question_id,
        a.topic,
        a.selected,
        a.correct,
        a.result,
      ]),
    ),
    table(
      'videos.csv',
      academy.videos.map((v) => [v.video_id, v.title, v.folder, v.description, v.minutes]),
    ),
    table(
      'assignments.csv',
      academy.assignments.map((a) => [
        a.assignment_id,
        a.student_id,
        a.question_id,
        a.assigned_on,
        a.assigned_by,
      ]),
    ),
    table(
      'staff_notes.csv',
      academy.notes.map((n) => [
        n.note_id,
        n.student_id,
        n.staff_id,
        n.written_on,
        n.topic,
        n.note,
      ]),
    ),
  ]);
}

/** The policy's numbers, in the table at its end. The reference solutions read them from there. */
export const POLICY_SETTINGS = {
  practiceCount: 'Practice questions after a wrong answer',
  bandLow: 'Practice difficulty, lowest percent correct',
  bandHigh: 'Practice difficulty, highest percent correct',
  window: 'History window, latest attempts on the topic',
  escalateWrong: 'Wrong answers that call for a staff note',
  escalateDays: 'Days those wrong answers are counted over',
  counts: 'Attempts that count in history',
  hintRule: 'First hint',
} as const;

export function policyDocument(name: string, policy: PolicyNumbers): string {
  const counts =
    policy.counts === 'first'
      ? "Only a student's first attempt at each question counts. When a student retakes a test, the retake's answers do not count toward history."
      : 'Every attempt counts, retakes included: a question answered twice is two attempts.';
  const hint =
    policy.hintRule === 'targeted'
      ? "Give the approved hint written for the error behind the student's choice (hints.csv, the row whose error_id is that error). When no hint is written for that error, give the topic's general hint, the row with no error_id."
      : "Always give the topic's general hint first, the row in hints.csv with no error_id, whatever the student chose. Hints written for a particular error are for the second try.";
  const settings: [string, string][] = [
    [POLICY_SETTINGS.practiceCount, String(policy.practiceCount)],
    [POLICY_SETTINGS.bandLow, String(policy.bandLow)],
    [POLICY_SETTINGS.bandHigh, String(policy.bandHigh)],
    [POLICY_SETTINGS.window, String(policy.window)],
    [POLICY_SETTINGS.escalateWrong, String(policy.escalateWrong)],
    [POLICY_SETTINGS.escalateDays, String(policy.escalateDays)],
    [POLICY_SETTINGS.counts, policy.counts === 'first' ? 'first attempts only' : 'every attempt'],
    [
      POLICY_SETTINGS.hintRule,
      policy.hintRule === 'targeted' ? 'the hint for the error' : 'the general hint',
    ],
  ];
  return [
    `# ${name}: tutoring policy`,
    '',
    `This is how ${name} tutors a student right after a wrong answer, and how staff read a student's record. Phil, the academy's tutor, follows it, and so do the staff.`,
    '',
    '## The records',
    '',
    '- `students.csv`: each student, their target score, test date and tutor (`tutor_id`, a row of `staff.csv`).',
    "- `topics.csv`: the academy's topic labels, with the section and the folder of lesson videos for each.",
    '- `questions.csv`: the question bank, with full text, the right choice and `difficulty_pct`, the percent of students who get the question right (a higher number is an easier question).',
    '- `tests.csv`: which bank question sits at each section, module and number of each practice test.',
    '- `attempts.csv`: every answer a student gave on a practice test, with the choice they picked, the right choice and whether they got it right.',
    "- `errors.csv`: for each topic, the errors our answer explanations name. Each wrong choice in the bank comes from one of its topic's errors.",
    '- `hints.csv`: the approved first hints. Phil gives only these hints, by id, and never writes his own.',
    "- `videos.csv`: the lesson videos, each in a topic's folder.",
    '- `assignments.csv` and `staff_notes.csv`: practice set for students and notes left for staff. New rows go at the end.',
    '',
    '## Diagnosing a wrong answer',
    '',
    'Find the question the student answered (the test, section, module and number lead to it through `tests.csv`), its topic and its right choice. Then name the error behind the choice they picked: the row of `errors.csv` for that topic whose error produces that choice. If two errors produce the same choice, either one is right.',
    '',
    '## The first hint',
    '',
    hint,
    '',
    '## History on a topic',
    '',
    `A student's history on a topic is read as of a date: attempts taken after that date are left out. ${counts} Of the attempts that count, take the latest ${policy.window}, ordered by the date taken, then module, then question number (fewer if the student has fewer). Report how many attempts that is, how many were right, and the accuracy: right answers divided by those attempts, as a whole percent, rounded half up.`,
    '',
    `Escalation looks at time, not at the window: escalate when the attempts that count, taken in the ${policy.escalateDays} days ending on that date (the date itself and the ${policy.escalateDays - 1} before it), hold ${policy.escalateWrong} or more wrong answers.`,
    '',
    '## Follow-up practice',
    '',
    `Assign ${policy.practiceCount} questions from the bank. Each must be of the same topic, never attempted by the student on any test, not already assigned to them, and with \`difficulty_pct\` from ${policy.bandLow} to ${policy.bandHigh}, both included. Any questions that meet these rules will do; never assign the same question twice. If fewer than ${policy.practiceCount} questions qualify, assign all that do and say how many.`,
    '',
    "Each question is one row of `assignments.csv`: a new `assignment_id` (number on from the highest id already in the file, in the same format, one per row; A-0001 if the file has none yet), the student, the question, today's date as `assigned_on`, and the student's tutor as `assigned_by`.",
    '',
    '## The tutoring turn after a wrong answer',
    '',
    '1. Diagnose the answer: the topic, the right choice and the error.',
    '2. Give the first hint, by its id.',
    "3. Point the student to one lesson video from the topic's folder.",
    '4. Assign the follow-up practice.',
    `5. Read the student's history on the topic as of today. If it calls for escalation, add one row to \`staff_notes.csv\` for the student's tutor: a new \`note_id\` (numbered on, like assignments), the student, the tutor as \`staff_id\`, today's date, the topic label, and a short note.`,
    '',
    'Change nothing else. Never edit or delete a row that is already there.',
    '',
    '## In numbers',
    '',
    '| Setting | Value |',
    '| --- | --- |',
    ...settings.map(([setting, value]) => `| ${setting} | ${value} |`),
    '',
  ].join('\n');
}
