import type {
  AttemptQuery,
  BrowsedAttempt,
  HarnessFile,
  Task,
  TaskListing,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { LAB } from './fixtures-lab';
import { FIELD_JOB } from './fixtures-field';
import { recentAttempts, STORY } from './story';

/*
 * What a developer browses (decision 084), against the stand-in engine: the Academy desk's practice and
 * check tasks at its three academies, with the final test and calibration counted only; sixty
 * practice and check attempts of the service desk run, paged by fifty as the engine pages them;
 * and the files of a harness version.
 */

const ACADEMIES = [
  { id: 'northside', name: 'Northside Prep' },
  { id: 'lakeview', name: 'Lakeview Academy' },
  { id: 'summit', name: 'Summit Tutoring' },
];

const STUDENTS = ['Maya R.', 'Theo K.', 'Ines L.', 'Omar S.', 'Priya D.', 'Sam W.'];
const TOPICS = ['Linear equations', 'Ratios', 'Triangle angles', 'Exponents', 'Probability'];

/** One request of each skill, as a tutoring turn would ask it. */
function request(type: string, n: number, org: string): string {
  const student = STUDENTS[n % STUDENTS.length] ?? 'Maya R.';
  const topic = TOPICS[n % TOPICS.length] ?? 'Ratios';
  const question = 10 + ((n * 7) % 30);
  const academy = ACADEMIES.find((item) => item.id === org)?.name ?? org;
  switch (type) {
    case 'diagnose':
      return `${student} at ${academy} answered question ${question} of the ${topic} set wrong. Which error from the catalog explains the answer?`;
    case 'solve':
      return `Work question ${question} of the ${topic} set step by step for ${student}, as ${academy}'s curriculum writes it.`;
    case 'hint':
      return `${student} missed question ${question} on ${topic}. Which first hint does ${academy}'s catalog give for that error?`;
    case 'history':
      return `How many of ${student}'s last ten answers on ${topic} were right, and when was the latest?`;
    case 'assign':
      return `Pick three practice questions on ${topic} for ${student} that ${student} has not attempted yet.`;
    default:
      return `${student} just got question ${question} on ${topic} wrong. Diagnose it, give the first hint and assign practice.`;
  }
}

function expected(type: string, n: number): Task['expected'] {
  if (type === 'assign') {
    return {
      kind: 'answer',
      value: [`q-${100 + n}`, `q-${104 + n}`, `q-${109 + n}`],
      compare: { mode: 'set' },
    };
  }
  if (type === 'history') {
    return {
      kind: 'facts',
      facts: [
        { path: 'right', value: 6 + (n % 4) },
        { path: 'latest', value: `2026-10-${String(10 + (n % 18)).padStart(2, '0')}` },
      ],
    };
  }
  if (type === 'after_wrong') {
    return {
      kind: 'end_state',
      validator: 'assignedPractice',
      params: { student: `s-${200 + n}`, count: 3 },
      writes: ['assignments.csv'],
    };
  }
  return { kind: 'answer', value: { error: `E-${10 + (n % 9)}` }, compare: { mode: 'exact' } };
}

function tasksOf(split: 'train' | 'dev', each: number): Task[] {
  return FIELD_JOB.taskTypes.flatMap((type, typeIndex) =>
    ACADEMIES.flatMap((org, orgIndex) =>
      Array.from({ length: each }, (_, index) => {
        const n = typeIndex * 11 + orgIndex * 5 + index + (split === 'dev' ? 50 : 0);
        return {
          id: `${split}-${org.id}-${type.id}-${index + 1}`,
          type: type.id,
          family: `${org.id}/${type.id}/${String(n).padStart(3, '0')}`,
          org: org.id,
          prompt: request(type.id, n, org.id),
          expected: expected(type.id, n),
        };
      }),
    ),
  );
}

export const ACADEMY_DESK_TASKS = { train: tasksOf('train', 2), dev: tasksOf('dev', 1) };

const LISTINGS: Record<string, TaskListing> = {
  [`${LAB.academyDeskJob}/train`]: {
    split: 'train',
    count: ACADEMY_DESK_TASKS.train.length,
    tasks: ACADEMY_DESK_TASKS.train,
  },
  [`${LAB.academyDeskJob}/dev`]: {
    split: 'dev',
    count: ACADEMY_DESK_TASKS.dev.length,
    tasks: ACADEMY_DESK_TASKS.dev,
  },
  [`${LAB.academyDeskJob}/calibration`]: { split: 'calibration', count: 12 },
  [`${LAB.academyDeskJob}/test`]: { split: 'test', count: 72 },
};

/** The Academy desk's tasks by split, on top of the Fields place's reads; each call is recorded. */
export async function stubFieldTasks(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, listings) => {
      const store = globalThis as typeof globalThis & { taskCalls?: unknown[][] };
      store.taskCalls = [];
      ipcMain.removeHandler('jobs:tasks');
      ipcMain.handle('jobs:tasks', (_event, jobId: string, split: string) => {
        store.taskCalls?.push([jobId, split]);
        const listing = listings[`${jobId}/${split}`];
        return listing
          ? { ok: true, value: listing }
          : { ok: false, error: { message: `No tasks for ${split}.`, code: 'split_sealed' } };
      });
    },
    LISTINGS as Record<string, unknown>,
  );
}

