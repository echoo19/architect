import { toCsv } from '../lib/csv';
import type { Random } from '../lib/random';
import type { Academy, Attempt, Question } from './build';
import { LETTERS, PROGRAM } from './build';
import { policyDocument } from './policy';
import type { LabelForm } from './style';
import { gridForms } from './topics';

/**
 * An academy's files: the CSV tables in the schema the README documents, and policy.md. A real
 * academy's anonymized export is written into the same tables.
 *
 * The files read as exports: in about a fifth of the rows of questions.csv and attempts.csv a
 * value is written another way. A topic label carries a stray space, other capitals or other
 * punctuation than topics.csv gives it, and a right grid-in answer may be entered as a decimal or
 * an unreduced fraction. Every such form reads back to one value. The first rows of each table
 * are plain.
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

/** Rows at the top of an exported table that are always written plainly. */
export const PLAIN_ROWS = 5;
/** The share of the rest whose topic label an export writes another way. */
const LABEL_SHARE = { questions: 0.2, attempts: 0.17 } as const;
/** The chance a student enters a right grid-in answer another way than the key. */
const GRID_FORM_CHANCE = 0.5;

export function academyFiles(academy: Academy, random: Random): Map<string, string> {
  const table = (name: TableName, rows: (string | number)[][]) =>
    [name, toCsv(COLUMNS[name], rows)] as const;
  const { style } = academy;
  const questions = exported(
    random.fork('questions'),
    academy.questions,
    style.labelForms,
    LABEL_SHARE.questions,
  );
  const attempts = exported(
    random.fork('attempts'),
    academy.attempts,
    style.labelForms,
    LABEL_SHARE.attempts,
  );
  const grid = random.fork('grid');
  const gridIns = new Set(academy.questions.filter((q) => q.item.gridIn).map((q) => q.question_id));
  return new Map<string, string>([
    ['policy.md', policyDocument(style.name, style.policy, style.policyStyle)],
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
      questions.map((q) => [
        q.question_id,
        q.section,
        q.topic,
        q.difficulty_pct,
        q.item.stem,
        ...(q.item.gridIn ? ['', '', '', ''] : q.item.choices),
        q.item.gridIn ? q.item.gridIn.key : LETTERS[q.item.correct]!,
      ]),
    ),
    table(
      'tests.csv',
      academy.tests.map((t) => [
        t.test_id,
        t.test_name,
        PROGRAM,
        style.layout === 'full' ? 'Full' : t.section,
        t.module,
        t.number,
        t.question_id,
      ]),
    ),
    table(
      'attempts.csv',
      attempts.map((a, i) => [
        a.student_id,
        a.test_id,
        a.taken_on,
        a.section,
        a.module,
        a.number,
        a.question_id,
        a.topic,
        i >= PLAIN_ROWS &&
        gridIns.has(a.question_id) &&
        a.result === 'right' &&
        grid.chance(GRID_FORM_CHANCE)
          ? grid.pick(gridForms(a.correct))
          : a.selected,
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

/** Rows as an export writes them: a share of the rest, past the plain ones, with another label. */
function exported<T extends Question | Attempt>(
  random: Random,
  rows: readonly T[],
  forms: readonly LabelForm[],
  share: number,
): T[] {
  const rest = rows.length - PLAIN_ROWS;
  const other = new Set(
    random.sample(rows.map((_, i) => i).slice(PLAIN_ROWS), Math.round(share * rest)),
  );
  return rows.map((row, i) =>
    other.has(i) ? { ...row, topic: otherLabel(random, row.topic, random.pick(forms)) } : row,
  );
}

/** A topic label written another way, which still reads back to the same label. */
export function otherLabel(random: Random, label: string, form: LabelForm): string {
  switch (form) {
    case 'spaces': {
      const spaces = [...label.matchAll(/ /g)].map((match) => match.index);
      const at = random.pick(spaces);
      return `${label.slice(0, at)}  ${label.slice(at + 1)}`;
    }
    case 'case':
      return random.chance(0.7) ? label.toLowerCase() : label.toUpperCase();
    case 'punctuation': {
      const match = /\s*[-:]\s*/.exec(label);
      if (!match) throw new Error(`The label "${label}" has no punctuation to write another way`);
      const others = [' - ', ': ', ' ', '-'].filter((sep) => sep !== match[0]);
      const end = match.index + match[0].length;
      return `${label.slice(0, match.index)}${random.pick(others)}${label.slice(end)}`;
    }
  }
}
