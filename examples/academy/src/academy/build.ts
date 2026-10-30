import { addDays } from '../lib/calendar';
import { compareText } from '../lib/compare';
import type { Random } from '../lib/random';
import { academyStyle } from './style';
import type { AcademyStyle } from './style';
import { TOPIC_KINDS, makeGridIn } from './topics';
import type { Item, Section, TopicKind } from './topics';

/**
 * One synthetic academy's records, as the academy itself would keep them: topics, the errors its
 * answer explanations name, its approved first hints, a question bank with full text, practice
 * tests, students and every answer they gave, lesson videos, and the practice and notes staff
 * have already written. Every name is made up.
 */

/**
 * The job's date, the one the agent's header gives. Each academy has a date of its own, which its
 * requests state, and its records end there.
 */
export const TODAY = '2026-11-16';
/** The days of records an academy keeps before its date: its term so far. */
const TERM_DAYS = 77;
export const LETTERS = ['A', 'B', 'C', 'D'] as const;
export const PROGRAM = 'SAT';
const TESTS = 5;
const STUDENTS = 16;
/** Questions in each module of a practice test: one per topic of the section. */
const MODULE_QUESTIONS = 6;
/** Bank questions per topic: more for an academy that assigns more practice at a time. */
const bankPerTopic = (style: AcademyStyle) => 12 + 3 * style.policy.practiceCount;

export interface Topic {
  kind: TopicKind;
  label: string;
  section: Section;
  folder: string;
}

export interface ErrorRow {
  error_id: string;
  topic: string;
  name: string;
  code: string;
}

export interface HintRow {
  hint_id: string;
  topic: string;
  /** Empty for the topic's general hint. */
  error_id: string;
  text: string;
}

export interface Question {
  question_id: string;
  section: Section;
  topic: string;
  difficulty_pct: number;
  item: Item;
}

export interface TestSlot {
  test_id: string;
  test_name: string;
  section: Section;
  module: number;
  /** The question's number as the academy's layout numbers it. */
  number: number;
  question_id: string;
}

export interface Student {
  student_id: string;
  name: string;
  grade: number;
  target_score: number;
  test_date: string;
  tutor_id: string;
}

export interface Staff {
  staff_id: string;
  name: string;
  role: string;
}

export interface Attempt {
  student_id: string;
  test_id: string;
  taken_on: string;
  section: Section;
  module: number;
  number: number;
  question_id: string;
  topic: string;
  selected: string;
  correct: string;
  result: 'right' | 'wrong';
}

export interface Video {
  video_id: string;
  title: string;
  folder: string;
  description: string;
  minutes: number;
}

export interface Assignment {
  assignment_id: string;
  student_id: string;
  question_id: string;
  assigned_on: string;
  assigned_by: string;
}

export interface StaffNote {
  note_id: string;
  student_id: string;
  staff_id: string;
  written_on: string;
  topic: string;
  note: string;
}

export interface Academy {
  seed: number;
  style: AcademyStyle;
  topics: Topic[];
  errors: ErrorRow[];
  hints: HintRow[];
  questions: Question[];
  tests: TestSlot[];
  staff: Staff[];
  students: Student[];
  attempts: Attempt[];
  videos: Video[];
  assignments: Assignment[];
  notes: StaffNote[];
}

const FIRST_NAMES = [
  'Ada',
  'Bram',
  'Celia',
  'Dario',
  'Elin',
  'Fenna',
  'Gideon',
  'Hana',
  'Ilse',
  'Joran',
  'Kaia',
  'Lio',
  'Mira',
  'Niko',
  'Odile',
  'Pell',
  'Quin',
  'Rosalind',
  'Soren',
  'Tamsin',
  'Ulla',
  'Vito',
  'Wren',
  'Xavi',
  'Yara',
  'Zeno',
];
const LAST_NAMES = [
  'Ashdown',
  'Brightwater',
  'Calloway',
  'Dunmore',
  'Ellery',
  'Fairbank',
  'Greaves',
  'Holloway',
  'Ingram',
  'Jessop',
  'Kettering',
  'Lindqvist',
  'Marchetti',
  'Northcott',
  'Okafor',
  'Pemberton',
  'Quarles',
  'Rookwood',
  'Sandoval',
  'Thorne',
  'Underhill',
  'Vasquez',
  'Whitcombe',
  'Yardley',
];