/** Sixty practice and check attempts of the service desk run over its four rounds, newest first. */
export const DESK_ATTEMPTS: BrowsedAttempt[] = Array.from({ length: 60 }, (_, index) => {
  const source = recentAttempts[index % recentAttempts.length] ?? recentAttempts[0];
  if (!source) throw new Error('The story has no attempts.');
  const round = 4 - Math.floor(index / 15);
  const pass = index % 3 !== 0;
  return {
    ...source,
    id: `att_${String(900 - index).padStart(4, '0')}`,
    taskId: `task_${index}`,
    round,
    split: index % 4 === 3 ? 'dev' : 'train',
    harnessVersion: round,
    check: pass
      ? { pass: true, reason: 'Matches the expected answer.' }
      : {
          pass: false,
          reason: source.check.pass ? 'The total is off by a cent.' : source.check.reason,
        },
  };
});

/** What the stand-in reads of an attempt to filter it. */
interface Filtered {
  round: number | null;
  taskType: string;
  check: { pass: boolean };
}

/** The runs' paged attempts, filtered and paged as the engine does it; calls are recorded. */
export async function stubAttempts(app: ElectronApplication): Promise<void> {
  await app.evaluate(
    ({ ipcMain }, { attempts, runId }) => {
      const store = globalThis as typeof globalThis & { attemptCalls?: unknown[][] };
      store.attemptCalls = [];
      ipcMain.removeHandler('runs:attempts');
      ipcMain.handle('runs:attempts', (_event, asked: string, query: AttemptQuery = {}) => {
        store.attemptCalls?.push([asked, query]);
        if (asked !== runId) return { ok: false, error: { message: 'No such run.' } };
        const matching = attempts.filter(
          (item) =>
            (query.round === undefined || item.round === query.round) &&
            (query.type === undefined || item.taskType === query.type) &&
            (query.passed === undefined || item.check.pass === query.passed),
        );
        const start = Number(query.cursor ?? 0);
        const end = start + 50;
        return {
          ok: true,
          value: {
            attempts: matching.slice(start, end),
            total: matching.length,
            next: end < matching.length ? String(end) : null,
          },
        };
      });
    },
    { attempts: DESK_ATTEMPTS as Filtered[], runId: STORY.runId },
  );
}

/** The service desk's harness as version 4 holds it: instructions, two skills and a tool. */
export const DESK_FILES: HarnessFile[] = [
  {
    path: 'AGENTS.md',
    content: [
      'You are the service desk for Ferncliff Home Services.',
      '',
      'Answer from the office files in data/. Never guess a price, a balance or a slot.',
      'Read data/policy.md before you price a job, chase a balance or book a visit.',
      'Work out every number with run; never estimate from memory.',
      'Work in integer cents from start to finish.',
      'Add the lines, take off the plan-member discount, add the city tax,',
      'and round once, at the end, half up.',
      'Finish with one line: ANSWER: <json>.',
      '',
    ].join('\n'),
  },
  {
    path: 'decoding.yaml',
    content: 'temperature: 0.2\nmax_steps: 14\n',
  },
  {
    path: 'skills/book-urgent-calls/SKILL.md',
    content: [
      '---',
      'name: book-urgent-calls',
      'description: Book the earliest licensed technician for an urgent call.',
      '---',
      '',
      '1. Find technicians licensed for the trade in data/technicians.csv.',
      '2. Read their free slots from data/calendar.csv.',
      '3. Allow for the drive from the zone they are in before the slot starts.',
      '4. Pick the earliest start; on a tie, the technician with fewer calls that day.',
      '',
    ].join('\n'),
  },
  {
    path: 'skills/price-a-job/SKILL.md',
    content: [
      '---',
      'name: price-a-job',
      'description: Price a finished job from the rate card.',
      '---',
      '',
      '1. Read the job row from data/jobs.csv and the tier from data/technicians.csv.',
      '2. Labor: hours times the tier rate from policy.md, in cents.',
      '3. After hours (before 08:00, after 18:00, weekends): labor times 1.5.',
      '4. Parts: cost times 1.35, rounded to the cent per part.',
      '5. Keep every amount in cents until the total.',
      '',
    ].join('\n'),
  },
  {
    path: 'tools/travel_minutes.js',
    content: [
      'export default function travelMinutes({ from, to }, files) {',
      "  const rows = files.table('zones.csv');",
      '  const row = rows.find((item) => item.from === from && item.to === to);',
      '  if (!row) throw new Error(`No drive time from ${from} to ${to}.`);',
      '  return Number(row.minutes);',
      '}',
      '',
    ].join('\n'),
  },
  {
    path: 'tools/travel_minutes.json',
    content: JSON.stringify(
      {
        name: 'travel_minutes',
        description: 'Minutes to drive between two zones.',
        input: { from: 'string', to: 'string' },
        reads: ['zones.csv'],
      },
      null,
      2,
    ),
  },
];

/** A version's files by agent and version, and a run's by run and version. */
export async function stubHarnessFiles(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }, files) => {
    for (const channel of ['graduates:harnessFiles', 'runs:harnessFiles']) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => ({ ok: true, value: files }));
    }
  }, DESK_FILES);
}
