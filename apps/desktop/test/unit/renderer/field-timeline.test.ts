import type {
  Certificate,
  Certification,
  ExperimentRecord,
  FieldView,
  Job,
  ReportCard,
  Run,
  StudyState,
} from '@architect/shared';
import { reportScores } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { Candidate } from '../../../src/renderer/src/fields/model';
import { fieldTimeline, type TimelineRecords } from '../../../src/renderer/src/fields/timeline';

const job = { id: 'job_desk', name: 'Academy desk' } as Job;

const VIEW: FieldView = {
  jobId: job.id,
  organizations: [{ id: 'north', name: 'Northside Prep', synthetic: true, files: [] }],
  sealed: [{ name: 'Harbor Learning', synthetic: true, files: 12 }],
  lockedTestTasks: 60,
};

function run(id: string, status: Run['status'], endedAt: string, rounds = 7): Run {
  return {
    id,
    jobId: job.id,
    method: 'architect',
    seed: 1,
    status,
    phase: status === 'finished' ? 'done' : 'attempting',
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: endedAt,
    ...(status === 'finished' ? { endedAt } : {}),
    currentVersion: 9,
    devBaseline: null,
    devCurrent: null,
    totals: {
      mentorUsd: 0,
      mentorInputTokens: 0,
      mentorOutputTokens: 0,
      studentInputTokens: 0,
      studentOutputTokens: 0,
      rounds,
      attempts: 0,
      wallMs: 0,
    },
  };
}

const ISSUED = {
  issued: true,
  threshold: { votes: 4, answered: 60, errors: 1, coverage: 0.78, bound: 0.071 },
  checks: [
    { seen: true, synthetic: true, tasks: 72, answered: 55, errors: 2, held: true },
    {
      org: 'harbor',
      orgName: 'Harbor Learning',
      seen: false,
      synthetic: true,
      tasks: 36,
      answered: 26,
      errors: 1,
      held: true,
    },
    {
      org: 'cp',
      orgName: 'Real academy',
      seen: false,
      synthetic: false,
      tasks: 30,
      answered: 21,
      errors: 3,
      held: false,
    },
  ],
} as unknown as Certificate;

function candidate(r: Run, testedAt: string, certificate?: Certificate): Candidate {
  const report = {
    createdAt: testedAt,
    test: {
      score: { pass: 66, total: 72 },
      perOrg: [
        {
          type: 'a',
          label: 'A',
          org: 'north',
          orgName: 'Northside Prep',
          seen: true,
          synthetic: true,
          pass: 66,
          total: 72,
        },
        {
          type: 'a',
          label: 'A',
          org: 'harbor',
          orgName: 'Harbor Learning',
          seen: false,
          synthetic: true,
          pass: 30,
          total: 36,
        },
      ],
    },
    dev: {
      curve: [
        { round: 0, score: { pass: 1, total: 2 }, decision: 'baseline' },
        { round: 1, score: { pass: 1, total: 2 }, decision: 'kept' },
        { round: 2, score: { pass: 1, total: 2 }, decision: 'reverted' },
        { round: 3, score: { pass: 2, total: 2 }, decision: 'kept' },
      ],
    },
    ...(certificate ? { certificate } : {}),
  } as unknown as ReportCard;
  return { run: r, report, scores: reportScores(report) };
}

const CONFIRMED: StudyState = {
  state: 'confirmed',
  token: 't',
  confirmedAt: '2026-10-28T09:00:00.000Z',
  brief: {
    organizations: [{ id: 'north', name: 'Northside Prep' }],
    skills: [],
    connections: [],
    rules: [],
    differences: [],
    questions: [],
    outOfScope: [],
    dropped: 0,
  },
};

const NONE: TimelineRecords = {
  study: CONFIRMED,
  counterexamples: [],
  versions: [],
  certifications: [],
  qualifications: [],
  experiments: [],
  exported: undefined,
};

