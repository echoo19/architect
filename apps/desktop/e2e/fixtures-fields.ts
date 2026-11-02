import type {
  FieldExportManifest,
  FieldFile,
  FieldView,
  ReportCard,
  Run,
  RunDetail,
  StudyBrief,
  TaskPlan,
} from '@architect/shared';
import type { ElectronApplication } from '@playwright/test';
import { ACADEMY_DESK_COUNTEREXAMPLES } from './fixtures-counterexamples';
import { FIELD_ORGS, FIELD_REPORT } from './fixtures-field';
import { stubByKey, taskPlan } from './fixtures-flow';
import {
  ACADEMY_DESK_ID,
  DETAILS,
  LAB,
  LAB_AGENTS,
  LAB_JOBS,
  LAB_REPORTS,
  MINI_ID,
  stubLab,
} from './fixtures-lab';
import { DESK_RUNS, MODEL_REPORTS, MODEL_VERSIONS } from './fixtures-models';
import {
  ASSAY_FIELD,
  ASSAY_PLAN,
  SWEEP,
  SWEEP_EARLIER_REPORT,
  SWEEP_FIELD,
  SWEEP_PLAN,
  SWEEP_REPORT,
  SWEEP_RUNS,
} from './fixtures-science';
import { at, makeRun, STORY } from './story';

/*
 * The Fields place against the stand-in engine, on the Lab's jobs: Academy desk's field, taught on three
 * generated academies and sealed from a generated one and a real one, with a candidate from each
 * of its three runs (versions 1 and 2, and Academy desk Mini); the science lab's Sweep desk with
 * two candidates and Assay desk not taught yet (fixtures-science); the service desk with the runs
 * its versions came from beside the one training; and the other one-organization jobs, each a
 * field of its own records. Every score is one the Lab's and Models' screens already show.
 */

/** An academy's files as the engine reads them: each table with its rows. */
function academyFiles(scale: number): FieldFile[] {
  const tables: [string, number][] = [
    ['students.csv', 48],
    ['staff.csv', 6],
    ['topics.csv', 24],
    ['errors.csv', 72],
    ['hints.csv', 96],
    ['questions.csv', 320],
    ['tests.csv', 8],
    ['attempts.csv', 2_940],
    ['videos.csv', 31],
    ['assignments.csv', 0],
    ['staff_notes.csv', 0],
  ];
  return [
    { name: 'policy.md', bytes: 2_816, rows: null },
    ...tables.map(([name, rows]) => ({
      name,
      bytes: Math.max(64, Math.round(rows * scale) * 72),
      rows: Math.round(rows * scale),
    })),
  ];
}

const seen = FIELD_ORGS.filter((org) => org.seen);
const sealed = FIELD_ORGS.filter((org) => !org.seen);

export const ACADEMY_DESK_FIELD: FieldView = {
  jobId: LAB.academyDeskJob,
  organizations: seen.map((org, index) => ({
    id: org.org,
    name: org.name,
    synthetic: org.synthetic,
    files: academyFiles(1 + index * 0.25),
  })),
  sealed: sealed.map((org) => ({
    name: org.name,
    synthetic: org.synthetic,
    files: org.synthetic ? 12 : 7,
  })),
  lockedTestTasks: FIELD_REPORT.test.perOrg?.reduce((sum, row) => sum + row.total, 0) ?? 0,
};

const deskFiles: FieldFile[] = [
  { name: 'jobs.csv', bytes: 18_400, rows: 240 },
  { name: 'customers.csv', bytes: 9_120, rows: 120 },
  { name: 'payments.csv', bytes: 14_880, rows: 310 },
  { name: 'policy.md', bytes: 3_204, rows: null },
];

const oneOrg = (jobId: string): FieldView => ({
  jobId,
  organizations: [{ id: null, name: null, synthetic: null, files: deskFiles }],
  sealed: [],
  lockedTestTasks: 60,
});

