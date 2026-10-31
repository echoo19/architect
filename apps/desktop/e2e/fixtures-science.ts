import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  JobSchema,
  type FieldFile,
  type FieldView,
  type GraduateSummary,
  type Job,
  type OrgTypeResult,
  type ReportCard,
  type Run,
  type StudyBrief,
  type TaskPlan,
  type TypeResult,
} from '@architect/shared';
import { at, graduate, makeRun, storyReport } from './story';

/*
 * The science lab on the stand-in engine: Sweep desk, taught on three research groups and sealed
 * from a fourth, with two runs, a version from each and their final tests; and Assay desk, a
 * field of four screening labs studied and not yet taught. The jobs, organizations, skills and
 * files are the shipped examples' own (examples/sweep-desk, examples/assay-desk); the scores are
 * stand-ins, as every capture's are, and the same everywhere they appear.
 */

const EXAMPLES = fileURLToPath(new URL('../../../examples/', import.meta.url));

/** A shipped job with the id the Lab keeps it under, and only the organizations taught on. */
function shipped(folder: string, id: string): { job: Job; sealed: Job['organizations'] } {
  const job = JobSchema.parse(
    JSON.parse(readFileSync(join(EXAMPLES, folder, 'job', 'job.json'), 'utf8')),
  );
  const organizations = job.organizations ?? [];
  return {
    job: { ...job, id, organizations: organizations.filter((org) => org.role === 'train') },
    sealed: organizations.filter((org) => org.role !== 'train'),
  };
}

/** Rows a file holds: lines under a CSV's header, entries of a JSON file, none for prose. */
function rowsOf(path: string, name: string): number | null {
  const text = readFileSync(path, 'utf8');
  if (name.endsWith('.csv')) return text.split('\n').filter((line) => line.trim()).length - 1;
  if (name.endsWith('.json')) {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.length : Object.keys(parsed as object).length;
  }
  return null;
}

/** An organization's files as the engine reads them, from the example's own folder. */
function filesOf(folder: string, org: string): FieldFile[] {
  const dir = join(EXAMPLES, folder, 'job', 'orgs', org, 'data');
  return readdirSync(dir)
    .sort()
    .map((name) => ({
      name,
      bytes: statSync(join(dir, name)).size,
      rows: rowsOf(join(dir, name), name),
    }));
}

function fieldOf(folder: string, made: ReturnType<typeof shipped>, testTasks: number): FieldView {
  return {
    jobId: made.job.id,
    organizations: (made.job.organizations ?? []).map((org) => ({
      id: org.id,
      name: org.name,
      synthetic: org.synthetic,
      files: filesOf(folder, org.id),
    })),
    sealed: (made.sealed ?? []).map((org) => ({
      name: org.name,
      synthetic: org.synthetic,
      files: filesOf(folder, org.id).length,
    })),
    lockedTestTasks: testTasks,
  };
}

export const SWEEP_DESK_ID = 'grd_sweep_desk';

const sweep = shipped('sweep-desk', 'job_sweep_desk');
const assay = shipped('assay-desk', 'job_assay_desk');

export const SWEEP_DESK_JOB = sweep.job;
export const ASSAY_DESK_JOB = assay.job;

/** The groups' final tests: 2 tasks of each skill at each group taught on, 8 at Fennick. */
const GROUPS = [
  { org: 'halden', name: 'Halden Lab', seen: true },
  { org: 'quill', name: 'Quill Systems Group', seen: true },
  { org: 'marlow', name: 'Marlow Learning Group', seen: true },
  { org: 'fennick', name: 'Fennick Research', seen: false },
] as const;

type Group = (typeof GROUPS)[number]['org'];

/** Passes of each skill at each group, in the job's order of skills. */
type Passes = Record<Group, readonly number[]>;

const LATEST: Passes = {
  halden: [2, 2, 2, 1, 2, 2],
  quill: [2, 1, 2, 2, 2, 2],
  marlow: [2, 2, 2, 2, 1, 2],
  fennick: [7, 6, 7, 5, 6, 6],
};

const EARLIER: Passes = {
  halden: [2, 2, 1, 1, 2, 1],
  quill: [2, 1, 2, 1, 2, 2],
  marlow: [2, 2, 2, 1, 1, 2],
  fennick: [6, 5, 6, 4, 5, 5],
};

const skills = SWEEP_DESK_JOB.taskTypes;

