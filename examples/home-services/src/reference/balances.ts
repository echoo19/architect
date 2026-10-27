import type { Invoice, Payment } from '../company/types';
import { daysBetween } from '../lib/calendar';
import { compareText } from '../lib/compare';
import { sum } from '../lib/money';

/**
 * Ground truth for overdue balances, written straight from the "Overdue balances" section of
 * policy.md. Dates are ISO strings, so comparing them as strings compares them as dates.
 */

export interface OverdueInvoice {
  invoice_id: string;
  due_date: string;
  balance_cents: number;
  days_overdue: number;
}

/** Payments for the invoice dated on or before `asOf`. Later ones are scheduled, not received. */
export function receivedCents(
  invoice: Invoice,
  payments: readonly Payment[],
  asOf: string,
): number {
  return sum(
    payments
      .filter((payment) => payment.invoice_id === invoice.invoice_id && payment.date <= asOf)
      .map((payment) => payment.amount_cents),
  );
}

export function balanceCents(invoice: Invoice, payments: readonly Payment[], asOf: string): number {
  return invoice.total_cents - receivedCents(invoice, payments, asOf);
}

/** Due before `asOf` and not fully paid by then. An invoice due on `asOf` is not overdue yet. */
export function isOverdue(invoice: Invoice, payments: readonly Payment[], asOf: string): boolean {
  return invoice.due_date < asOf && balanceCents(invoice, payments, asOf) > 0;
}

/** The overdue invoices among `invoices`, oldest due date first (ties by invoice id). */
export function overdueInvoices(
  invoices: readonly Invoice[],
  payments: readonly Payment[],
  asOf: string,
): OverdueInvoice[] {
  return invoices
    .filter((invoice) => isOverdue(invoice, payments, asOf))
    .map((invoice) => ({
      invoice_id: invoice.invoice_id,
      due_date: invoice.due_date,
      balance_cents: balanceCents(invoice, payments, asOf),
      days_overdue: daysBetween(invoice.due_date, asOf),
    }))
    .sort((a, b) => compareText(a.due_date, b.due_date) || compareText(a.invoice_id, b.invoice_id));
}
