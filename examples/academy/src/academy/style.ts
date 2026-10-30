import type { Random } from '../lib/random';
import { TOPIC_KINDS } from './topics';
import type { TopicKind } from './topics';

/**
 * What makes one academy differ from another besides its people and records: its name, how it
 * writes ids, how it labels topics and video folders, how its questions are worded, and the
 * numbers in its tutoring policy. Everything is drawn from the academy's seed.
 */

export interface IdStyle {
  question(section: 'Math' | 'Reading and Writing', n: number): string;
  student(n: number): string;
  staff(n: number): string;
  test(n: number): string;
  testName(n: number): string;
  video(n: number): string;
  error(n: number): string;
  hint(n: number): string;
  assignment(n: number): string;
  note(n: number): string;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

const ID_STYLES: readonly IdStyle[] = [
  {
    question: (_, n) => `Q-${pad(n, 4)}`,
    student: (n) => `S-${1000 + n}`,
    staff: (n) => `T-${n}`,
    test: (n) => `PT-${n}`,
    testName: (n) => `Practice Test ${n}`,
    video: (n) => `V-${pad(n, 3)}`,
    error: (n) => `E-${pad(n, 2)}`,
    hint: (n) => `H-${pad(n, 3)}`,
    assignment: (n) => `A-${pad(n, 4)}`,
    note: (n) => `N-${pad(n, 3)}`,
  },
  {
    question: (section, n) => `${section === 'Math' ? 'M' : 'RW'}${100 + n}`,
    student: (n) => `ST${pad(n, 4)}`,
    staff: (n) => `STAFF-${pad(n, 2)}`,
    test: (n) => `BB${n}`,
    testName: (n) => `Bluebook Practice ${n}`,
    video: (n) => `VID${200 + n}`,
    error: (n) => `ERR-${100 + n}`,
    hint: (n) => `HINT-${pad(n, 2)}`,
    assignment: (n) => `ASG-${500 + n}`,
    note: (n) => `NOTE-${pad(n, 4)}`,
  },
  {
    question: (_, n) => `QB-${pad(30000 + n * 7, 5)}`,
    student: (n) => `L${pad(n, 3)}`,
    staff: (n) => `C${n}`,
    test: (n) => `MOCK-${String.fromCharCode(64 + n)}`,
    testName: (n) => `Mock Exam ${String.fromCharCode(64 + n)}`,
    video: (n) => `LV-${pad(n, 4)}`,
    error: (n) => `X${pad(n, 2)}`,
    hint: (n) => `FH-${pad(n, 3)}`,
    assignment: (n) => `HW-${pad(n, 5)}`,
    note: (n) => `SN-${pad(n, 3)}`,
  },
];

export interface TopicStyle {
  /** The topic labels, in the order of TOPIC_KINDS. */
  labels: string[];
  /** The video folder of each topic, in the same order. */
  folders: string[];
}

/** One of three ways of labeling topics, each name picked from the kind's names. */
function topicStyle(random: Random, way: number): TopicStyle {
  const names = TOPIC_KINDS.map((kind) => random.pick(kind.names));
  const order = random.shuffle(TOPIC_KINDS.map((_, i) => i));
  const labels: string[] = [];
  const folders: string[] = [];
  TOPIC_KINDS.forEach((kind, i) => {
    const name = names[i]!;
    const rank = order.indexOf(i);
    if (way === 0) {
      // "Rule 4B - Parallel Comparisons": two topics to a rule number.
      const rule = `Rule ${Math.floor(rank / 2) + 1}${rank % 2 === 0 ? 'A' : 'B'}`;
      labels.push(`${rule} - ${titleCase(name)}`);
      folders.push(`${rule} lessons`);
    } else if (way === 1) {
      // "Grammar: comparisons".
      labels.push(`${kind.domain}: ${name.toLowerCase()}`);
      folders.push(`${kind.section === 'Math' ? 'Math' : 'English'}/${titleCase(name)}`);
    } else {
      // "W-USG-03 Comparisons".
      const code = `${kind.section === 'Math' ? 'M' : 'W'}-${domainCode(kind)}-${pad(rank + 1, 2)}`;
      labels.push(`${code} ${titleCase(name)}`);
      folders.push(code);
    }
  });
  return { labels, folders };
}

function domainCode(kind: TopicKind): string {
  return kind.domain
    .replace(/[^A-Za-z ]/g, '')
    .split(' ')
    .filter((word) => word.length > 2)
    .map((word) => word.slice(0, 3).toUpperCase())
    .join('')
    .slice(0, 3);
}

const SMALL_WORDS = new Set(['and', 'of', 'to', 'the', 'in']);

function titleCase(text: string): string {
  return text
    .split(' ')
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

/** The numbers in an academy's tutoring policy. */
export interface PolicyNumbers {
  /** Follow-up practice questions to assign after a wrong answer. */
  practiceCount: number;
  /** The difficulty band of practice questions: percent of students who get them right. */
  bandLow: number;
  bandHigh: number;
  /** History looks at the latest this many attempts on a topic. */
  window: number;
  /** Escalate to the student's tutor when the window holds this many wrong answers or more. */
  escalateWrong: number;
  /** Whether history counts only the first attempt at each question, or every attempt. */
  counts: 'first' | 'every';
  /** Which approved hint comes first: the one written for the error, or the topic's general one. */
  hintRule: 'targeted' | 'general';
}

export interface AcademyStyle {
  name: string;
  /** The organization id: lowercase, from the name. */
  id: string;
  ids: IdStyle;
  topics: TopicStyle;
  /** Which wording of each question kind the academy's bank uses. */
  phrasing: number;
  policy: PolicyNumbers;
}

const NAMES = [
  'Northgate Prep',
  'Ridgeline Test Prep',
  'Bramble Hill Academy',
  'Silverleaf Tutoring',
  'Copperfield Learning',
  'Harborview Prep',
  'Juniper Study House',
  'Lakemont Scholars',
  'Oakhollow Academy',
  'Wrenfield Prep',
];

export function academyStyle(random: Random): AcademyStyle {
  const name = random.pick(NAMES);
  const window = random.pick([5, 6, 8, 10]);
  const bandLow = random.pick([30, 35, 40, 45]);
  return {
    name,
    id: name.split(' ')[0]!.toLowerCase(),
    ids: random.pick(ID_STYLES),
    topics: topicStyle(random.fork('topics'), random.int(0, 2)),
    phrasing: random.int(0, 1),
    policy: {
      practiceCount: random.int(2, 5),
      bandLow,
      bandHigh: bandLow + random.pick([25, 30, 35]),
      window,
      escalateWrong: random.int(3, Math.min(5, window - 1)),
      counts: random.pick(['first', 'every'] as const),
      hintRule: random.pick(['targeted', 'general'] as const),
    },
  };
}
