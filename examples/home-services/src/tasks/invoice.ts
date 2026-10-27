import type { Task } from '@architect/shared';
import { findOne } from '../company/lookup';
import type { CompanyRecords, Customer, Job, Technician } from '../company/types';
import { addDays, longDate } from '../lib/calendar';
import { compareText } from '../lib/compare';
import { dollars, roundHalfUp, sum } from '../lib/money';
import type { Random } from '../lib/random';
import { BUSINESS_DATE, MINIMUM_BILLED_MINUTES, PLAN_DISCOUNT_PCT } from '../policy/rules';
import { billedMinutes, nextInvoiceId, partLines, priceJob } from '../reference/pricing';
import type { InvoiceAmounts, PartLine } from '../reference/pricing';
import { TODAY, withAnswerLine } from './prompts';
import { difficultyOf, pickMix, taskId } from './select';
import type { Candidate, Quota } from './select';

const QUOTA: Quota = { easy: 24, medium: 22, hard: 14 };

const ANSWER_SHAPE = '{"invoice_id": "<id>", "total_cents": <integer>}';

interface InvoiceCase {
  job: Job;
  customer: Customer;
  technician: Technician;
  amounts: InvoiceAmounts;
}

const PROMPTS: readonly ((c: InvoiceCase) => string)[] = [
  (c) => `Today is ${TODAY}. Job ${c.job.job_id} is finished. Create its invoice in invoices.csv.`,
  (c) =>
    `It's ${TODAY}. ${firstName(c.technician)} finished job ${c.job.job_id} for ${c.customer.name}. ` +
    'Please bill it by adding the invoice to invoices.csv.',
  (c) =>
    `Today is ${TODAY}. Please invoice work order ${c.job.job_id} following the pricing policy, ` +
    'and record it in invoices.csv.',
  (c) =>
    `Today is ${TODAY}. Job ${c.job.job_id} (finished ${longDate(c.job.date)}) hasn't been ` +
    'billed yet. Add its invoice to invoices.csv.',
  (c) =>
    `It's ${TODAY}. ${c.customer.name} asked for the bill for job ${c.job.job_id}. ` +
    'Create the invoice row in invoices.csv.',
];

/** One task per picked job that hasn't been invoiced yet. */
export function buildInvoiceTasks(random: Random, records: CompanyRecords): Task[] {
  const billed = new Set(records.invoices.map((invoice) => invoice.job_id));
  const candidates = records.jobs
    .filter((job) => !billed.has(job.job_id))
    .map((job) => candidateFor(records, job));
  const picked = pickMix(random, candidates, QUOTA, 'invoice').sort((a, b) =>
    compareText(a.value.job.job_id, b.value.job.job_id),
  );
  const invoice_id = nextInvoiceId(records.invoices);

  return picked.map(({ value: c, traps }, index) => ({
    id: taskId('invoice', index),
    type: 'invoice',
    family: `job:${c.job.job_id}`,
    prompt: withAnswerLine(random.pick(PROMPTS)(c), ANSWER_SHAPE),
    expected: {
      kind: 'end_state',
      validator: 'invoice_created',
      params: {
        job_id: c.job.job_id,
        customer_id: c.customer.customer_id,
        issue_date: BUSINESS_DATE,
        due_date: addDays(BUSINESS_DATE, c.customer.terms_days),
        ...c.amounts,
      },
    },
    meta: {
      summary: `${invoice_id}, total ${dollars(c.amounts.total_cents)}`,
      invoice_id,
      difficulty: difficultyOf(traps),
      traps,
    },
  }));
}

function candidateFor(records: CompanyRecords, job: Job): Candidate<InvoiceCase> {
  const customer = findOne(
    records.customers,
    (c) => c.customer_id === job.customer_id,
    job.customer_id,
  );
  const technician = findOne(
    records.technicians,
    (t) => t.technician_id === job.technician_id,
    job.technician_id,
  );
  const amounts = priceJob(records, job);
  const traps = invoiceTraps(records, job, customer, amounts);
  return {
    value: { job, customer, technician, amounts },
    traps,
    kind: traps.join('+') || technician.skills.join('+'),
  };
}

/** Which pricing rules this job exercises beyond the plain path. */
function invoiceTraps(
  records: CompanyRecords,
  job: Job,
  customer: Customer,
  amounts: InvoiceAmounts,
): string[] {
  const lines = partLines(records, job);
  const taxRate = findOne(records.taxRates, (t) => t.city === customer.city, customer.city);
  const taxable = sum(lines.filter((line) => line.part.taxable).map((line) => line.amount_cents));
  const traps: string[] = [];
  if (job.labor_minutes < MINIMUM_BILLED_MINUTES) traps.push('one_hour_minimum');
  if (job.after_hours) traps.push('after_hours');
  if (customer.plan_member) traps.push('plan_discount');
  if (lines.some((line) => !line.part.taxable)) traps.push('untaxed_part');
  if (lines.length >= 3) traps.push('many_parts');
  if (perUnitRoundingDiffers(lines)) traps.push('per_line_rounding');
  const halves = [
    exactHalf(laborNumerator(records, job), 60 * (job.after_hours ? 2 : 1)),
    ...lines.map((line) =>
      exactHalf(line.qty * line.part.unit_cost_cents * (100 + line.part.markup_pct), 100),
    ),
    customer.plan_member && exactHalf(amounts.labor_cents * PLAN_DISCOUNT_PCT, 100),
    exactHalf(taxable * taxRate.rate_bp, 10_000),
  ];
  if (halves.some(Boolean)) traps.push('half_cent');
  return traps;
}

/** Rounding each unit price before multiplying by qty gives a different parts total. */
function perUnitRoundingDiffers(lines: readonly PartLine[]): boolean {
  const perUnit = sum(
    lines.map(
      (line) =>
        line.qty * roundHalfUp(line.part.unit_cost_cents * (100 + line.part.markup_pct), 100),
    ),
  );
  return perUnit !== sum(lines.map((line) => line.amount_cents));
}

function laborNumerator(records: CompanyRecords, job: Job): number {
  const technician = findOne(
    records.technicians,
    (t) => t.technician_id === job.technician_id,
    job.technician_id,
  );
  const rate = findOne(records.rates, (r) => r.tier === technician.tier, technician.tier);
  return billedMinutes(job.labor_minutes) * rate.hourly_rate_cents * (job.after_hours ? 3 : 1);
}

/** The exact value numerator / denominator ends in exactly half a cent. */
function exactHalf(numerator: number, denominator: number): boolean {
  return (numerator % denominator) * 2 === denominator;
}

function firstName(technician: Technician): string {
  return technician.name.split(' ')[0] ?? technician.name;
}
