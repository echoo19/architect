import type { Invoice, Payment } from '../company/types';
import { addDays, daysBetween } from '../lib/calendar';
import { compareText } from '../lib/compare';
import { sum } from '../lib/money';

/**
 * Ground truth for overdue balances, written straight from the "Overdue balances" section of
 * policy.md. Dates are ISO strings, so comparing them as strings compares them as dates.
 */

/** The parts of an invoice the overdue rules look at. */
export type InvoiceDue = Pick<Invoice, 'invoice_id' | 'customer_id' | 'due_date' | 'total_cents'>;

/** The parts of a payment the overdue rules look at. */
export type PaymentMade = Pick<Payment, 'invoice_id' | 'date' | 'amount_cents'>;

export interface OverdueInvoice {
  invoice_id: string;
  due_date: string;
  balance_cents: number;
  days_overdue: number;
}

export interface CustomerBalance {
  customer_id: string;
  overdue_cents: number;
}

/** Payments for the invoice dated on or before `asOf`. Later ones are scheduled, not received. */
export function receivedCents(
  invoice: InvoiceDue,
  payments: readonly PaymentMade[],
  asOf: string,
): number {
  return sum(
    payments
      .filter((payment) => payment.invoice_id === invoice.invoice_id && payment.date <= asOf)
      .map((payment) => payment.amount_cents),
  );
}

export function balanceCents(
  invoice: InvoiceDue,
  payments: readonly PaymentMade[],
  asOf: string,
): number {
  return invoice.total_cents - receivedCents(invoice, payments, asOf);
}

/** Due before `asOf` and not fully paid by then. An invoice due on `asOf` is not overdue yet. */
export function isOverdue(
  invoice: InvoiceDue,
  payments: readonly PaymentMade[],
  asOf: string,
): boolean {
  return invoice.due_date < asOf && balanceCents(invoice, payments, asOf) > 0;
}

/** The overdue invoices among `invoices`, oldest due date first (ties by invoice id). */
export function overdueInvoices(
  invoices: readonly InvoiceDue[],
  payments: readonly PaymentMade[],
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

/**
 * Every customer with an overdue balance and what it comes to, largest first (ties by customer
 * id). Customers with nothing overdue are left out.
 */
export function overdueBalances(
  invoices: readonly InvoiceDue[],
  payments: readonly PaymentMade[],
  asOf: string,
): CustomerBalance[] {
  const owed = new Map<string, number>();
  for (const invoice of invoices) {
    if (!isOverdue(invoice, payments, asOf)) continue;
    const balance = balanceCents(invoice, payments, asOf);
    owed.set(invoice.customer_id, (owed.get(invoice.customer_id) ?? 0) + balance);
  }
  return [...owed]
    .map(([customer_id, overdue_cents]) => ({ customer_id, overdue_cents }))
    .sort((a, b) => b.overdue_cents - a.overdue_cents || compareText(a.customer_id, b.customer_id));
}

/**
 * The customers with at least one invoice more than `days` days overdue, by customer id. An
 * invoice exactly `days` days overdue doesn't count.
 */
export function customersOverdueMoreThan(
  invoices: readonly InvoiceDue[],
  payments: readonly PaymentMade[],
  asOf: string,
  days: number,
): string[] {
  const dueBefore = addDays(asOf, -days);
  const late = invoices.filter(
    (invoice) => invoice.due_date < dueBefore && isOverdue(invoice, payments, asOf),
  );
  return [...new Set(late.map((invoice) => invoice.customer_id))].sort(compareText);
}
