import { DEFAULT_STUDENT, JOB_FORMAT, JobSchema, mentorPreset } from '@architect/shared';
import type { DataFile, Job, Organization } from '@architect/shared';

/**
 * The job's date, the one the agent's header gives. Each lab has a date of its own, the Assay
 * desk's, which its requests state, and none is this one.
 */
export const TODAY = '2026-11-16';

const DATA_FILES: readonly DataFile[] = [
  {
    name: 'policy.md',
    kind: 'text',
    access: 'read',
    description:
      "The lab's rules for drawing compound stock for a re-test, in its own words: its unit and date form, the stock a re-test takes, how long a lot must have before it expires, which lot to draw from first, whether lots are combined, the most reservations per compound, and its reason codes.",
  },
  {
    name: 'inventory.csv',
    kind: 'table',
    access: 'read',
    description:
      'Every lot of every compound the lab holds: compound_id, lot, location, quantity (what is left, with its unit), conc_mm, received and expires.',
  },
  {
    name: 'reservations.csv',
    kind: 'table',
    access: 'write',
    description:
      'Stock held for work not yet run, one row per lot held: reservation_id, compound_id, lot, amount, reserved_on. New reservations go here.',
  },
];

/**
 * The inventory desk job: one specialist for every lab's compound store. Each organization's
 * files sit in orgs/<id>/data/ with the same names; a task names its organization. Tasks of the
 * labs it is taught on split as usual; the transfer lab is test-only.
 */
export function buildJob(organizations: readonly Organization[]): Job {
  const mentor = mentorPreset('meta-spark');
  return JobSchema.parse({
    format: JOB_FORMAT,
    id: 'sample-inventory-desk',
    name: 'Inventory desk',
    description:
      "The Inventory desk runs a screening lab's compound store. It works only from the lab's own " +
      'files: its inventory of lots, the reservations already held and the lab’s policy. It says ' +
      'how much of a compound is usable, which lot a re-test should come from, allocates stock for ' +
      'a list of compounds sent for a re-test, reporting any with nothing to draw and why, and ' +
      'reserves the stock. It only writes to reservations.csv.',
    summary: "Draws a screening lab's compound stock for re-tests by the lab's own rules.",
    does: [
      'Says how much of a compound is usable',
      'Picks the lot a re-test comes from',
      'Allocates stock for a re-test list, and says why a compound has none',
      'Reserves the stock the policy calls for',
    ],
    doesNot: [
      'Never draws from a lot out of date',
      'Never changes past reservations',
      'Asks before it adds a reservation',
    ],
    createdAt: '2026-10-31T00:00:00.000Z',
    businessDate: TODAY,
    taskTypes: [
      {
        id: 'usable',
        label: 'Usable stock',
        description: 'How much of a compound is usable, and in which lots.',
      },
      {
        id: 'pick_lot',
        label: 'Pick a lot',
        description: 'Which lot one re-test of a compound comes from, or why none.',
      },
      {
        id: 'allocate',
        label: 'Allocate',
        description: 'Stock for a list of compounds sent for a re-test.',
      },
      { id: 'reserve', label: 'Reserve', description: 'Hold the stock for a re-test list.' },
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
    // The three taught labs' 96 tasks. The transfer lab's 32 are test-only.
    splits: { seed: 20261101, calibration: 8, train: 40, dev: 24, test: 24 },
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
