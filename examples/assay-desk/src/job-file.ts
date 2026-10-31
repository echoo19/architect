import { DEFAULT_STUDENT, JOB_FORMAT, JobSchema, mentorPreset } from '@architect/shared';
import type { DataFile, Job, Organization } from '@architect/shared';
import { EXPORTS } from './lab/files';
import { INSTRUMENTS } from './lab/style';

/**
 * The job's date, the one the agent's header gives. Each lab has a date of its own, which its
 * requests state, and none is this one.
 */
export const TODAY = '2026-11-16';

const EXPORT_FILES: DataFile[] = INSTRUMENTS.map((instrument) => {
  const { file, name, columns } = EXPORTS[instrument];
  return {
    name: file,
    kind: 'table',
    access: 'read',
    optional: true,
    description: `The ${name} plate reader's export: ${columns.join(', ')}, one row per well, for every plate read on it. A lab without the instrument has no such file.`,
  };
});

const DATA_FILES: readonly DataFile[] = [
  {
    name: 'policy.md',
    kind: 'text',
    access: 'read',
    description:
      "The lab's rules for reading a plate, in its own words: its controls, percent inhibition, the Z′ a plate needs to pass, the hit rule, replicates, borderline compounds and how to queue re-tests, with the lab's numbers and reason codes.",
  },
  {
    name: 'plates.csv',
    kind: 'table',
    access: 'read',
    description:
      'Every plate the lab read: plate_id, layout (96 or 384 wells), instrument, read_on, and export_file, the export that holds its wells.',
  },
  {
    name: 'compounds.csv',
    kind: 'table',
    access: 'read',
    description:
      "The well map: for each well of each plate, the compound in it, or the policy's code for a control well, and its concentration in µM.",
  },
  ...EXPORT_FILES,
  {
    name: 'retests.csv',
    kind: 'table',
    access: 'write',
    description:
      'The re-test queue: whole plates and single compounds to run again. New requests go here.',
  },
];

/**
 * The assay desk job: one specialist for every lab. Each organization's files sit in
 * orgs/<id>/data/ with the same names; a task names its organization. Tasks of the labs it is
 * taught on split as usual; the transfer lab is test-only.
 */
export function buildJob(organizations: readonly Organization[]): Job {
  const mentor = mentorPreset('meta-spark');
  return JobSchema.parse({
    format: JOB_FORMAT,
    id: 'sample-assay-desk',
    name: 'Assay desk',
    description:
      'The Assay desk helps a screening lab read its plate-reader exports. It works only from the ' +
      "lab's own files: its plates, each instrument's export, the well map and the lab's policy. " +
      "It normalizes wells to percent inhibition against the plate's own controls, works out a " +
      "plate's Z′ and whether it passes, calls hits by the lab's rule, judges replicates, and " +
      'queues re-tests for failed plates and borderline or inconclusive compounds. It only writes ' +
      'to retests.csv.',
    summary: "Reads a screening lab's plate exports by the lab's own rules.",
    does: [
      'Normalizes wells to percent inhibition against the plate’s controls',
      'Works out Z′ and passes or fails a plate',
      "Calls hits and judges replicates by the lab's rule",
      'Queues re-tests the policy calls for',
    ],
    doesNot: [
      'Never calls hits on a plate that fails QC',
      'Never changes past re-test requests',
      'Asks before it adds to the re-test queue',
    ],
    createdAt: '2026-10-30T00:00:00.000Z',
    businessDate: TODAY,
    taskTypes: [
      {
        id: 'normalize',
        label: 'Normalize',
        description: 'Percent inhibition of named wells, against the plate’s own controls.',
      },
      { id: 'hits', label: 'Hits', description: "A plate's hits by the lab's rule." },
      { id: 'qc', label: 'Plate QC', description: "A plate's Z′, and whether it passes." },
      {
        id: 'replicates',
        label: 'Replicates',
        description: "Whether a compound's wells agree, and its call.",
      },
      {
        id: 'retest_plan',
        label: 'Re-test plan',
        description: 'Queue the re-tests the policy calls for.',
      },
      {
        id: 'plate_report',
        label: 'Plate report',
        description: 'The whole read of a plate: QC, hits and re-tests.',
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
    // The three taught labs' 144 tasks. The transfer lab's 48 are test-only.
    splits: { seed: 20261031, calibration: 12, train: 60, dev: 36, test: 36 },
    evaluation: {
      trainBatch: 12,
      minDevGain: 2,
      maxTypeRegression: 1,
      patience: 4,
    },
    organizations,
    organizationNoun: 'lab',
  });
}