export function buildAcademy(seed: number, random: Random): Academy {
  const style = academyStyle(random.fork('style'));
  const topics = TOPIC_KINDS.map((kind, i) => ({
    kind,
    label: style.topics.labels[i]!,
    section: kind.section,
    folder: style.topics.folders[i]!,
  }));
  const { errors, hints } = buildCatalog(random.fork('catalog'), style, topics);
  const questions = buildBank(random.fork('bank'), style, topics);
  const tests = buildTests(random.fork('tests'), style, topics, questions);
  const names = uniqueNames(random.fork('names'), STUDENTS + 4);
  const staff = buildStaff(style, names.slice(STUDENTS));
  const students = buildStudents(random.fork('students'), style, names.slice(0, STUDENTS), staff);
  const attempts = buildAttempts(
    random.fork('attempts'),
    style,
    students,
    tests,
    questions,
    topics,
  );
  const videos = buildVideos(random.fork('videos'), style, topics);
  const assignments = buildAssignments(
    random.fork('assignments'),
    style,
    students,
    questions,
    attempts,
  );
  const notes = buildNotes(random.fork('notes'), style, students, topics);
  return {
    seed,
    style,
    topics,
    errors,
    hints,
    questions,
    tests,
    staff,
    students,
    attempts,
    videos,
    assignments,
    notes,
  };
}

/** Error ids and hint ids numbered in a shuffled order, so an id says nothing about its topic. */
function buildCatalog(random: Random, style: AcademyStyle, topics: Topic[]) {
  const errorKinds = topics.flatMap((topic) =>
    topic.kind.errors.map((error) => ({ topic, error })),
  );
  const errorNumbers = random.shuffle(errorKinds.map((_, i) => i + 1));
  const errors: ErrorRow[] = errorKinds.map(({ topic, error }, i) => ({
    error_id: style.ids.error(errorNumbers[i]!),
    topic: topic.label,
    name: error.name,
    code: error.code,
  }));
  // Every topic has its general hint; about one error in four has no hint written for it yet.
  const drafts: Omit<HintRow, 'hint_id'>[] = [];
  for (const topic of topics) {
    drafts.push({ topic: topic.label, error_id: '', text: topic.kind.generalHint });
    for (const error of topic.kind.errors) {
      if (random.chance(0.25)) continue;
      const row = errors.find((e) => e.code === error.code)!;
      drafts.push({ topic: topic.label, error_id: row.error_id, text: error.hint });
    }
  }
  const hintNumbers = random.shuffle(drafts.map((_, i) => i + 1));
  const hints = drafts
    .map((draft, i) => ({ hint_id: style.ids.hint(hintNumbers[i]!), ...draft }))
    .sort((a, b) => compareText(a.hint_id, b.hint_id));
  return { errors: errors.sort((a, b) => compareText(a.error_id, b.error_id)), hints };
}

function buildBank(random: Random, style: AcademyStyle, topics: Topic[]): Question[] {
  const drafts: Omit<Question, 'question_id'>[] = [];
  for (const topic of topics) {
    const stems = new Set<string>();
    for (let tries = 0; stems.size < bankPerTopic(style); tries += 1) {
      if (tries > 5000)
        throw new Error(`${topic.kind.kind} can't write enough different questions`);
      // Some linear equations are grid-ins: no choices, and a fraction for an answer.
      const item =
        topic.kind.kind === 'linear' && random.chance(0.4)
          ? makeGridIn(random, style.phrasing)
          : topic.kind.make(random, style.phrasing);
      if (stems.has(item.stem)) continue;
      stems.add(item.stem);
      drafts.push({
        section: topic.section,
        topic: topic.label,
        difficulty_pct: random.int(15, 92),
        item,
      });
    }
  }
  const numbers = random.shuffle(drafts.map((_, i) => i + 1));
  return drafts
    .map((draft, i) => ({ question_id: style.ids.question(draft.section, numbers[i]!), ...draft }))
    .sort((a, b) => compareText(a.question_id, b.question_id));
}

/**
 * Each module holds one question of each of its section's topics, in a shuffled order, numbered
 * the way the academy's layout numbers them.
 */
