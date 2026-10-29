import { DEFAULT_STUDENT, JOB_FORMAT, JobSchema, mentorPreset } from '@architect/shared';
import type { DataFile, Job } from '@architect/shared';
import { BUSINESS_DATE, SHOP_NAME } from './policy/rules';

const DATA_FILES: readonly DataFile[] = [
  {
    name: 'policy.md',
    kind: 'text',
    access: 'read',
    description: 'Desk rules: returns and refunds, order questions and carrier pickups.',
  },
  {
    name: 'customers.csv',
    kind: 'table',
    access: 'read',
    description:
      "One row per customer: name, email, region (sets the pickup carrier) and member_since, the day they joined the members' program (empty for non-members).",
  },
  {
    name: 'products.csv',
    kind: 'table',
    access: 'read',
    description:
      'The catalog: SKU, name, category, list price, whether it is final sale, and whether it is bulky.',
  },
  {
    name: 'category_map.csv',
    kind: 'table',
    access: 'read',
    description:
      "Category codes from the shop's first till, still on a few products, and the category each one stands for.",
  },
  {
    name: 'orders.csv',
    kind: 'table',
    access: 'read',
    description:
      'Web orders: customer, order date, the days it shipped and was delivered (empty until then), the shipping charged, and how it was paid.',
  },
  {
    name: 'order_lines.csv',
    kind: 'table',
    access: 'read',
    description: 'The products on each order: SKU, quantity and the unit price paid.',
  },
  {
    name: 'returns.csv',
    kind: 'table',
    access: 'write',
    description:
      'Every return decided so far, approved or denied, with its amounts in cents and, for a return sent back by carrier, the first day the customer can hand it over. New returns go here.',
  },
  {
    name: 'pickups.csv',
    kind: 'table',
    access: 'write',
    description: 'Carrier pickups booked for returns, past and coming. New pickups go here.',
  },
];

/**
 * The sample job's settings: the first job's bar, budget and evaluation, and the shared presets.
 * Its tasks split by the generator's seed, so another seed's business gets splits of its own.
 */
export function buildJob(splitSeed: number): Job {
  const mentor = mentorPreset('meta-spark');
  return JobSchema.parse({
    format: JOB_FORMAT,
    id: 'sample-gear-returns',
    name: 'Returns desk',
    description:
      `Returns desk works the returns counter at ${SHOP_NAME}, a small outdoor-gear shop that sells ` +
      'online across four regions. It decides return requests and works out each refund, answers ' +
      'questions about orders and customers, and books carrier pickups for approved returns. It ' +
      'works from the shop records (customers, products, old category codes, orders, order lines, ' +
      'returns and pickups, all CSV files exported from the shop systems over the years) and follows ' +
      'the rules in policy.md. It only writes to returns.csv and pickups.csv.',
    summary: 'Decides returns and refunds, answers order questions and books return pickups.',
    does: [
      'Decides return requests and works out the refund',
      'Answers questions about orders and customers',
      'Books the earliest carrier pickup for a return',
      'Follows the refund and pickup rules in the policy',
    ],
    doesNot: [
      'Never changes past returns or pickups',
      `Stays inside the ${SHOP_NAME} records`,
      'Asks before it saves a return or a pickup',
    ],
    createdAt: '2026-10-27T00:00:00.000Z',
    businessDate: BUSINESS_DATE,
    taskTypes: [
      { id: 'refund', label: 'Refunds', description: 'Decide a return request and record it.' },
      {
        id: 'order',
        label: 'Order questions',
        description: 'Answer a question about orders or customers from the records.',
      },
      {
        id: 'pickup',
        label: 'Pickups',
        description: 'Book the earliest carrier pickup for an approved return.',
      },
    ],
    data: { files: DATA_FILES },
    permissions: { writes: 'ask', unseenFiles: 'never' },
    checker: { kind: 'module', path: 'checker.js' },
    // Refunds and pickups write to a shop's records: one error in twenty is the most a shop would
    // accept from an assistant, the same bar as the first sample job.
    requirements: { passRate: 0.95 },
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
    splits: { seed: splitSeed, calibration: 15, train: 60, dev: 45, test: 60 },
    // The first job's keep rule and patience (decision 022).
    evaluation: { trainBatch: 12, minDevGain: 2, maxTypeRegression: 1, patience: 4 },
  });
}
