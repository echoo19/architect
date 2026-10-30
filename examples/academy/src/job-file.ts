import { DEFAULT_STUDENT, JOB_FORMAT, JobSchema, mentorPreset } from '@architect/shared';
import type { DataFile, Job, Organization } from '@architect/shared';
import { TODAY } from './academy/build';

const DATA_FILES: readonly DataFile[] = [
  {
    name: 'policy.md',
    kind: 'text',
    access: 'read',
    description:
      "The academy's tutoring policy, in its own words: diagnosing a wrong answer, the first hint, history, follow-up practice and when to leave a staff note, with the academy's numbers.",
  },
  {
    name: 'students.csv',
    kind: 'table',
    access: 'read',
    description: 'Each student: name, grade, target score, test date and tutor.',
  },
  {
    name: 'staff.csv',
    kind: 'table',
    access: 'read',
    optional: true,
    description: 'The staff: the director and the tutors.',
  },
  {
    name: 'topics.csv',
    kind: 'table',
    access: 'read',
    optional: true,
    description: "The academy's topic labels, each with its section and its lesson video folder.",
  },
  {
    name: 'errors.csv',
    kind: 'table',
    access: 'read',
    optional: true,
    description:
      "The errors the academy's answer explanations name, by topic. Each wrong choice in the bank comes from one of them.",
  },
  {
    name: 'hints.csv',
    kind: 'table',
    access: 'read',
    optional: true,
    description:
      'The approved first hints by topic: one general hint per topic and hints written for particular errors.',
  },
  {
    name: 'questions.csv',
    kind: 'table',
    access: 'read',
    description:
      'The question bank: full text, four choices, the right choice, the topic and difficulty_pct, the percent of students who get it right.',
  },
  {
    name: 'tests.csv',
    kind: 'table',
    access: 'read',
    description:
      'The practice tests: which bank question sits at each section, module and question number.',
  },
  {
    name: 'attempts.csv',
    kind: 'table',
    access: 'read',
    description:
      "Every answer students gave on practice tests: the date, where in the test, the topic, the choice picked, the right choice and the result, the academy's own mark.",
  },
  {
    name: 'videos.csv',
    kind: 'table',
    access: 'read',
    optional: true,
    description: 'The lesson videos: title, folder, description and length in minutes.',
  },
  {
    name: 'assignments.csv',
    kind: 'table',
    access: 'write',
    description: 'Practice questions assigned to students. New assignments go here.',
  },
  {
    name: 'staff_notes.csv',
    kind: 'table',
    access: 'write',
    optional: true,
    description:
      "Notes left for a student's tutor. A note that a student needs attention goes here.",
  },
];

/**
 * The academy job: one tutor, Phil, for every academy. Each organization's files sit in
 * orgs/<id>/data/ with the same names; a task names its organization. Tasks of the train
 * academies split as usual; the transfer academy is test-only.
 */
export function buildJob(organizations: readonly Organization[]): Job {
  const mentor = mentorPreset('meta-spark');
  return JobSchema.parse({
    format: JOB_FORMAT,
    id: 'sample-academy',
    name: 'Phil',
    description:
      'Phil tutors students at a test-prep academy right after a wrong answer on a practice test. ' +
      "It works from the academy's own files: its topic labels, question bank, practice tests, " +
      "every student's answers, the errors and approved hints its explanations use, its lesson " +
      'videos and its tutoring policy. It names what went wrong, gives an approved first hint, ' +
      "reads a student's history on a topic, works questions, assigns follow-up practice and, when " +
      'the policy says so, leaves a note for the tutor. It only writes to assignments.csv and ' +
      'staff_notes.csv.',
    summary: "Tutors a student right after a wrong answer, by the academy's own policy.",
    does: [
      'Names the topic, the right choice and the error behind a wrong answer',
      'Gives the approved first hint the policy calls for',
      "Reads a student's history on a topic and says when to escalate",
      'Assigns follow-up practice from the question bank',
    ],
    doesNot: [
      'Never writes its own hints or gives the answer away',
      'Never changes past assignments or notes',
      'Asks before it saves practice or a note',
    ],
    createdAt: '2026-10-30T00:00:00.000Z',
    businessDate: TODAY,
    taskTypes: [
      {
        id: 'diagnose',
        label: 'Diagnose',
        description: 'Name the topic, right choice and error behind a wrong answer.',
      },
      { id: 'solve', label: 'Solve', description: 'Work a question given in the request.' },
      { id: 'hint', label: 'Hint', description: 'Choose the approved first hint.' },
      { id: 'history', label: 'History', description: "Read a student's record on a topic." },
      { id: 'assign', label: 'Assign', description: 'Assign follow-up practice.' },
      {
        id: 'after_wrong',
        label: 'Tutoring turn',
        description: 'The whole turn after a wrong answer, by the policy.',
      },
    ],
    data: { files: DATA_FILES },
    permissions: { writes: 'ask', unseenFiles: 'never' },
    checker: { kind: 'module', path: 'checker.js' },
    requirements: { passRate: 0.9 },
    budget: { maxRounds: 8, maxMentorUsd: 5, maxWallMinutes: 240 },
    mentor: {
      kind: 'model',
      provider: mentor.provider,
      label: mentor.label,
      baseUrl: mentor.baseUrl,
      model: mentor.model,
      reasoningEffort: 'medium',
      secretRef: 'meta',
    },
    student: {
      label: DEFAULT_STUDENT.label,
      local: {
        runtime: DEFAULT_STUDENT.runtime,
        baseUrl: DEFAULT_STUDENT.baseUrl,
        model: DEFAULT_STUDENT.model,
        contextLength: DEFAULT_STUDENT.contextLength,
      },
      trainOn: 'local',
    },
    startingHarness: { kind: 'blank' },
    // The train academies' 252 tasks: 12 + 84 + 48 + 48, and the 60 sealed for the certificate.
    // The transfer academy's are test-only.
    splits: { seed: 20261116, calibration: 12, train: 84, dev: 48, test: 48 },
    evaluation: {
      trainBatch: 12,
      minDevGain: 2,
      maxTypeRegression: 1,
      patience: 4,
      certify: { k: 5, epsilon: 0.1, delta: 0.05, calibration: 60 },
    },
    organizations,
  });
}