function buildTests(
  random: Random,
  style: AcademyStyle,
  topics: Topic[],
  questions: Question[],
): TestSlot[] {
  const pools = new Map(
    topics.map((topic) => [
      topic.label,
      random.shuffle(questions.filter((q) => q.topic === topic.label)),
    ]),
  );
  const slots: TestSlot[] = [];
  for (let test = 1; test <= TESTS; test += 1) {
    for (const section of ['Reading and Writing', 'Math'] as const) {
      for (const module of [1, 2]) {
        const order = random.shuffle(topics.filter((topic) => topic.section === section));
        // Continuous numbering runs through the test: the modules before this one come first.
        const before = style.layout === 'continuous' ? slots.length % (4 * MODULE_QUESTIONS) : 0;
        order.forEach((topic, i) => {
          const question = pools.get(topic.label)!.pop()!;
          slots.push({
            test_id: style.ids.test(test),
            test_name: style.ids.testName(test),
            section,
            module,
            number: before + i + 1,
            question_id: question.question_id,
          });
        });
      }
    }
  }
  if (slots.length !== TESTS * 4 * MODULE_QUESTIONS) throw new Error('A test is short');
  return slots;
}

function uniqueNames(random: Random, count: number): string[] {
  const names = new Set<string>();
  while (names.size < count) names.add(`${random.pick(FIRST_NAMES)} ${random.pick(LAST_NAMES)}`);
  return [...names];
}

function buildStaff(style: AcademyStyle, names: string[]): Staff[] {
  const roles = ['Director', 'Tutor', 'Tutor', 'Tutor'];
  return names.map((name, i) => ({ staff_id: style.ids.staff(i + 1), name, role: roles[i]! }));
}

function buildStudents(
  random: Random,
  style: AcademyStyle,
  names: string[],
  staff: Staff[],
): Student[] {
  const tutors = staff.filter((member) => member.role === 'Tutor');
  return names.map((name, i) => ({
    student_id: style.ids.student(i + 1),
    name,
    grade: random.int(10, 12),
    target_score: 10 * random.int(120, 155),
    test_date: random.pick(['2026-12-05', '2027-03-13', '2027-05-01', '2027-06-05']),
    tutor_id: random.pick(tutors).staff_id,
  }));
}

/**
 * Every student sits two to five practice tests on different days, some retaking one later.
 * Each student is weaker on a few topics, so their histories differ.
 */
function buildAttempts(
  random: Random,
  style: AcademyStyle,
  students: Student[],
  tests: TestSlot[],
  questions: Question[],
  topics: Topic[],
): Attempt[] {
  const byId = new Map(questions.map((q) => [q.question_id, q]));
  const testIds = [...new Set(tests.map((slot) => slot.test_id))];
  const attempts: Attempt[] = [];
  // A few students miss an agreement question the same way in their latest sitting, with the
  // choice that agrees with the nearer noun: the same wrong answer every academy can be asked about.
  const nearerNoun = new Set(random.sample(students, 4).map((s) => s.student_id));
  for (const student of students) {
    const weak = new Set(random.sample(topics, random.int(1, 3)).map((t) => t.label));
    const skill = new Map(
      topics.map((t) => [t.label, weak.has(t.label) ? random.int(15, 40) : random.int(50, 90)]),
    );
    const taken = random.sample(testIds, random.int(2, TESTS)).sort(compareText);
    const sittings = [...taken];
    if (random.chance(0.35)) sittings.push(random.pick(taken));
    // Earlier sittings through the term; the latest in the two weeks before the academy's date.
    const days = [
      ...random.sample(range(0, 60), sittings.length - 1).sort((a, b) => a - b),
      random.int(62, TERM_DAYS - 1),
    ];
    sittings.forEach((testId, s) => {
      const retake = sittings.indexOf(testId) !== s;
      const day = addDays(style.today, days[s]! - TERM_DAYS);
      for (const slot of tests.filter((t) => t.test_id === testId)) {
        const question = byId.get(slot.question_id)!;
        const chance = skill.get(question.topic)! + (retake ? 15 : 0);
        const planted =
          nearerNoun.has(student.student_id) &&
          s === sittings.length - 1 &&
          slot.module === 1 &&
          question.item.kind === 'agreement';
        const right = !planted && random.int(1, 100) <= chance;
        const grid = question.item.gridIn;
        if (grid) {
          attempts.push({
            ...where(student, slot, day, question),
            selected: right ? grid.key : String(random.pick(grid.wrong)),
            correct: grid.key,
            result: right ? 'right' : 'wrong',
          });
          continue;
        }
        const wrong = question.item.choices
          .map((_, i) => i)
          .filter((i) => i !== question.item.correct);
        const chosen = right
          ? question.item.correct
          : planted
            ? question.item.errors.findIndex((codes) => codes.includes('agreement-nearer-noun'))
            : random.pick(wrong);
        attempts.push({
          ...where(student, slot, day, question),
          selected: LETTERS[chosen]!,
          correct: LETTERS[question.item.correct]!,
          result: right ? 'right' : 'wrong',
        });
      }
    });
  }
  const sectionOrder = (section: Section) => (section === 'Reading and Writing' ? 0 : 1);
  return attempts.sort(
    (a, b) =>
      compareText(a.taken_on, b.taken_on) ||
      compareText(a.student_id, b.student_id) ||
      sectionOrder(a.section) - sectionOrder(b.section) ||
      a.module - b.module ||
      a.number - b.number,
  );
}

