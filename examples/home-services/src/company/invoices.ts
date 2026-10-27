import { addDays } from '../lib/calendar';
import { compareText } from '../lib/compare';
import type { Random } from '../lib/random';
import { BUSINESS_DATE, invoiceIdFor } from '../policy/rules';
import { priceJob } from '../reference/pricing';
import type { PricingRecords } from '../reference/pricing';
import { findOne } from './lookup';
import type { Invoice, Job } from './types';

/** Jobs finished from this date on are mostly still waiting for their invoice. */
const BILLING_BACKLOG_START = '2026-10-19';

/**
 * Invoices for every job billed so far, priced by the same reference rules the tasks use, each
 * numbered after its job and listed in the order they were issued. Customers who pay on receipt
 * get their invoice at the door; everyone else's waits for the office, which has fallen behind
 * since BILLING_BACKLOG_START.
 */
export function buildInvoices(
  random: Random,
  records: PricingRecords,
  jobs: readonly Job[],
): Invoice[] {
  const billed: { job: Job; terms_days: number; issue_date: string }[] = [];
  for (const job of jobs) {
    const { terms_days } = findOne(
      records.customers,
      (c) => c.customer_id === job.customer_id,
      job.customer_id,
    );
    if (terms_days === 0) {
      billed.push({ job, terms_days, issue_date: job.date });
      continue;
    }
    if (job.date >= BILLING_BACKLOG_START && !random.chance(0.15)) continue;
    const delay = random.weighted([
      [0, 5],
      [1, 3],
      [2, 1.5],
      [3, 0.5],
    ]);
    const issued = addDays(job.date, delay);
    billed.push({ job, terms_days, issue_date: issued < BUSINESS_DATE ? issued : BUSINESS_DATE });
  }
  billed.sort(
    (a, b) => compareText(a.issue_date, b.issue_date) || compareText(a.job.job_id, b.job.job_id),
  );

  return billed.map(({ job, terms_days, issue_date }) => ({
    invoice_id: invoiceIdFor(job.job_id),
    job_id: job.job_id,
    customer_id: job.customer_id,
    issue_date,
    due_date: addDays(issue_date, terms_days),
    ...priceJob(records, job),
  }));
}
