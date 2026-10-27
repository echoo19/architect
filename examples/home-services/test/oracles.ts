import type { CsvRow } from '../src/lib/csv';
import { BUSINESS_DATE, rowWhere, rowsWhere, table } from './helpers';

/**
 * Second implementations of the policy, written from policy.md without looking at the generator's
 * reference code, and working on the CSV text the agent sees. Tests compare them with the ground
 * truth on every task, so a mistake has to be made twice, in two different ways, to slip through.
 */

/** n / d to the nearest integer, halves up, by comparing the remainder with half the divisor. */
export function nearestHalfUp(n: number, d: number): number {
  const whole = Math.floor(n / d);
  const remainder = n - whole * d;
  return remainder * 2 >= d ? whole + 1 : whole;
}

const TRIP_FEE: Record<string, number> = {
  Harbor: 3900,
  'Old Town': 3900,
  Millbrook: 5500,
  Ridge: 5500,
  Lakeside: 6900,
};

export interface PricedJob {
  labor_cents: number;
  parts_cents: number;
  fees_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
}

export function priceFromCsv(jobId: string): PricedJob {
  const job = rowWhere('jobs.csv', 'job_id', jobId);
  const customer = rowWhere('customers.csv', 'customer_id', String(job.customer_id));
  const technician = rowWhere('technicians.csv', 'technician_id', String(job.technician_id));
  const hourly = Number(rowWhere('rates.csv', 'tier', String(technician.tier)).hourly_rate_cents);

  // Quarter hours, rounded up, at least four of them; a quarter costs a quarter of the rate.
  const quarters = Math.max(4, Math.ceil(Number(job.labor_minutes) / 15));
  const labor =
    job.after_hours === 'yes'
      ? nearestHalfUp(quarters * hourly * 3, 4 * 2)
      : nearestHalfUp(quarters * hourly, 4);

  let parts = 0;
  let taxable = 0;
  for (const line of rowsWhere('job_parts.csv', 'job_id', jobId)) {
    const part = rowWhere('parts.csv', 'part_id', String(line.part_id));
    const amount = nearestHalfUp(
      Number(line.qty) * Number(part.unit_cost_cents) * (100 + Number(part.markup_pct)),
      100,
    );
    parts += amount;
    if (part.taxable === 'yes') taxable += amount;
  }

  const fees = TRIP_FEE[String(customer.zone)];
  if (fees === undefined) throw new Error(`No trip fee for ${customer.zone}`);
  const discount = customer.plan_member === 'yes' ? nearestHalfUp(labor, 10) : 0;
  const rate = Number(rowWhere('tax.csv', 'city', String(customer.city)).rate_bp);
  const tax = nearestHalfUp(taxable * rate, 10_000);
  return {
    labor_cents: labor,
    parts_cents: parts,
    fees_cents: fees,
    discount_cents: discount,
    tax_cents: tax,
    total_cents: labor + parts + fees - discount + tax,
  };
}

/** Received money only: payments dated after the business date haven't arrived. */
export function openBalance(invoice: CsvRow): number {
  let paid = 0;
  for (const payment of rowsWhere('payments.csv', 'invoice_id', String(invoice.invoice_id))) {
    if (String(payment.date) <= BUSINESS_DATE) paid += Number(payment.amount_cents);
  }
  return Number(invoice.total_cents) - paid;
}

export function isOverdueToday(invoice: CsvRow): boolean {
  return String(invoice.due_date) < BUSINESS_DATE && openBalance(invoice) > 0;
}

export function overdueOf(customerId: string): CsvRow[] {
  return rowsWhere('invoices.csv', 'customer_id', customerId).filter(isOverdueToday);
}

/** Whole days between two YYYY-MM-DD dates in 2000 to 2099, counted from month lengths. */
export function daysFromTo(from: string, to: string): number {
  const ordinal = (date: string) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const monthLengths = [31, y % 4 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let days = (y - 2000) * 365 + Math.floor((y - 1997) / 4);
    for (let month = 1; month < m; month++) days += monthLengths[month - 1] as number;
    return days + d;
  };
  return ordinal(to) - ordinal(from);
}

export function invoicesDueBetween(from: string, to: string): CsvRow[] {
  return table('invoices.csv').filter(
    (invoice) => String(invoice.due_date) >= from && String(invoice.due_date) <= to,
  );
}
