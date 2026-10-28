import type { JsonValue } from '@architect/shared';
import type { CsvRow } from '../src/lib/csv';
import { BUSINESS_DATE } from './helpers';
import type { JobFolder } from './helpers';

/**
 * Second implementations of the policy, written from policy.md without the generator's reference
 * code, working on the CSV text the agent sees and reading every value back in their own way. The
 * tests compare them with the ground truth on every task and every past record, so a mistake has
 * to be made twice, in two different ways, to slip through.
 */

const MONTHS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

/** Any of the shop's ways of writing a date, as YYYY-MM-DD. */
export function isoDate(cell: string | null | undefined): string {
  const text = String(cell ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const slash = text.split('/');
  if (slash.length === 3) return `${slash[2]}-${slash[0]}-${slash[1]}`;
  const [month, day, year] = text.replace(',', '').split(' ');
  const number = MONTHS[month ?? ''];
  if (!number || !day || !year) throw new Error(`Unreadable date ${JSON.stringify(cell)}`);
  return `${year}-${number}-${day.padStart(2, '0')}`;
}

/** Any of the shop's ways of writing money, as cents. */
export function cents(cell: string | null | undefined): number {
  const digits = String(cell ?? '').replace(/[^0-9.]/g, '');
  if (digits === '') throw new Error(`Unreadable amount ${JSON.stringify(cell)}`);
  return Math.round(Number(digits) * 100);
}

export function skuOf(cell: string | null | undefined): string {
  return String(cell ?? '')
    .replace(/\s/g, '')
    .toUpperCase();
}

export function emailOf(cell: string | null | undefined): string {
  return String(cell ?? '')
    .replace(/\s/g, '')
    .toLowerCase();
}

/** Calendar days from one YYYY-MM-DD date to another. */
export function dayCount(from: string, to: string): number {
  const at = (date: string) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return at(to) - at(from);
}

export function plusDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** A product's category, through category_map.csv when it holds an old code. */
export function categoryOf(job: JobFolder, cell: string | null | undefined): string {
  const code = job.table('category_map.csv').find((row) => row.legacy_code === cell);
  return code ? String(code.category) : String(cell);
}

function one(rows: CsvRow[], what: string): CsvRow {
  if (rows.length !== 1) throw new Error(`${rows.length} rows for ${what}`);
  return rows[0] as CsvRow;
}

export interface ReturnRequestFacts {
  order_id: string;
  sku: string;
  qty: number;
  condition: string;
}

export interface ReturnOutcome {
  decision: string;
  item_cents: number;
  restocking_fee_cents: number;
  return_shipping_cents: number;
  shipping_refund_cents: number;
  refund_cents: number;
  refund_to: string;
}

/**
 * A return decided on `day`, given the returns already in the log before it. Written from the
 * "Returns and refunds" section: perks, then the three approval checks, then the amounts.
 */
export function decideFromCsv(
  job: JobFolder,
  request: ReturnRequestFacts,
  day: string,
  earlier: CsvRow[],
): ReturnOutcome {
  const order = one(
    job.table('orders.csv').filter((row) => row.order_id === request.order_id),
    request.order_id,
  );
  const customer = one(
    job.table('customers.csv').filter((row) => row.customer_id === order.customer_id),
    String(order.customer_id),
  );
  const line = one(
    job
      .table('order_lines.csv')
      .filter((row) => row.order_id === request.order_id && skuOf(row.sku) === request.sku),
    `${request.order_id} ${request.sku}`,
  );
  const product = one(
    job.table('products.csv').filter((row) => skuOf(row.sku) === request.sku),
    request.sku,
  );
  const joined = customer.member_since === null ? null : isoDate(customer.member_since);
  const perks = joined !== null && joined <= isoDate(order.order_date);
  const days = dayCount(isoDate(order.delivered_on), day);
  const defective = request.condition === 'defective';
  const limit = defective ? 90 : perks ? 60 : 30;
  const approvedOnOrder = earlier.filter(
    (row) => row.order_id === request.order_id && row.decision === 'approved',
  );
  const returnedBefore = approvedOnOrder
    .filter((row) => skuOf(row.sku) === request.sku)
    .reduce((units, row) => units + Number(row.qty), 0);
  const item = request.qty * cents(line.unit_price);
  const approve =
    days <= limit &&
    (product.final_sale !== 'yes' || defective) &&
    request.qty <= Number(line.qty) - returnedBefore;
  if (!approve) {
    return {
      decision: 'denied',
      item_cents: item,
      restocking_fee_cents: 0,
      return_shipping_cents: 0,
      shipping_refund_cents: 0,
      refund_cents: 0,
      refund_to: 'none',
    };
  }
  const category = categoryOf(job, product.category);
  const restocking =
    request.condition === 'opened' && ['tents', 'sleeping', 'electronics'].includes(category)
      ? Math.floor((item * 15 + 50) / 100)
      : 0;
  const label = perks || defective ? 0 : 695;
  const shippingBack =
    defective && !approvedOnOrder.some((row) => Number(row.shipping_refund_cents) > 0)
      ? cents(order.shipping)
      : 0;
  return {
    decision: 'approved',
    item_cents: item,
    restocking_fee_cents: restocking,
    return_shipping_cents: label,
    shipping_refund_cents: shippingBack,
    refund_cents: item - restocking - label + shippingBack,
    refund_to: order.payment === 'card' && days <= 30 ? 'card' : 'store_credit',
  };
}

const CARRIER_DAYS: Record<string, number[]> = {
  'Cedarline Parcel': [1, 2, 4, 5],
  'Kettlepoint Courier': [1, 3, 5, 6],
  'Basalt Freight': [2, 4],
};

/** The carrier for a return: the freight carrier for a bulky product, else by region. */
export function carrierFromCsv(job: JobFolder, returnRow: CsvRow): string {
  const order = one(
    job.table('orders.csv').filter((row) => row.order_id === returnRow.order_id),
    String(returnRow.order_id),
  );
  const customer = one(
    job.table('customers.csv').filter((row) => row.customer_id === order.customer_id),
    String(order.customer_id),
  );
  const product = one(
    job.table('products.csv').filter((row) => skuOf(row.sku) === skuOf(returnRow.sku)),
    String(returnRow.sku),
  );
  if (product.bulky === 'yes') return 'Basalt Freight';
  return ['Lakeshore', 'Valley'].includes(String(customer.region))
    ? 'Cedarline Parcel'
    : 'Kettlepoint Courier';
}

/** The earliest pickup for an approved return booked at `time` today, from the "Pickups" rules. */
export function pickupFromCsv(
  job: JobFolder,
  returnId: string,
  time: string,
): { carrier: string; pickup_date: string } {
  const record = one(
    job.table('returns.csv').filter((row) => row.return_id === returnId),
    returnId,
  );
  const carrier = carrierFromCsv(job, record);
  const taken = job
    .table('pickups.csv')
    .filter((row) => row.carrier === carrier)
    .map((row) => isoDate(row.pickup_date));
  let date = plusDays(BUSINESS_DATE, time < '14:00' ? 1 : 2);
  const ready = record.pickup_from === null ? null : isoDate(record.pickup_from);
  if (ready !== null && ready > date) date = ready;
  while (
    !(CARRIER_DAYS[carrier] ?? []).includes(weekday(date)) ||
    date === '2026-11-26' ||
    taken.filter((day) => day === date).length >= 3
  ) {
    date = plusDays(date, 1);
  }
  return { carrier, pickup_date: date };
}

export type OrderQuestionFacts =
  | { kind: 'spend'; email: string; category: string; since: string }
  | { kind: 'sku_sales'; sku: string; month: string }
  | { kind: 'unshipped'; region: string; through: string }
  | { kind: 'month_orders'; email: string; month: string };

/** An order question answered from the "Order questions" rules, with id lists sorted. */
export function orderAnswerFromCsv(job: JobFolder, question: OrderQuestionFacts): JsonValue {
  const orders = job.table('orders.csv');
  const lines = job.table('order_lines.csv');
  const customerIdOf = (email: string) =>
    String(
      one(
        job.table('customers.csv').filter((row) => emailOf(row.email) === email),
        email,
      ).customer_id,
    );
  const amount = (rows: CsvRow[]) =>
    rows.reduce((total, row) => total + Number(row.qty) * cents(row.unit_price), 0);
  const inMonth = (row: CsvRow, month: string) => isoDate(row.order_date).startsWith(`${month}-`);
  const linesOf = (ids: string[]) => lines.filter((row) => ids.includes(String(row.order_id)));
  switch (question.kind) {
    case 'spend': {
      const customer = customerIdOf(question.email);
      const ids = orders
        .filter((row) => row.customer_id === customer && isoDate(row.order_date) >= question.since)
        .map((row) => String(row.order_id));
      const categoryOfSku = new Map(
        job.table('products.csv').map((row) => [skuOf(row.sku), categoryOf(job, row.category)]),
      );
      const bought = linesOf(ids).filter(
        (row) => categoryOfSku.get(skuOf(row.sku)) === question.category,
      );
      return { spent_cents: amount(bought) };
    }
    case 'sku_sales': {
      const ids = orders
        .filter((row) => inMonth(row, question.month))
        .map((row) => String(row.order_id));
      const sold = linesOf(ids).filter((row) => skuOf(row.sku) === question.sku);
      return {
        units: sold.reduce((units, row) => units + Number(row.qty), 0),
        sales_cents: amount(sold),
      };
    }
    case 'unshipped': {
      const members = job
        .table('customers.csv')
        .filter((row) => row.region === question.region)
        .map((row) => row.customer_id);
      const waiting = orders.filter(
        (row) =>
          members.includes(row.customer_id) &&
          row.shipped_on === null &&
          isoDate(row.order_date) <= question.through,
      );
      return { order_ids: waiting.map((row) => String(row.order_id)).sort() };
    }
    case 'month_orders': {
      const customer = customerIdOf(question.email);
      const placed = orders.filter(
        (row) => row.customer_id === customer && inMonth(row, question.month),
      );
      const ids = placed.map((row) => String(row.order_id)).sort();
      const shipping = placed.reduce((total, row) => total + cents(row.shipping), 0);
      return { order_ids: ids, total_cents: amount(linesOf(ids)) + shipping };
    }
  }
}
