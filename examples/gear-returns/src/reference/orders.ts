import type { JsonValue } from '@architect/shared';
import { monthSpan } from '../lib/calendar';
import { compareText } from '../lib/compare';
import { sum } from '../lib/money';
import type { Category, Region } from '../shop/types';

/**
 * Every question the order tasks ask, and its answer from the "Order questions" section of
 * policy.md. An answer takes the records a question covers, so the same rules answer it from the
 * true records (when the tasks are made) and from what a reader found (in the reference
 * solutions that count tool calls).
 */

export type OrderQuestion =
  | { kind: 'spend'; email: string; category: Category; since: string }
  | { kind: 'sku_sales'; sku: string; month: string }
  | { kind: 'unshipped'; region: Region; through: string }
  | { kind: 'month_orders'; email: string; month: string };

export type OrderKind = OrderQuestion['kind'];

export interface LedgerCustomer {
  customer_id: string;
  email: string;
  region: Region;
}

export interface LedgerOrder {
  order_id: string;
  customer_id: string;
  order_date: string;
  shipped_on: string | null;
  shipping_cents: number;
}

export interface LedgerLine {
  order_id: string;
  sku: string;
  qty: number;
  unit_price_cents: number;
}

/** The records an order question reads, every value already read back to its plain form. */
export interface Ledger {
  customers: readonly LedgerCustomer[];
  orders: readonly LedgerOrder[];
  lines: readonly LedgerLine[];
  /** A product's category, translated from any old code. */
  categoryOf(sku: string): Category;
}

/** Lists of order ids come sorted, so answers that grade the same are equal as JSON. */
export function answerOrderQuestion(question: OrderQuestion, ledger: Ledger): JsonValue {
  switch (question.kind) {
    case 'spend': {
      const orders = ordersOf(ledger, customerByEmail(ledger, question.email)).filter(
        (order) => order.order_date >= question.since,
      );
      const lines = linesOf(ledger, orders).filter(
        (line) => ledger.categoryOf(line.sku) === question.category,
      );
      return { spent_cents: amountOf(lines) };
    }
    case 'sku_sales': {
      const { first, last } = monthSpan(question.month);
      const inMonth = new Set(
        ledger.orders
          .filter((order) => order.order_date >= first && order.order_date <= last)
          .map((order) => order.order_id),
      );
      const lines = ledger.lines.filter(
        (line) => line.sku === question.sku && inMonth.has(line.order_id),
      );
      return { units: sum(lines.map((line) => line.qty)), sales_cents: amountOf(lines) };
    }
    case 'unshipped': {
      const members = new Set(
        ledger.customers
          .filter((customer) => customer.region === question.region)
          .map((customer) => customer.customer_id),
      );
      const waiting = ledger.orders.filter(
        (order) =>
          members.has(order.customer_id) &&
          order.shipped_on === null &&
          order.order_date <= question.through,
      );
      return { order_ids: idsOf(waiting) };
    }
    case 'month_orders': {
      const { first, last } = monthSpan(question.month);
      const orders = ordersOf(ledger, customerByEmail(ledger, question.email)).filter(
        (order) => order.order_date >= first && order.order_date <= last,
      );
      const shipping = sum(orders.map((order) => order.shipping_cents));
      return {
        order_ids: idsOf(orders),
        total_cents: amountOf(linesOf(ledger, orders)) + shipping,
      };
    }
  }
}

function customerByEmail(ledger: Ledger, email: string): LedgerCustomer {
  const customer = ledger.customers.find((candidate) => candidate.email === email);
  if (!customer) throw new Error(`No customer with the email ${email}`);
  return customer;
}

function ordersOf(ledger: Ledger, customer: LedgerCustomer): LedgerOrder[] {
  return ledger.orders.filter((order) => order.customer_id === customer.customer_id);
}

function linesOf(ledger: Ledger, orders: readonly LedgerOrder[]): LedgerLine[] {
  const ids = new Set(orders.map((order) => order.order_id));
  return ledger.lines.filter((line) => ids.has(line.order_id));
}

function amountOf(lines: readonly LedgerLine[]): number {
  return sum(lines.map((line) => line.qty * line.unit_price_cents));
}

function idsOf(orders: readonly LedgerOrder[]): string[] {
  return orders.map((order) => order.order_id).sort(compareText);
}