function perOrg(passes: Passes): OrgTypeResult[] {
  return skills.flatMap((skill, index) =>
    GROUPS.map((group) => ({
      type: skill.id,
      label: skill.label,
      org: group.org,
      orgName: group.name,
      seen: group.seen,
      synthetic: true,
      pass: passes[group.org][index] ?? 0,
      total: group.seen ? 2 : 8,
    })),
  );
}

/** A final test as the card holds it: the score and each skill count the groups taught on. */
function finalTest(passes: Passes) {
  const rows = perOrg(passes);
  const perType: TypeResult[] = skills.map((skill) => {
    const seen = rows.filter((row) => row.type === skill.id && row.seen);
    return {
      type: skill.id,
      label: skill.label,
      pass: seen.reduce((sum, row) => sum + row.pass, 0),
      total: seen.reduce((sum, row) => sum + row.total, 0),
      refused: false,
    };
  });
  const score = {
    pass: perType.reduce((sum, type) => sum + type.pass, 0),
    total: perType.reduce((sum, type) => sum + type.total, 0),
  };
  return { rows, perType, score };
}

const latest = finalTest(LATEST);
const earlier = finalTest(EARLIER);

/** Every task of the final test, the sealed group's included. */
export const SWEEP_TEST_TASKS = latest.rows.reduce((sum, row) => sum + row.total, 0);

export const SWEEP = {
  job: SWEEP_DESK_JOB.id,
  run: 'run_sweep_desk',
  earlierRun: 'run_sweep_desk_earlier',
  score: latest.score,
  earlierScore: earlier.score,
};

/** A check-task curve: each round's decision, kept rounds measured twice. */
type Point = ReportCard['dev']['curve'][number];
const point = (round: number, pass: number, decision: Point['decision']): Point => ({
  round,
  score: { pass, total: decision === 'kept' ? 72 : 36 },
  decision,
});

function card(
  runId: string,
  test: ReturnType<typeof finalTest>,
  dev: { baseline: number; final: number; curve: Point[] },
  cost: { mentorUsd: number; studentUsd: number; rounds: number; minutes: number },
  createdAt: string,
  interventions: ReportCard['topInterventions'],
): ReportCard {
  return {
    ...storyReport,
    jobId: SWEEP.job,
    runId,
    name: 'Sweep desk',
    organizationNoun: SWEEP_DESK_JOB.organizationNoun,
    createdAt,
    testedOn: 'hosted',
    test: {
      ...storyReport.test,
      score: test.score,
      perType: test.perType,
      perOrg: test.rows,
      latencyMs: { p50: 41_000, p95: 96_000 },
      refusals: 0,
    },
    dev: {
      baseline: { pass: dev.baseline, total: 36 },
      final: { pass: dev.final, total: 72 },
      curve: dev.curve,
    },
    cost: {
      mentorUsd: cost.mentorUsd,
      studentUsd: cost.studentUsd,
      mentorInputTokens: 164_000,
      mentorOutputTokens: 29_500,
      rounds: cost.rounds,
      wallMs: cost.minutes * 60_000,
    },
    refusedTypes: [],
    topInterventions: interventions,
    requirements: {
      passRate: {
        target: 0.9,
        actual: test.score.pass / test.score.total,
        met: test.score.pass / test.score.total >= 0.9,
      },
    },
    overclaim: null,
  };
}

export const SWEEP_REPORT = card(
  SWEEP.run,
  latest,
  {
    baseline: 19,
    final: 66,
    curve: [
      point(0, 19, 'baseline'),
      point(1, 21, 'reverted'),
      point(2, 52, 'kept'),
      point(3, 27, 'reverted'),
      point(4, 60, 'kept'),
      point(5, 30, 'reverted'),
      point(6, 66, 'kept'),
    ],
  },
  { mentorUsd: 1.92, studentUsd: 0.74, rounds: 6, minutes: 188 },
  at(130),
  [
    { round: 2, title: "Read the metric names from the group's policy", delta: 8 },
    { round: 4, title: 'Pair runs by seed before comparing configs', delta: 4, runs: 2 },
    { round: 6, title: 'Call a run diverged by its loss, never by its status', delta: 3 },
  ],
);

export const SWEEP_EARLIER_REPORT = card(
  SWEEP.earlierRun,
  earlier,
  {
    baseline: 19,
    final: 56,
    curve: [
      point(0, 19, 'baseline'),
      point(1, 46, 'kept'),
      point(2, 24, 'reverted'),
      point(3, 52, 'kept'),
      point(4, 56, 'kept'),
    ],
  },
  { mentorUsd: 1.18, studentUsd: 0.46, rounds: 4, minutes: 121 },
  at(-1_440),
  [{ round: 1, title: "Read the metric names from the group's policy", delta: 8 }],
);

