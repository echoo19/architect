import { DEFAULT_STUDENT, JOB_FORMAT, JobSchema, mentorPreset } from '@architect/shared';
import type { DataFile, Job, Organization } from '@architect/shared';

/** The job's header date, the date of none of the groups: each request states its own. */
export const HEADER_DATE = '2026-11-20';

const DATA_FILES: readonly DataFile[] = [
  {
    name: 'policy.md',
    kind: 'text',
    access: 'read',
    description:
      "The group's rules for reading runs, in its own words: the metric names, a run's score, divergence, the best config, early stopping, whether a change helped, proposing runs and writing up a sweep, with the group's numbers.",
  },
  {
    name: 'sweeps.csv',
    kind: 'table',
    access: 'read',
    description:
      'Each sweep: its model, its grid of learning rates and warmups, its baseline config.',
  },
  {
    name: 'runs.csv',
    kind: 'table',
    access: 'read',
    description:
      'Each run: its sweep, its seed, how the job ended and, at some groups, its config.',
  },
  {
    name: 'configs.json',
    kind: 'text',
    access: 'read',
    optional: true,
    description: "Each run's config by run id, at groups that keep configs apart from runs.csv.",
  },
  {
    name: 'metrics.csv',
    kind: 'table',
    access: 'read',
    description: 'Every logged loss: run, step or epoch, metric and value.',
  },
  {
    name: 'proposed_runs.csv',
    kind: 'table',
    access: 'write',
    description: 'Runs proposed for the next round. New proposals go here.',
  },
  {
    name: 'decisions.csv',
    kind: 'table',
    access: 'write',
    description: "The group's decisions log. A sweep's write-up records its decision here.",
  },
];

/**
 * The sweep desk job: one specialist for every research group. Each group's files sit in
 * orgs/<id>/data/ with the same names; a task names its group. Tasks of the groups it is taught
 * on split as usual; the group it never sees is test-only.
 */
export function buildJob(organizations: readonly Organization[]): Job {
  const mentor = mentorPreset('meta-spark');
  return JobSchema.parse({
    format: JOB_FORMAT,
    id: 'sample-sweep-desk',
    name: 'Sweep desk',
    description:
      'Sweep desk helps a machine-learning research group read its training runs. It works from ' +
      "the group's own files: its sweeps, its runs and their configs, every logged loss, and the " +
      "group's policy for reading them. It names a sweep's best config by the group's rule, finds " +
      'the runs that diverged, says where early stopping would have stopped a run, says whether a ' +
      'change helped with a paired comparison over seeds, proposes the next runs within the budget ' +
      'and the grid, and writes up a sweep. It only writes to proposed_runs.csv and decisions.csv.',
    summary: "Reads a research group's training runs by the group's own rules.",
    does: [
      "Names a sweep's best config by the group's rule",
      'Finds the runs that diverged and where early stopping stops a run',
      'Says whether a change helped, paired over seeds',
      'Proposes the next runs within the budget and the grid',
    ],
    doesNot: [
      'Never changes a run, a metric or a past decision',
      'Never proposes a run off the grid or over the budget',
      'Asks before it saves proposals or a decision',
    ],
    createdAt: '2026-10-30T00:00:00.000Z',
    businessDate: HEADER_DATE,
    taskTypes: [
      { id: 'best_config', label: 'Best config', description: "A sweep's best config." },
      {
        id: 'early_stop',
        label: 'Early stop',
        description: 'Where early stopping stops a run.',
      },
      { id: 'diverged', label: 'Diverged', description: 'The runs of a sweep that diverged.' },
      {
        id: 'did_it_help',
        label: 'Did it help',
        description: 'A paired comparison of two configs over seeds.',
      },
      { id: 'next_runs', label: 'Next runs', description: 'Propose the next round of runs.' },
      { id: 'sweep_report', label: 'Sweep report', description: 'Write up a sweep.' },
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
    // The three taught groups' 144 tasks: 12 + 60 + 36 + 36. The unseen group's are test-only.
    splits: { seed: 20261103, calibration: 12, train: 60, dev: 36, test: 36 },
    evaluation: { trainBatch: 12, minDevGain: 2, maxTypeRegression: 1, patience: 4 },
    organizations,
    organizationNoun: 'group',
  });
}
