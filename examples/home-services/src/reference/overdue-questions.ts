import type { JsonValue } from '@architect/shared';
import { compareText } from '../lib/compare';
import { sum } from '../lib/money';
import { customersOverdueMoreThan, overdueBalances, overdueInvoices } from './balances';
import type { CustomerBalance, InvoiceDue, PaymentMade } from './balances';

/**
 * Every question the overdue tasks ask, and its answer from the "Overdue balances" section of
 * policy.md. The answer takes the invoices the question covers, so the same rules answer it from
 * the full records (when the tasks are made) or from what an agent read (in the reference
 * solutions that count tool calls).
 */

/** customers.csv columns and the value each must hold, e.g. `{ zone: 'Ridge', terms_days: '15' }`. */
export type GroupColumns = Readonly<Record<string, string>>;

export type OverdueQuestion =
  | { kind: 'customer_balance'; customer_id: string }
  | { kind: 'oldest_invoice'; customer_id: string }
  | { kind: 'call_list'; customer_ids: string[] }
  | { kind: 'due_window'; from: string; to: string }
  | { kind: 'group_total'; group: GroupColumns }
  | { kind: 'group_top'; group: GroupColumns; count: number }
  | { kind: 'group_age'; group: GroupColumns; days: number }
  | { kind: 'group_owing'; group: GroupColumns; over_cents: number };

/**
 * The answer to `question`, given every invoice it covers and the payments on them. Lists the
 * comparator treats as sets (invoice_ids, customer_ids) come sorted by id, so two answers that
 * grade the same are equal as JSON.
 */
export function answerQuestion(
  question: OverdueQuestion,
  invoices: readonly InvoiceDue[],
  payments: readonly PaymentMade[],
  asOf: string,
): JsonValue {
  switch (question.kind) {
    case 'customer_balance':
    case 'due_window': {
      const overdue = overdueInvoices(invoices, payments, asOf);
      return {
        invoice_ids: overdue.map((invoice) => invoice.invoice_id).sort(compareText),
        overdue_cents: sum(overdue.map((invoice) => invoice.balance_cents)),
      };
    }
    case 'oldest_invoice': {
      const oldest = overdueInvoices(invoices, payments, asOf)[0];
      if (!oldest) return null;
      return {
        invoice_id: oldest.invoice_id,
        balance_cents: oldest.balance_cents,
        days_overdue: oldest.days_overdue,
      };
    }
    case 'call_list':
      return { customers: listed(overdueBalances(invoices, payments, asOf)) };
    case 'group_total':
      return {
        overdue_cents: sum(overdueBalances(invoices, payments, asOf).map((b) => b.overdue_cents)),
      };
    case 'group_top':
      return {
        customers: listed(overdueBalances(invoices, payments, asOf).slice(0, question.count)),
      };
    case 'group_age': {
      const customer_ids = customersOverdueMoreThan(invoices, payments, asOf, question.days);
      return { count: customer_ids.length, customer_ids };
    }
    case 'group_owing':
      return {
        customers: listed(
          overdueBalances(invoices, payments, asOf).filter(
            (balance) => balance.overdue_cents > question.over_cents,
          ),
        ),
      };
  }
}

/** Balances as plain JSON objects, largest first as overdueBalances ranks them. */
function listed(balances: readonly CustomerBalance[]): JsonValue {
  return balances.map(({ customer_id, overdue_cents }) => ({ customer_id, overdue_cents }));
}

/** Whether a customer belongs to a group, judged from their customers.csv cells. */
export function inGroup(
  cells: Readonly<Record<string, string | null>>,
  group: GroupColumns,
): boolean {
  return Object.entries(group).every(([column, value]) => cells[column] === value);
}