/** The columns of an attempt that say who answered which question, and when. */
function where(student: Student, slot: TestSlot, day: string, question: Question) {
  return {
    student_id: student.student_id,
    test_id: slot.test_id,
    taken_on: day,
    section: slot.section,
    module: slot.module,
    number: slot.number,
    question_id: slot.question_id,
    topic: question.topic,
  };
}

function buildVideos(random: Random, style: AcademyStyle, topics: Topic[]): Video[] {
  const drafts: Omit<Video, 'video_id'>[] = [];
  for (const topic of topics) {
    const name = topic.kind.names[0]!;
    const all = [
      {
        title: `${name}: the core idea`,
        description: `Walks through the rule behind ${name.toLowerCase()} with three short examples.`,
      },
      {
        title: `${name} in five questions`,
        description: `Five practice questions on ${name.toLowerCase()}, worked one step at a time.`,
      },
      {
        title: `Traps in ${name.toLowerCase()}`,
        description: `The wrong answers students pick most often on ${name.toLowerCase()}, and why they tempt.`,
      },
    ];
    for (const video of random.sample(all, random.int(2, 3))) {
      drafts.push({ ...video, folder: topic.folder, minutes: random.int(4, 18) });
    }
  }
  const numbers = random.shuffle(drafts.map((_, i) => i + 1));
  return drafts
    .map((draft, i) => ({ video_id: style.ids.video(numbers[i]!), ...draft }))
    .sort((a, b) => compareText(a.video_id, b.video_id));
}

/** Practice staff set earlier in the term: a few questions of one topic for some students. */
function buildAssignments(
  random: Random,
  style: AcademyStyle,
  students: Student[],
  questions: Question[],
  attempts: Attempt[],
): Assignment[] {
  const rows: Assignment[] = [];
  for (const student of random.sample(students, 7)) {
    const seen = new Set(
      attempts.filter((a) => a.student_id === student.student_id).map((a) => a.question_id),
    );
    const topic = random.pick(questions).topic;
    const open = questions.filter((q) => q.topic === topic && !seen.has(q.question_id));
    const day = addDays(style.today, random.int(14, 69) - TERM_DAYS);
    for (const question of random.sample(open, Math.min(open.length, random.int(1, 2)))) {
      rows.push({
        assignment_id: '',
        student_id: student.student_id,
        question_id: question.question_id,
        assigned_on: day,
        assigned_by: student.tutor_id,
      });
    }
  }
  rows.sort((a, b) => compareText(a.assigned_on, b.assigned_on));
  return rows.map((row, i) => ({ ...row, assignment_id: style.ids.assignment(i + 1) }));
}

function buildNotes(
  random: Random,
  style: AcademyStyle,
  students: Student[],
  topics: Topic[],
): StaffNote[] {
  const notes = random.sample(students, 3).map((student) => ({
    student_id: student.student_id,
    staff_id: student.tutor_id,
    written_on: addDays(style.today, random.int(21, 71) - TERM_DAYS),
    topic: random.pick(topics).label,
    note: 'Several misses in a row on this topic. Please review it in the next session.',
  }));
  notes.sort((a, b) => compareText(a.written_on, b.written_on));
  return notes.map((note, i) => ({ note_id: style.ids.note(i + 1), ...note }));
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}