const runOf = (key: string, overrides: Partial<Run>): Run =>
  makeRun({ id: `run_${key}`, jobId: `job_${key}`, updatedAt: at(120), ...overrides });

/** Fields with runs of their own from the science lab's fixtures. */
const SCIENCE_RUNS: Record<string, Run[]> = {
  [SWEEP.job]: SWEEP_RUNS,
  [LAB.assayDeskJob]: [],
};

/** Academy desk's runs, newest first, each with the agent that holds its version. */
const ACADEMY_RUNS: Run[] = [
  [LAB.academyDeskRun, ACADEMY_DESK_ID],
  [LAB.academyMiniRun, MINI_ID],
  [LAB.academyEarlierRun, ACADEMY_DESK_ID],
].map(([id, graduateId]) => ({ ...(DETAILS[id as string] as RunDetail).run, graduateId }));

export const RUNS: Record<string, Run[]> = Object.fromEntries(
  LAB_JOBS.map((summary) => {
    const science = SCIENCE_RUNS[summary.id];
    if (science) return [summary.id, science];
    if (summary.id === LAB.academyDeskJob) return [summary.id, ACADEMY_RUNS];
    const key = summary.id.replace(/^job_/, '');
    const latest = summary.latestRun;
    const run = runOf(key, {
      ...(latest ? { id: latest.id } : {}),
      status: latest?.status ?? 'finished',
      phase: latest?.phase ?? 'done',
    });
    // The service desk's versions came from runs of its job before the one training now.
    return [summary.id, summary.id === STORY.jobId ? [run, ...DESK_RUNS.toReversed()] : [run]];
  }),
);

export const REPORT_TARGETS: Record<string, string[]> = Object.fromEntries(
  Object.values(RUNS)
    .flat()
    .map((run) => [run.id, run.status === 'finished' ? ['hosted'] : []]),
);

const BRIEF: StudyBrief = {
  organizations: seen.map((org) => ({ id: org.org, name: org.name })),
  skills: FIELD_REPORT.test.perType.map((type) => ({
    taskType: type.type,
    label: type.label,
    text: type.label,
    needs: ['policy.md'],
    steps: ['Read the policy in policy.md.'],
    quotes: [],
    own: true,
  })),
  connections: [],
  rules: [
    { text: 'Practice is of the same topic and not yet attempted.', quotes: [], own: true },
    { text: 'A hint is chosen from the catalog, never written.', quotes: [], own: true },
    { text: 'Staff hear after three misses in a row on one topic.', quotes: [], own: true },
  ],
  differences: [
    { text: 'The academies assign different numbers of questions.', quotes: [], own: true },
    { text: 'The academies name the same topics differently.', quotes: [], own: true },
  ],
  questions: ['Does a skipped question count as a wrong answer?'],
  outOfScope: [],
  dropped: 0,
};

export const ACADEMY_DESK_PLAN: TaskPlan = {
  source: 'included',
  counts: { calibration: 12, train: 96, dev: 48, test: 72 },
  types: FIELD_REPORT.test.perType.map((type) => ({
    id: type.type,
    label: type.label,
    counts: { calibration: 2, train: 16, dev: 8, test: 12 },
    examples: [],
  })),
  unresolved: [],
  notes: [],
  study: {
    state: 'confirmed',
    token: 'f0e1d2c3b4a59687',
    brief: BRIEF,
    confirmedAt: at(-2_880),
  },
};

