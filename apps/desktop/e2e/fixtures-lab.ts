import {
  ExperimentRecordSchema,
  ImprovementSchema,
  type ExperimentRecord,
  type GraduateSummary,
  type Improvement,
  type Job,
  type JobRun,
  type JobSummary,
  type ReportCard,
  type RunDetail,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { LLAMA_SERVER_READY, LOCAL_WITH_GLIMMER, type EngineReplies, stubEngine } from './fixtures';
import {
  EARLIER_REPORT,
  FIELD_AGENT,
  FIELD_CHAT,
  FIELD_JOB,
  FIELD_REPORT,
  MINI_REPORT,
} from './fixtures-field';
import { stubByKey } from './fixtures-flow';
import {
  ASSAY_DESK_JOB,
  SWEEP_DESK_AGENT,
  SWEEP_DESK_ID,
  SWEEP_DESK_JOB,
  SWEEP_REPORT,
} from './fixtures-science';
import { FINISHED, FLAGGED } from './fixtures-teaching';
import { AGENT_WITH_VERSIONS } from './fixtures-versions';
import { CHATS } from './fixtures-workspace';
import {
  academyDetail,
  academyVersion,
  ACADEMY_EARLIER_RUN,
  ACADEMY_MINI_RUN,
  ACADEMY_RUN,
  AT,
  at,
  detail,
  makeRun,
  STORY,
  storyReport,
  trainedJob,
  type AcademyRunStory,
} from './story';

/*
 * The Lab against the stand-in engine: Academy desk's field job finished and qualified, the service desk
 * training, the returns desk asking a question, the clinic intake's results waiting, and the
 * service desk agent with a chat to approve, a lesson to review and a version to weigh. Every
 * figure is one of the shared story's, and the agents are the ones Models lists (version 2 active
 * for the service desk and for Academy desk), so the Lab agrees with the screens it opens.
 */

export const ACADEMY_DESK_ID = 'grd_academy_desk';
export const MINI_ID = 'grd_academy_desk_mini';

export const ACADEMY_DESK_AGENT: GraduateSummary = {
  ...FIELD_AGENT,
  id: ACADEMY_DESK_ID,
  path: 'graduates/academy-desk',
  activeVersion: 2,
  versions: 2,
  manifest: { ...FIELD_AGENT.manifest, id: ACADEMY_DESK_ID, jobId: 'job_academy_desk' },
};

export const MINI_AGENT: GraduateSummary = {
  ...ACADEMY_DESK_AGENT,
  id: MINI_ID,
  name: 'Academy desk Mini',
  path: 'graduates/academy-desk-mini',
  activeVersion: 1,
  versions: 1,
  manifest: {
    ...ACADEMY_DESK_AGENT.manifest,
    id: MINI_ID,
    name: 'Academy desk Mini',
    runId: ACADEMY_MINI_RUN.runId,
    createdAt: ACADEMY_MINI_RUN.testedAt,
    acceptedAt: ACADEMY_MINI_RUN.testedAt,
    student: { ...ACADEMY_DESK_AGENT.manifest.student, quantization: 'Q8_0' },
    harness: {
      ...ACADEMY_DESK_AGENT.manifest.harness,
      version: academyVersion(ACADEMY_MINI_RUN),
      round: ACADEMY_MINI_RUN.changes.length,
    },
    requirements: MINI_REPORT.requirements,
    test: { score: MINI_REPORT.test.score, perType: MINI_REPORT.test.perType },
  },
};

/** Every agent, as Models lists them. */
export const LAB_AGENTS: GraduateSummary[] = [
  AGENT_WITH_VERSIONS,
  ACADEMY_DESK_AGENT,
  MINI_AGENT,
  SWEEP_DESK_AGENT,
];

interface Entry {
  name: string;
  /** Absent for a field not taught yet. */
  run?: Partial<JobRun> & Pick<JobRun, 'status' | 'phase'>;
  job: Job;
  taskCount?: number;
  /** What the run's records say it spent and how far it got. */
  totals?: Partial<RunDetail['run']['totals']>;
  report?: ReportCard;
  /** A field with a training story of its own, which its run's screens read. */
  story?: AcademyRunStory;
}

const ACADEMIES: Job['organizations'] = [
  { id: 'northside', name: 'Northside Prep', synthetic: true, role: 'train' },
  { id: 'lakeview', name: 'Lakeview Academy', synthetic: true, role: 'train' },
  { id: 'summit', name: 'Summit Tutoring', synthetic: true, role: 'train' },
];

const ENTRIES: Record<string, Entry> = {
  academy_desk: {
    name: 'Academy desk',
    run: { status: 'finished', phase: 'done', accepted: true },
    job: { ...FIELD_JOB, organizations: ACADEMIES },
    report: FIELD_REPORT,
    story: ACADEMY_RUN,
  },
  desk: {
    name: 'Service desk',
    run: { status: 'running', phase: 'diagnosing', devCurrent: { pass: 62, total: 80 } },
    job: trainedJob,
    totals: { mentorUsd: 0.23, rounds: 4 },
  },
  parts: {
    name: 'Parts counter',
    run: { status: 'running', phase: 'attempting', devCurrent: { pass: 21, total: 40 } },
    job: { ...trainedJob, budget: { ...trainedJob.budget, maxRounds: 8, maxMentorUsd: 2 } },
    totals: { mentorUsd: 1.62, rounds: 7 },
  },
  returns: {
    name: 'Returns desk',
    run: { status: 'paused', phase: 'clarifying' },
    job: trainedJob,
    totals: { mentorUsd: 0.11, rounds: 2 },
  },
  clinic: {
    name: 'Clinic intake',
    run: { status: 'finished', phase: 'done', accepted: false },
    job: trainedJob,
    totals: { mentorUsd: storyReport.cost.mentorUsd, rounds: storyReport.cost.rounds },
    report: storyReport,
  },
  sweep_desk: {
    name: 'Sweep desk',
    run: { status: 'finished', phase: 'done', accepted: true },
    job: SWEEP_DESK_JOB,
    taskCount: 192,
    totals: { mentorUsd: SWEEP_REPORT.cost.mentorUsd, rounds: SWEEP_REPORT.cost.rounds },
    report: SWEEP_REPORT,
  },
  assay_desk: { name: 'Assay desk', job: ASSAY_DESK_JOB, taskCount: 192 },
};

/** The service desk's job is the one its agent was trained on, so a version leads back to it. */
const jobId = (key: string) => (key === 'desk' ? STORY.jobId : `job_${key}`);
const runId = (key: string) => `run_${key}`;

export const LAB_JOBS: JobSummary[] = Object.entries(ENTRIES).map(([key, entry]) => ({
  id: jobId(key),
  name: entry.name,
  createdAt: AT,
  taskCount: entry.taskCount ?? 170,
  ...(entry.run
    ? {
        latestRun: {
          id: runId(key),
          method: 'architect' as const,
          devCurrent: null,
          devBaseline: null,
          ...entry.run,
        },
      }
    : {}),
}));

export const JOBS: Record<string, Job> = Object.fromEntries(
  Object.entries(ENTRIES).map(([key, entry]) => [
    jobId(key),
    { ...entry.job, id: jobId(key), name: entry.name },
  ]),
);

const academyJob = JOBS[jobId('academy_desk')] as Job;

/** Each run's training screen: Academy desk's three runs their own, the rest the service desk's. */
export const DETAILS: Record<string, RunDetail> = {
  ...Object.fromEntries(
    Object.entries(ENTRIES).flatMap(([key, { run, story, ...entry }]) => {
      if (!run) return [];
      const job = JOBS[jobId(key)] as Job;
      if (story) return [[runId(key), academyDetail(story, job)]];
      return [
        [
          runId(key),
          {
            ...detail,
            run: makeRun({
              id: runId(key),
              jobId: jobId(key),
              status: run.status,
              phase: run.phase,
              devCurrent: run.devCurrent ?? detail.run.devCurrent,
              totals: { ...detail.run.totals, ...entry.totals },
            }),
            job,
          } satisfies RunDetail,
        ],
      ];
    }),
  ),
  [ACADEMY_EARLIER_RUN.runId]: academyDetail(ACADEMY_EARLIER_RUN, academyJob),
  [ACADEMY_MINI_RUN.runId]: academyDetail(ACADEMY_MINI_RUN, academyJob),
};

/** Each finished run's card, Academy desk's earlier and Mini runs among them. */
export const LAB_REPORTS: Record<string, ReportCard> = {
  ...Object.fromEntries(
    Object.entries(ENTRIES).flatMap(([key, entry]) =>
      entry.report
        ? [
            [
              runId(key),
              { ...entry.report, jobId: jobId(key), runId: runId(key), name: entry.name },
            ],
          ]
        : [],
    ),
  ),
  [ACADEMY_EARLIER_RUN.runId]: EARLIER_REPORT,
  [ACADEMY_MINI_RUN.runId]: MINI_REPORT,
};

/**
 * The service desk's improvement from the active version 2: version 3 made and measured, and
 * allowed to be promoted though it passed fewer check tasks (70 of 80 against 75), as Models shows.
 */
const IMPROVEMENT: Improvement = ImprovementSchema.parse({
  ...FINISHED,
  dev: { before: { pass: 75, total: 80 }, after: { pass: 70, total: 80 } },
  runId: 'run_improve_1',
  graduateId: STORY.graduateId,
  fromVersion: 2,
  corrections: ['cor_payments'],
  budget: { maxRounds: 3, maxMentorUsd: 1 },
  candidateVersion: 3,
});

/** An experiment on one of the Lab's fields, as the engine keeps it. */
function experiment(
  id: string,
  name: string,
  job: string,
  status: ExperimentRecord['status'],
  question: Pick<ExperimentRecord['input'], 'hypothesis' | 'primaryComparison'>,
  extra: Partial<ExperimentRecord> = {},
): ExperimentRecord {
  return ExperimentRecordSchema.parse({
    id,
    input: {
      name,
      jobId: jobId(job),
      ...question,
      arms: [{ arm: 'bare' }, { arm: 'draft' }, { arm: 'targeted' }],
      seeds: { mentoring: 1, lockedTest: [101] },
      rounds: 4,
      caps: { studentUsd: 15, sparkUsd: 10, computeUsd: 0, wallMinutes: 720 },
    },
    job: { id: jobId(job), name: ENTRIES[job]?.name ?? job, splitsSeed: 7 },
    status,
    preregistration: null,
    calibratedAt: at(300),
    runningMs: 0,
    createdAt: at(300),
    updatedAt: at(600),
    ...extra,
  });
}

/** The plan frozen before an experiment on `job` ran, as every started one has. */
function preregistered(job: string, sha256: string): Pick<ExperimentRecord, 'preregistration'> {
  return {
    preregistration: {
      at: at(-200),
      sha256,
      pinned: {
        jobId: jobId(job),
        name: ENTRIES[job]?.name ?? job,
        job: '4c'.repeat(32),
        tasks: '9e'.repeat(32),
        data: 'b1'.repeat(32),
        checker: '07'.repeat(32),
      },
    },
  };
}

/**
 * The Lab's experiments, newest first: one running on Academy desk, one on the service desk
 * paused before its release because an arm can't be paid for at what an attempt really cost, and
 * one finished on Sweep desk, its results released.
 */
export const LAB_EXPERIMENTS: ExperimentRecord[] = [
  experiment(
    'cmp_targeted',
    'Targeted against one-shot draft',
    'academy_desk',
    'running',
    {
      hypothesis:
        "Changes made round by round from Glimmer's own failures carry to academies it never " +
        'saw better than one draft written before any practice.',
      primaryComparison: { a: 'targeted', b: 'draft', group: 'unseen' },
    },
    {
      ...preregistered(
        'academy_desk',
        '5b0e9a14c7d3f28e61a4b9c0d7e2f5a83c6b1d409e7f2a5c8d3b6e0f1a4c7d92',
      ),
      runningMs: 47 * 60_000,
    },
  ),
  experiment(
    'cmp_funding',
    'Draft on the service desk',
    'desk',
    'needs_funding',
    {
      hypothesis:
        'One harness drafted from the job before any practice lifts Glimmer on the service ' +
        'desk, most on invoices, where the policy alone says how to price a visit.',
      primaryComparison: { a: 'draft', b: 'bare', group: 'all' },
    },
    {
      ...preregistered('desk', 'c2a7f4e19b0d63852e4f7a1c9d0b3e6f8a5c2d7e4b1f0a39c6d8e2b5f7a0c4d1'),
      reason:
        'The Spark-engineered harness needs $4.20 more of Glimmer than its cap to take its sealed final test.',
      runningMs: 22 * 60_000,
    },
  ),
  experiment(
    'cmp_sweep',
    'Targeted against Glimmer alone',
    'sweep_desk',
    'finished',
    {
      hypothesis:
        "Spark's engineered harness passes more of Sweep desk's final test than Glimmer alone " +
        'at the research groups it was taught on.',
      primaryComparison: { a: 'targeted', b: 'bare', group: 'seen' },
    },
    {
      ...preregistered(
        'sweep_desk',
        '8d41c2e07b9a3f65d1e48c20a7f93b6e5c0d24a19f7e83b6c5a0d1e2f3b4c5d6',
      ),
      runningMs: 214 * 60_000,
    },
  ),
];

const BASE: EngineReplies = {
  'graduates:list': LAB_AGENTS,
  'jobs:list': LAB_JOBS,
  'experiments:list': LAB_EXPERIMENTS,
  'connections:detectLocal': LOCAL_WITH_GLIMMER,
  'connections:llamaServer': LLAMA_SERVER_READY,
  'graduates:hasSampleAgent': false,
};

/** Answers every read the Lab and the places make, each by the id it is asked for. */
export async function stubLab(app: ElectronApplication): Promise<void> {
  await stubEngine(app, BASE);
  await stubByKey(app, 'runs:get', DETAILS);
  await stubByKey(app, 'reports:get', LAB_REPORTS);
  await stubByKey(app, 'jobs:get', JOBS);
  await stubByKey(app, 'workspace:listChats', {
    [STORY.graduateId]: Object.values(CHATS),
    [ACADEMY_DESK_ID]: [{ ...FIELD_CHAT, graduateId: ACADEMY_DESK_ID, updatedAt: at(600) }],
    [MINI_ID]: [],
    [SWEEP_DESK_ID]: [],
  });
  await stubByKey(app, 'teach:list', {
    [STORY.graduateId]: FLAGGED,
    [ACADEMY_DESK_ID]: [],
    [MINI_ID]: [],
    [SWEEP_DESK_ID]: [],
  });
  await stubByKey(app, 'teach:improvements', {
    [STORY.graduateId]: [IMPROVEMENT],
    [ACADEMY_DESK_ID]: [],
    [MINI_ID]: [],
    [SWEEP_DESK_ID]: [],
  });
}

export const LAB = {
  academyDeskRun: runId('academy_desk'),
  academyEarlierRun: ACADEMY_EARLIER_RUN.runId,
  academyMiniRun: ACADEMY_MINI_RUN.runId,
  deskRun: runId('desk'),
  academyDeskJob: jobId('academy_desk'),
  sweepDeskJob: jobId('sweep_desk'),
  assayDeskJob: jobId('assay_desk'),
};
