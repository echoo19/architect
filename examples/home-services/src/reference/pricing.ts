import { findOne } from '../company/lookup';
import type { Company, Job, Part } from '../company/types';
import { roundHalfUp, sum } from '../lib/money';
import {
  AFTER_HOURS_FACTOR,
  BILLING_STEP_MINUTES,
  MINIMUM_BILLED_MINUTES,
  PLAN_DISCOUNT_PCT,
  TRIP_FEE_CENTS,
} from '../policy/rules';

/**
 * Ground truth for invoices, written straight from the "Invoices" section of policy.md. Every
 * amount is an integer number of cents, and every rounding is half up through `roundHalfUp`.
 */

export type PricingRecords = Pick<
  Company,
  'customers' | 'technicians' | 'rates' | 'parts' | 'jobParts' | 'taxRates'
>;

export interface InvoiceAmounts {
  labor_cents: number;
  parts_cents: number;
  fees_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
}

export interface PartLine {
  part: Part;
  qty: number;
  amount_cents: number;
}

/** Labor minutes rounded up to the next quarter hour, and never less than one hour. */
export function billedMinutes(laborMinutes: number): number {
  const quarters = Math.ceil(laborMinutes / BILLING_STEP_MINUTES);
  return Math.max(MINIMUM_BILLED_MINUTES, quarters * BILLING_STEP_MINUTES);
}

/** Billed hours × hourly rate, × 1.5 after hours, rounded half up once at the end. */
export function laborCents(job: Job, hourlyRateCents: number): number {
  const factor = job.after_hours ? AFTER_HOURS_FACTOR : { numerator: 1, denominator: 1 };
  return roundHalfUp(
    billedMinutes(job.labor_minutes) * hourlyRateCents * factor.numerator,
    60 * factor.denominator,
  );
}

/** One parts line: qty × unit cost × (100 + markup %) / 100, rounded half up on its own. */
export function partLineCents(qty: number, part: Part): number {
  return roundHalfUp(qty * part.unit_cost_cents * (100 + part.markup_pct), 100);
}

export function partLines(records: PricingRecords, job: Job): PartLine[] {
  return records.jobParts
    .filter((line) => line.job_id === job.job_id)
    .map((line) => {
      const part = findOne(records.parts, (p) => p.part_id === line.part_id, line.part_id);
      return { part, qty: line.qty, amount_cents: partLineCents(line.qty, part) };
    });
}

export function priceJob(records: PricingRecords, job: Job): InvoiceAmounts {
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
  const rate = findOne(records.rates, (r) => r.tier === technician.tier, technician.tier);
  const taxRate = findOne(records.taxRates, (t) => t.city === customer.city, customer.city);
  const lines = partLines(records, job);

  const labor_cents = laborCents(job, rate.hourly_rate_cents);
  const parts_cents = sum(lines.map((line) => line.amount_cents));
  const fees_cents = TRIP_FEE_CENTS[customer.zone];
  const discount_cents = customer.plan_member
    ? roundHalfUp(labor_cents * PLAN_DISCOUNT_PCT, 100)
    : 0;
  const taxable_cents = sum(
    lines.filter((line) => line.part.taxable).map((line) => line.amount_cents),
  );
  const tax_cents = roundHalfUp(taxable_cents * taxRate.rate_bp, 10_000);
  const total_cents = labor_cents + parts_cents + fees_cents - discount_cents + tax_cents;

  return { labor_cents, parts_cents, fees_cents, discount_cents, tax_cents, total_cents };
}
