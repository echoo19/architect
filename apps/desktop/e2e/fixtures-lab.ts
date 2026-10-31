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
import { FIELD_AGENT, FIELD_CHAT, FIELD_JOB, FIELD_REPORT } from './fixtures-field';
import { stubByKey } from './fixtures-flow';
import { FINISHED, FLAGGED } from './fixtures-teaching';
import { AGENT_WITH_VERSIONS } from './fixtures-versions';
import { CHATS } from './fixtures-workspace';
import { AT, at, detail, makeRun, STORY, storyReport, trainedJob } from './story';

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
  manifest: { ...ACADEMY_DESK_AGENT.manifest, id: MINI_ID, name: 'Academy desk Mini' },
};

/** Every agent, as Models lists them. */
export const LAB_AGENTS: GraduateSummary[] = [AGENT_WITH_VERSIONS, ACADEMY_DESK_AGENT, MINI_AGENT];

interface Entry {
  name: string;
  run: Partial<JobRun> & Pick<JobRun, 'status' | 'phase'>;
  job: Job;
  /** What the run's records say it spent and how far it got. */
  totals?: Partial<RunDetail['run']['totals']>;
  report?: ReportCard;
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
    totals: { mentorUsd: 2.84, rounds: 7 },
    report: { ...FIELD_REPORT, cost: { ...FIELD_REPORT.cost, mentorUsd: 2.84, studentUsd: 0.61 } },
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
    totals: { mentorUsd: 0.62, rounds: 7 },
    report: storyReport,
  },
};

const jobId = (key: string) => `job_${key}`;
const runId = (key: string) => `run_${key}`;

export const LAB_JOBS: JobSummary[] = Object.entries(ENTRIES).map(([key, entry]) => ({
  id: jobId(key),
  name: entry.name,
  createdAt: AT,
  taskCount: 170,
  latestRun: {
    id: runId(key),
    method: 'architect',
    devCurrent: null,
    devBaseline: null,
    ...entry.run,
  },
}));

export const DETAILS = Object.fromEntries(
  Object.entries(ENTRIES).map(([key, entry]) => [
    runId(key),
    {
      ...detail,
      run: makeRun({
        id: runId(key),
        jobId: jobId(key),
        status: entry.run.status,
        phase: entry.run.phase,
        devCurrent: entry.run.devCurrent ?? detail.run.devCurrent,
        totals: { ...detail.run.totals, ...entry.totals },
      }),
      job: { ...entry.job, id: jobId(key), name: entry.name },
    } satisfies RunDetail,
  ]),
);

const REPORTS = Object.fromEntries(
  Object.entries(ENTRIES).flatMap(([key, entry]) =>
    entry.report
      ? [[runId(key), { ...entry.report, jobId: jobId(key), runId: runId(key), name: entry.name }]]
      : [],
  ),
);

export const JOBS = Object.fromEntries(
  Object.entries(ENTRIES).map(([key, entry]) => [
    jobId(key),
    { ...entry.job, id: jobId(key), name: entry.name },
  ]),
);

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
  extra: Partial<ExperimentRecord> = {},
): ExperimentRecord {
  return ExperimentRecordSchema.parse({
    id,
    input: {
      name,
      jobId: jobId(job),
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

/**
 * The Lab's experiments, newest first: one running on Academy desk, and one on the service desk
 * paused before its release because an arm can't be paid for at what an attempt really cost.
 */
export const LAB_EXPERIMENTS: ExperimentRecord[] = [
  experiment('cmp_targeted', 'Targeted against one-shot draft', 'academy_desk', 'running', {
    runningMs: 47 * 60_000,
  }),
  experiment('cmp_funding', 'Draft on the service desk', 'desk', 'needs_funding', {
    reason: 'The targeted arm needs $4.20 more of Glimmer than its cap.',
    runningMs: 22 * 60_000,
  }),
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
  await stubByKey(app, 'reports:get', REPORTS);
  await stubByKey(app, 'jobs:get', JOBS);
  await stubByKey(app, 'workspace:listChats', {
    [STORY.graduateId]: Object.values(CHATS),
    [ACADEMY_DESK_ID]: [{ ...FIELD_CHAT, graduateId: ACADEMY_DESK_ID, updatedAt: at(600) }],
    [MINI_ID]: [],
  });
  await stubByKey(app, 'teach:list', {
    [STORY.graduateId]: FLAGGED,
    [ACADEMY_DESK_ID]: [],
    [MINI_ID]: [],
  });
  await stubByKey(app, 'teach:improvements', {
    [STORY.graduateId]: [IMPROVEMENT],
    [ACADEMY_DESK_ID]: [],
    [MINI_ID]: [],
  });
}

export const LAB = {
  academyDeskRun: runId('academy_desk'),
  deskRun: runId('desk'),
  academyDeskJob: jobId('academy_desk'),
};
