import {
  ImprovementSchema,
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
import { CHATS } from './fixtures-workspace';
import { AT, at, detail, graduate, makeRun, STORY, storyReport, trainedJob } from './story';

/*
 * The Lab against the stand-in engine: Phil's field job finished and qualified, the service desk
 * training, the returns desk asking a question, the clinic intake's results waiting, and the
 * service desk agent with a chat to approve, a lesson to review and a version to promote. Every
 * figure is one of the shared story's, so the Lab agrees with the screens it opens.
 */

export const PHIL_ID = 'grd_phil';

const PHIL: GraduateSummary = {
  ...FIELD_AGENT,
  id: PHIL_ID,
  path: 'graduates/phil',
  manifest: { ...FIELD_AGENT.manifest, id: PHIL_ID },
};

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
  phil: {
    name: 'Phil',
    run: { status: 'finished', phase: 'done', accepted: true },
    job: { ...FIELD_JOB, organizations: ACADEMIES },
    totals: { mentorUsd: 2.84, rounds: 9 },
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

const DETAILS = Object.fromEntries(
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
    entry.report ? [[runId(key), { ...entry.report, runId: runId(key), name: entry.name }]] : [],
  ),
);

const JOBS = Object.fromEntries(
  Object.entries(ENTRIES).map(([key, entry]) => [
    jobId(key),
    { ...entry.job, id: jobId(key), name: entry.name },
  ]),
);

/** The service desk's improvement: version 3 made, measured, and allowed to be promoted. */
const IMPROVEMENT: Improvement = ImprovementSchema.parse({
  ...FINISHED,
  runId: 'run_improve_1',
  graduateId: STORY.graduateId,
  fromVersion: 1,
  corrections: ['cor_payments'],
  budget: { maxRounds: 3, maxMentorUsd: 1 },
  candidateVersion: 3,
});

const BASE: EngineReplies = {
  'graduates:list': [graduate, PHIL],
  'jobs:list': LAB_JOBS,
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
    [PHIL_ID]: [{ ...FIELD_CHAT, graduateId: PHIL_ID, updatedAt: at(600) }],
  });
  await stubByKey(app, 'teach:list', { [STORY.graduateId]: FLAGGED, [PHIL_ID]: [] });
  await stubByKey(app, 'teach:improvements', {
    [STORY.graduateId]: [IMPROVEMENT],
    [PHIL_ID]: [],
  });
}

export const LAB = { philRun: runId('phil'), deskRun: runId('desk'), philJob: jobId('phil') };