describe('fieldTimeline', () => {
  const first = run('run_1', 'finished', '2026-10-29T10:00:00.000Z');
  const tested = candidate(first, '2026-10-29T11:00:00.000Z', ISSUED);

  it('tells the life oldest first, each stage from its record, with the place that holds it', () => {
    const { entries } = fieldTimeline(
      { job, view: VIEW, runs: [first], candidates: [tested] },
      {
        ...NONE,
        versions: [{ key: 'grd:2', name: 'Academy desk v2', runId: 'run_1' }],
        counterexamples: [
          { runId: 'run_1' },
          { runId: 'run_1' },
        ] as unknown as TimelineRecords['counterexamples'],
        experiments: [
          {
            id: 'cmp_1',
            input: { name: 'Targeted against draft', jobId: job.id, arms: [{}, {}, {}] },
            status: 'running',
            createdAt: '2026-10-30T10:00:00.000Z',
          } as unknown as ExperimentRecord,
        ],
        exported: { dir: 'C:\\Users\\dana\\Exports\\academy-desk', at: '2026-10-31T10:00:00.000Z' },
      },
    );
    expect(entries.map((entry) => [entry.stage, entry.sentence, entry.link.place])).toEqual([
      ['studied', 'You confirmed the study of 1 organization: 0 skills and 0 rules', 'Study'],
      ['taught', 'Trained 7 rounds, kept 2 changes and found 2 counterexamples', 'Results'],
      [
        'tested',
        'Academy desk v2 took its final test: 92% taught on and 83% never seen',
        'Results',
      ],
      [
        'certified',
        'Academy desk v2 was certified: wrong on at most 8% of the answers it gives, and it held on 1 of the 2 organizations it never saw',
        'Models',
      ],
      ['compared', 'Comparing 3 arms in “Targeted against draft”', 'Experiments'],
      ['exported', "Exported the field's training examples to …\\Exports\\academy-desk", 'Compute'],
    ]);
  });

  it('leaves out a stage with no record and suggests the first thing missing', () => {
    const uncertified = candidate(first, '2026-10-29T11:00:00.000Z');
    const result = fieldTimeline(
      { job, view: VIEW, runs: [first], candidates: [uncertified] },
      NONE,
    );
    expect(result.entries.map((entry) => entry.stage)).toEqual(['studied', 'taught', 'tested']);
    expect(result.next).toMatchObject({
      sentence: 'Certify the best version',
      link: { place: 'Results' },
    });

    const noSealed = fieldTimeline(
      { job, view: { ...VIEW, sealed: [] }, runs: [first], candidates: [uncertified] },
      NONE,
    );
    expect(noSealed.next?.sentence).toBe('Add an organization it never saw');
    expect(noSealed.next?.link.to).toEqual({ tab: 'organizations' });

    const unstudied = fieldTimeline(
      { job, view: VIEW, runs: [], candidates: [] },
      { ...NONE, study: { state: 'needed', token: 't' } },
    );
    expect(unstudied.entries).toEqual([]);
    expect(unstudied.next?.sentence).toBe('Confirm the study brief');
  });

  it('counts a certification after the fact, and asks for nothing while a training runs', () => {
    const certification = {
      id: 'crt_1',
      runId: 'run_1',
      status: 'finished',
      certificate: ISSUED,
      createdAt: '2026-10-30T09:00:00.000Z',
      endedAt: '2026-10-30T12:00:00.000Z',
    } as unknown as Certification;
    const later = {
      ...run('run_2', 'running', '2026-10-31T10:00:00.000Z', 3),
      createdAt: '2026-10-31T09:00:00.000Z',
    };
    const result = fieldTimeline(
      {
        job,
        view: VIEW,
        runs: [first, later],
        candidates: [candidate(first, '2026-10-29T11:00:00.000Z')],
      },
      {
        ...NONE,
        certifications: [certification],
        experiments: [
          {
            id: 'cmp',
            input: { name: 'X', jobId: job.id, arms: [] },
            status: 'finished',
            createdAt: '2026-10-30T13:00:00.000Z',
          } as unknown as ExperimentRecord,
        ],
      },
    );
    const certified = result.entries.find((entry) => entry.stage === 'certified');
    expect(certified?.at).toBe('2026-10-30T12:00:00.000Z');
    expect(result.entries.at(-1)?.sentence).toBe('Training, 3 rounds so far');
    expect(result.next).toBeNull();
  });
});
