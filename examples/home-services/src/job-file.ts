import { DEFAULT_STUDENT, JOB_FORMAT, JobSchema, mentorPreset } from '@architect/shared';
import type { DataFile, Job } from '@architect/shared';
import { BUSINESS_DATE } from './policy/rules';
import type { JobVersion } from './versions';

/** Each version is its own job, so both can sit side by side in the app. */
const IDENTITY: Readonly<Record<JobVersion, Pick<Job, 'id' | 'name'>>> = {
  1: { id: 'sample-home-services-v1', name: 'Service desk (first version)' },
  2: { id: 'sample-home-services', name: 'Service desk' },
};

const DATA_FILES: readonly DataFile[] = [
  {
    name: 'policy.md',
    kind: 'text',
    access: 'read',
    description:
      'Office rules: pricing, tax, rounding, invoice numbering, payment terms, overdue balances and scheduling.',
  },
  {
    name: 'customers.csv',
    kind: 'table',
    access: 'read',
    description:
      'One row per customer: name, city (sets the tax rate), zone (sets the trip fee and travel), plan_member and terms_days.',
  },
  {
    name: 'technicians.csv',
    kind: 'table',
    access: 'read',
    description:
      'The twelve technicians: tier, skills, licenses, work_days, and daily start_time and end_time.',
  },
  {
    name: 'rates.csv',
    kind: 'table',
    access: 'read',
    description: 'Hourly labor rate in cents for each technician tier.',
  },
  {
    name: 'parts.csv',
    kind: 'table',
    access: 'read',
    description:
      'Parts and pass-through fees: unit cost in cents, markup percent, and whether taxable.',
  },
  {
    name: 'jobs.csv',
    kind: 'table',
    access: 'read',
    description:
      'Finished jobs: customer, technician, date, the work done, minutes on site, and whether it was after hours.',
  },
  {
    name: 'job_parts.csv',
    kind: 'table',
    access: 'read',
    description: 'The parts used on each job, with quantities.',
  },
  {
    name: 'invoices.csv',
    kind: 'table',
    access: 'write',
    description: 'Every invoice issued so far, amounts in cents. New invoices go here.',
  },
  {
    name: 'payments.csv',
    kind: 'table',
    access: 'read',
    description: 'Payments against invoices, in cents. Some are dated after the business date.',
  },
  {
    name: 'requests.csv',
    kind: 'table',
    access: 'read',
    description:
      'Open service requests waiting for a booking: skill, license needed, duration, earliest date.',
  },
  {
    name: 'bookings.csv',
    kind: 'table',
    access: 'write',
    description: 'Technician bookings from the business date on. New bookings go here.',
  },
  {
    name: 'travel.csv',
    kind: 'table',
    access: 'read',
    description: 'Driving minutes between service zones, including within the same zone.',
  },
  {
    name: 'tax.csv',
    kind: 'table',
    access: 'read',
    description: 'Sales tax rate for each city, in basis points (825 means 8.25%).',
  },
];

/** The sample job's settings. Model choices come from the shared presets. */
export function buildJob(version: JobVersion): Job {
  const mentor = mentorPreset('meta-spark');
  return JobSchema.parse({
    format: JOB_FORMAT,
    ...IDENTITY[version],
    description:
      'Service desk handles the end-of-day office work at Ferncliff Home Services, a plumbing, ' +
      'heating and electrical company with twelve technicians and about 400 customers. It prices ' +
      'finished jobs into invoices, works out overdue balances after partial payments, and books ' +
      'new service requests into the earliest open technician slot. It works from the company ' +
      'records (customers, technicians, rates, parts, jobs, invoices, payments, bookings, open ' +
      'requests, travel times and city tax rates, all CSV files) and follows the rules in ' +
      'policy.md. It only writes to invoices.csv and bookings.csv.',
    summary:
      'Bills finished jobs, chases overdue balances and books technicians from the office records.',
    does: [
      'Prices finished jobs into invoices',
      'Works out overdue balances after partial payments',
      'Books the earliest slot a qualified technician has',
      'Follows the rounding and tax rules in the policy',
    ],
    doesNot: [
      'Never changes past invoices or payments',
      'Stays inside the Ferncliff records',
      'Asks before it saves an invoice or a booking',
    ],
    createdAt: '2026-10-27T00:00:00.000Z',
    businessDate: BUSINESS_DATE,
    taskTypes: [
      {
        id: 'invoice',
        label: 'Invoices',
        description: 'Price a finished job and add its invoice.',
      },
      {
        id: 'overdue',
        label: 'Overdue balances',
        description: 'Find overdue invoices and balances after partial payments.',
      },
      {
        id: 'schedule',
        label: 'Scheduling',
        description: 'Book a service request into the earliest feasible slot.',
      },
    ],
    data: { files: DATA_FILES },
    permissions: { writes: 'ask', unseenFiles: 'never' },
    checker: { kind: 'module', path: 'checker.js' },
    requirements: { passRate: 0.85 },
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
    splits: { seed: 20261027, calibration: 15, train: 60, dev: 45, test: 60 },
    evaluation: { trainBatch: 12, minDevGain: 2, maxTypeRegression: 1, patience: 3 },
  });
}