export const ACADEMY_DESK_ASSETS: FieldExportManifest = {
  format: 'architect.field-export/1',
  created_at: at(200),
  job: {
    id: LAB.academyDeskJob,
    name: 'Academy desk',
    format: 1,
    created_at: at(0),
    sha256: 'a'.repeat(64),
  },
  counts: {
    demonstrations: 41,
    trained_turns: 118,
    train_tasks: 96,
    train_organizations: 3,
    sealed_organizations: 2,
    locked_test_tasks: ACADEMY_DESK_FIELD.lockedTestTasks ?? 0,
  },
  files: {},
  permitted_uses: {
    sft: ['supervised fine-tuning', 'training off this computer'],
    env: ['outcome reward for attempts at these train tasks', 'scoring rollouts'],
    eval: ["qualification through Architect's runner, which opens them once"],
  },
  left_out: [
    {
      what: `the final test (${ACADEMY_DESK_FIELD.lockedTestTasks ?? 0} tasks)`,
      why: 'it stays in the vault; eval/manifest.json gives its hash only',
    },
    {
      what: '2 organizations the job has never seen',
      why: 'kept in the vault with their files and tasks; eval/manifest.json gives a hash of each',
    },
    {
      what: 'the calibration and check tasks',
      why: 'they stay for measuring and choosing changes, not for training',
    },
    {
      what: 'demonstration ep_7c2',
      why: 'it comes from a workspace chat, not a train task',
    },
  ],
};

/** Each Lab job's field, by its id. */
export const FIELD_VIEWS: Record<string, FieldView> = Object.fromEntries(
  LAB_JOBS.map((job) => [
    job.id,
    job.id === LAB.academyDeskJob
      ? ACADEMY_DESK_FIELD
      : job.id === SWEEP.job
        ? SWEEP_FIELD
        : job.id === LAB.assayDeskJob
          ? ASSAY_FIELD
          : oneOrg(job.id),
  ]),
);

/** The cards the Fields place reads, by run: the Lab's, and each version's in Models. */
export const FIELD_REPORTS: Record<string, ReportCard> = {
  ...Object.fromEntries(Object.values(MODEL_REPORTS).map((report) => [report.runId, report])),
  ...LAB_REPORTS,
  [SWEEP.run]: SWEEP_REPORT,
  [SWEEP.earlierRun]: SWEEP_EARLIER_REPORT,
};

/** Each Lab job's task plan, by its id: the study confirmed where one was made. */
export const TASK_PLANS: Record<string, TaskPlan> = {
  ...Object.fromEntries(LAB_JOBS.map((job) => [job.id, taskPlan])),
  [LAB.academyDeskJob]: ACADEMY_DESK_PLAN,
  [SWEEP.job]: SWEEP_PLAN,
  [LAB.assayDeskJob]: ASSAY_PLAN,
};

/** Every read the Fields place makes, on the Lab's records. */
export async function stubFields(app: ElectronApplication): Promise<void> {
  await stubLab(app);
  await stubByKey(app, 'jobs:field', FIELD_VIEWS);
  await stubByKey(app, 'runs:list', RUNS);
  await stubByKey(app, 'reports:list', REPORT_TARGETS);
  await stubByKey(app, 'reports:get', FIELD_REPORTS);
  await stubByKey(app, 'jobs:taskPlan', TASK_PLANS);
  await stubByKey(app, 'jobs:fieldAssets', { [LAB.academyDeskJob]: ACADEMY_DESK_ASSETS });
  // The timeline's reads: each agent's versions, none certified after the fact, and no model
  // trained elsewhere qualified on any field.
  await stubByKey(app, 'graduates:versions', MODEL_VERSIONS);
  await stubByKey(
    app,
    'graduates:certifications',
    Object.fromEntries(LAB_AGENTS.map((agent) => [agent.id, []])),
  );
  await stubByKey(
    app,
    'runs:qualifications',
    Object.fromEntries(LAB_JOBS.map((job) => [job.id, []])),
  );
  await stubByKey(
    app,
    'mentoring:fieldCounterexamples',
    Object.fromEntries(
      LAB_JOBS.map((job) => [
        job.id,
        job.id === LAB.academyDeskJob ? ACADEMY_DESK_COUNTEREXAMPLES : [],
      ]),
    ),
  );
}

export const FIELDS = { earlierRun: LAB.academyEarlierRun, miniRun: LAB.academyMiniRun };