const sweepRun = (
  id: string,
  report: ReportCard,
  version: number,
  endedAt: string,
  extra: Partial<Run>,
): Run =>
  makeRun({
    id,
    jobId: SWEEP.job,
    status: 'finished',
    phase: 'done',
    currentVersion: version,
    createdAt: at(-3_000),
    updatedAt: endedAt,
    endedAt,
    devBaseline: report.dev.baseline,
    devCurrent: report.dev.final,
    totals: {
      ...makeRun({}).totals,
      mentorUsd: report.cost.mentorUsd,
      rounds: report.cost.rounds,
      wallMs: report.cost.wallMs,
    },
    ...extra,
  });

/** Sweep desk's runs, newest first: the one its agent's active version came from, then the first. */
export const SWEEP_RUNS: Run[] = [
  sweepRun(SWEEP.run, SWEEP_REPORT, 7, at(120), { graduateId: SWEEP_DESK_ID, createdAt: at(-80) }),
  sweepRun(SWEEP.earlierRun, SWEEP_EARLIER_REPORT, 4, at(-1_450), {}),
];

export const SWEEP_DESK_AGENT: GraduateSummary = {
  ...graduate,
  id: SWEEP_DESK_ID,
  name: 'Sweep desk',
  path: 'graduates/sweep-desk',
  activeVersion: 2,
  versions: 2,
  manifest: {
    ...graduate.manifest,
    id: SWEEP_DESK_ID,
    name: 'Sweep desk',
    jobId: SWEEP.job,
    runId: SWEEP.run,
    harness: { version: 7, round: 6, hash: 'sha256-sweep' },
    requirements: SWEEP_REPORT.requirements,
    test: { score: latest.score, perType: latest.perType },
  },
};

export const SWEEP_FIELD = fieldOf('sweep-desk', sweep, SWEEP_TEST_TASKS);
/** Assay desk's final test, as its README splits it: 36 at the labs taught on, 48 at Corvid Hill. */
export const ASSAY_FIELD = fieldOf('assay-desk', assay, 84);

const BRIEF: StudyBrief = {
  organizations: (SWEEP_DESK_JOB.organizations ?? []).map((org) => ({
    id: org.id,
    name: org.name,
  })),
  skills: skills.map((skill) => ({
    taskType: skill.id,
    label: skill.label,
    text: skill.description ?? skill.label,
    needs: ['policy.md', 'runs.csv', 'metrics.csv'],
    steps: ["Read the group's rule in policy.md.", 'Read the sweep and its runs.'],
    quotes: [],
    own: true,
  })),
  connections: [],
  rules: [
    {
      text: "A run's score is its last few evals' mean or its lowest eval.",
      quotes: [],
      own: true,
    },
    {
      text: 'A run diverged when its training loss is NaN or crosses a factor of its first.',
      quotes: [],
      own: true,
    },
    { text: 'Runs are paired by seed before a change is called a help.', quotes: [], own: true },
  ],
  differences: [
    { text: 'The groups name their metrics and knobs differently.', quotes: [], own: true },
    { text: 'Some groups log by step and one by epoch.', quotes: [], own: true },
    {
      text: 'Two groups keep configs in runs.csv, the others in configs.json.',
      quotes: [],
      own: true,
    },
  ],
  questions: ['Does a preempted run count toward a config with its last eval?'],
  outOfScope: [],
  dropped: 0,
};

const planOf = (job: Job, study: TaskPlan['study']): TaskPlan => ({
  source: 'included',
  counts: { calibration: 12, train: 60, dev: 36, test: 36 },
  types: job.taskTypes.map((type) => ({
    id: type.id,
    label: type.label,
    counts: { calibration: 2, train: 10, dev: 6, test: 6 },
    examples: [],
  })),
  unresolved: [],
  notes: [],
  study,
});

export const SWEEP_PLAN = planOf(SWEEP_DESK_JOB, {
  state: 'confirmed',
  token: '5e2b7a90c4d1f386',
  brief: BRIEF,
  confirmedAt: at(-3_100),
});

export const ASSAY_PLAN = planOf(ASSAY_DESK_JOB, { state: 'unstudied', token: '' });
