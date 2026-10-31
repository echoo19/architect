import type { Counterexample } from '@architect/shared';
import { LAB } from './fixtures-lab';
import { at, STORY } from './story';

/*
 * Stand-in counterexamples (decision 078): a helper call that failed on a practice task, cut down
 * to the rows it still fails on, with the repair measured against it. The lookup's sizes and
 * tables are the ones the engine's reduction gives on the academy example's train data; the
 * history case, which only the Assets list shows, keeps one of its rows.
 */

const hash = (digit: string) => digit.repeat(64);

/** The service desk's travel helper, which knew each pair of zones in one direction only. */
export const DESK_COUNTEREXAMPLE: Counterexample = {
  id: 'cex_travel',
  jobId: STORY.jobId,
  runId: STORY.runId,
  round: 4,
  taskId: 'train-scheduling-3',
  attemptId: 'att_train_scheduling_3',
  callId: 'c2',
  helper: { name: 'travel_minutes', codeHash: hash('1') },
  arguments: { from_zone: 'Harbor', to_zone: 'North' },
  predicate: { kind: 'threw', message: 'Error: no travel time from Harbor to North' },
  tables: {
    'travel.csv': {
      columns: ['from_zone', 'to_zone', 'minutes'],
      rows: [{ from_zone: 'North', to_zone: 'Harbor', minutes: '35' }],
    },
  },
  texts: {},
  size: { originalRows: 1212, reducedRows: 1, originalColumns: 38, reducedColumns: 3 },
  minimality: '1-minimal',
  steps: 9,
  hashes: { original: hash('2'), reduced: hash('3') },
  repair: {
    runId: STORY.runId,
    round: 4,
    codeHash: hash('4'),
    passed: true,
    results: [
      {
        counterexampleId: 'cex_travel',
        case: 'reduced',
        passed: true,
        detail: 'No longer stops with "no travel time from Harbor to North".',
      },
      {
        counterexampleId: 'cex_travel',
        case: 'original',
        passed: true,
        detail: 'Runs on the attempt’s own inputs with no value the checker contradicts.',
      },
    ],
  },
  createdAt: at(62),
};

/** Academy desk's question lookup on a "Full" practice test, where each place holds two questions. */
const LOOKUP: Counterexample = {
  id: 'cex_lookup',
  jobId: LAB.academyDeskJob,
  runId: LAB.academyDeskRun,
  round: 2,
  taskId: 'copperfield-diagnose-03',
  attemptId: 'att_copperfield_diagnose_03',
  callId: 'c1',
  helper: { name: 'question_lookup', codeHash: hash('5') },
  arguments: { test_name: 'Practice Test 4', section: 'Math', module: 2, number: 6 },
  predicate: { kind: 'threw', message: 'Error: test position not found' },
  tables: {
    'questions.csv': {
      columns: ['question_id', 'section', 'topic', 'correct'],
      rows: [
        {
          question_id: 'Q-0040',
          section: 'Math',
          topic: 'Rule 5B - Function Notation',
          correct: 'B',
        },
        {
          question_id: 'Q-0059',
          section: 'Reading and Writing',
          topic: 'Rule 2B - Verb Tense',
          correct: 'C',
        },
      ],
    },
    'tests.csv': {
      columns: ['test_name', 'section', 'module', 'number', 'question_id'],
      rows: [
        {
          test_name: 'Practice Test 4',
          section: 'Full',
          module: '2',
          number: '6',
          question_id: 'Q-0059',
        },
        {
          test_name: 'Practice Test 4',
          section: 'Full',
          module: '2',
          number: '6',
          question_id: 'Q-0040',
        },
      ],
    },
  },
  texts: {},
  size: { originalRows: 2312, reducedRows: 4, originalColumns: 63, reducedColumns: 9 },
  minimality: '1-minimal',
  steps: 4,
  hashes: { original: hash('6'), reduced: hash('7') },
  repair: {
    runId: LAB.academyDeskRun,
    round: 2,
    codeHash: hash('8'),
    passed: true,
    results: [
      {
        counterexampleId: 'cex_lookup',
        case: 'reduced',
        passed: true,
        detail: 'No longer stops with "test position not found".',
      },
      {
        counterexampleId: 'cex_lookup',
        case: 'original',
        passed: true,
        detail: 'Runs on the attempt’s own inputs with no value the checker contradicts.',
      },
    ],
  },
  createdAt: at(30),
};

const { repair: _repaired, ...unrepaired } = LOOKUP;

/** Academy desk's history helper, which counted 0.125 for 1/8 as a wrong answer. Not repaired yet. */
const HISTORY: Counterexample = {
  ...unrepaired,
  id: 'cex_history',
  round: 3,
  taskId: 'copperfield-history-01',
  attemptId: 'att_copperfield_history_01',
  helper: { name: 'history_calc', codeHash: hash('9') },
  arguments: {
    student_id: 'S-1009',
    topic: 'Rule 4A - Solving Linear Equations',
    as_of: '2026-10-03',
  },
  predicate: { kind: 'contradicts', field: 'correct', expected: 4, got: 3 },
  tables: {
    'attempts.csv': {
      columns: ['student_id', 'taken_on', 'question_id', 'selected', 'correct', 'result'],
      rows: [
        {
          student_id: 'S-1009',
          taken_on: '2026-09-20',
          question_id: 'Q-0090',
          selected: '.125',
          correct: '1/8',
          result: 'right',
        },
      ],
    },
  },
  size: { originalRows: 2312, reducedRows: 413, originalColumns: 63, reducedColumns: 30 },
  minimality: '1-minimal',
  steps: 1,
  createdAt: at(45),
};

export const ACADEMY_DESK_COUNTEREXAMPLES: Counterexample[] = [LOOKUP, HISTORY];
