import type { JsonValue } from '@architect/shared';
import { monthSpan } from '../lib/calendar';
import { plainDollars } from '../lib/money';
import { RESTOCKING_PCT, pickupIdFor, returnIdFor } from '../policy/rules';
import { CATEGORIES } from '../shop/catalog';
import type {
  Carrier,
  Category,
  Condition,
  LegacyCode,
  Payment,
  Region,
  ReturnAmounts,
} from '../shop/types';
import { Reader, readCategory, readDate, readEmail, readMoney, readSku } from './normalize';
import { answerOrderQuestion } from './orders';
import type { Ledger, LedgerLine, LedgerOrder, OrderQuestion } from './orders';
import { carrierFor, earliestPickup } from './pickups';
import { decideReturn } from './refunds';
import { MAX_ROWS } from './tools';
import type { DeskTools, Row, TableRead } from './tools';

/**
 * Reference solutions that use only the agent's built-in tools, so the calls they make show what
 * each task costs in turns and context. Each reads the policy first, then exactly the rows the
 * task needs, through where conditions a careful agent would write: equality on clean ids,
 * `contains` for a SKU or an email (which finds a value whatever its capitals or stray spaces),
 * and whole pages wherever a date or an amount has to be read before it can be compared. Values
 * are read back with `Reader`, which notes every kind of value it found written another way.
 */

export interface ReturnRequest {
  request_id: string;
  order_id: string;
  sku: string;
  qty: number;
  condition: Condition;
}

export interface PickupRequest {
  return_id: string;
  /** The time the desk books it, HH:MM. */
  booked_at: string;
}

export interface Solved<T> {
  result: T;
  /** The kinds of value the solution had to read back from another form. */
  variants: ReadonlySet<string>;
}

/** Decides a return request at the desk and appends its row to returns.csv. */
export function solveReturn(
  tools: DeskTools,
  request: ReturnRequest,
  today: string,
): Solved<ReturnAmounts> {
  const reader = new Reader();
  tools.readText('policy.md');
  const order = onlyRow(tools, 'orders.csv', 'order_id', request.order_id);
  const customer = onlyRow(tools, 'customers.csv', 'customer_id', String(order.customer_id));
  const lines = rowsOf(tools, {
    file: 'order_lines.csv',
    where: [{ column: 'order_id', op: '=', value: request.order_id }],
  });
  const line = lines.find((candidate) => readSku(candidate.sku) === request.sku);
  if (!line) throw new Error(`Order ${request.order_id} has no line for ${request.sku}`);
  reader.sku(line.sku);
  const product = productRow(tools, reader, request.sku);
  const codes = isCategoryName(product.category) ? [] : legacyCodes(tools);
  const earlier = rowsOf(tools, {
    file: 'returns.csv',
    where: [{ column: 'order_id', op: '=', value: request.order_id }],
  }).filter((row) => row.decision === 'approved');
  const sameSku = earlier.filter((row) => readSku(row.sku) === request.sku);
  sameSku.forEach((row) => reader.sku(row.sku));

  const unitPrice = reader.money(line.unit_price);
  const amounts = decideReturn({
    qty: request.qty,
    condition: request.condition,
    decided_on: today,
    line_qty: Number(line.qty),
    unit_price_cents: unitPrice,
    category: reader.category(product.category, codes),
    final_sale: product.final_sale === 'yes',
    order_date: reader.date(order.order_date),
    delivered_on: reader.date(order.delivered_on),
    shipping_cents: readMoney(order.shipping),
    payment: String(order.payment) as Payment,
    member_since: reader.optionalDate(customer.member_since),
    approved_before: sameSku.reduce((total, row) => total + Number(row.qty), 0),
    shipping_refunded_before: earlier.some((row) => Number(row.shipping_refund_cents) > 0),
  });
  // The shipping charge only counts when it is refunded.
  if (amounts.shipping_refund_cents > 0) reader.money(order.shipping);

  tools.calculate(`round(${request.qty} * ${plainDollars(unitPrice)} * 100)`, amounts.item_cents);
  if (amounts.restocking_fee_cents > 0) {
    tools.calculate(
      `round(${amounts.item_cents} * ${RESTOCKING_PCT} / 100)`,
      amounts.restocking_fee_cents,
    );
  }
  if (amounts.decision === 'approved') {
    tools.calculate(
      `${amounts.item_cents} - ${amounts.restocking_fee_cents} - ${amounts.return_shipping_cents} + ${amounts.shipping_refund_cents}`,
      amounts.refund_cents,
    );
  }
  tools.appendRows('returns.csv', [
    {
      return_id: returnIdFor(request.request_id),
      order_id: request.order_id,
      sku: request.sku,
      qty: String(request.qty),
      condition: request.condition,
      decided_on: today,
      decision: amounts.decision,
      item_cents: String(amounts.item_cents),
      restocking_fee_cents: String(amounts.restocking_fee_cents),
      return_shipping_cents: String(amounts.return_shipping_cents),
      shipping_refund_cents: String(amounts.shipping_refund_cents),
      refund_cents: String(amounts.refund_cents),
      refund_to: amounts.refund_to,
      pickup_from: null,
    },
  ]);
  return { result: amounts, variants: reader.variants };
}

export interface BookedPickup {
  carrier: Carrier;
  pickup_date: string;
}

/** Books the earliest pickup for an approved return and appends it to pickups.csv. */
export function solvePickup(
  tools: DeskTools,
  request: PickupRequest,
  today: string,
): Solved<BookedPickup> {
  const reader = new Reader();
  tools.readText('policy.md');
  const record = onlyRow(tools, 'returns.csv', 'return_id', request.return_id);
  if (record.decision !== 'approved') throw new Error(`${request.return_id} is not approved`);
  const order = onlyRow(tools, 'orders.csv', 'order_id', String(record.order_id));
  const customer = onlyRow(tools, 'customers.csv', 'customer_id', String(order.customer_id));
  const product = productRow(tools, reader, reader.sku(record.sku));
  const carrier = carrierFor(String(customer.region) as Region, product.bulky === 'yes');
  const booked = new Map<string, number>();
  for (const row of rowsOf(tools, {
    file: 'pickups.csv',
    where: [{ column: 'carrier', op: '=', value: carrier }],
    columns: ['pickup_date'],
  })) {
    const date = reader.date(row.pickup_date);
    booked.set(date, (booked.get(date) ?? 0) + 1);
  }
  const pickup_date = earliestPickup({
    carrier,
    today,
    bookedAt: request.booked_at,
    readyFrom: reader.optionalDate(record.pickup_from),
    bookedOn: (date) => booked.get(date) ?? 0,
  });
  tools.appendRows('pickups.csv', [
    {
      pickup_id: pickupIdFor(request.return_id),
      return_id: request.return_id,
      carrier,
      pickup_date,
      booked_on: today,
    },
  ]);
  return { result: { carrier, pickup_date }, variants: reader.variants };
}

/**
 * Answers an order question from the rows it covers. Every amount and every count of units is
 * added up with one calculate call, the way the tool's description asks. Of the values written
 * another way, only those the answer depends on are noted: every date that decides whether an
 * order counts, but only the prices, shipping charges and categories that are added up or
 * matched.
 */
export function answerOrder(tools: DeskTools, question: OrderQuestion): Solved<JsonValue> {
  const reader = new Reader();
  tools.readText('policy.md');
  const ledger = (() => {
    switch (question.kind) {
      case 'spend':
        return spendLedger(tools, reader, question);
      case 'sku_sales':
        return salesLedger(tools, reader, question);
      case 'unshipped':
        return unshippedLedger(tools, reader, question);
      case 'month_orders':
        return monthLedger(tools, reader, question);
    }
  })();
  const answer = answerOrderQuestion(question, ledger);
  for (const [key, value] of Object.entries(answer as Record<string, JsonValue>)) {
    if (typeof value === 'number') tools.calculate(`the ${key} sum`, value);
  }
  return { result: answer, variants: reader.variants };
}

type Question<K extends OrderQuestion['kind']> = Extract<OrderQuestion, { kind: K }>;

function spendLedger(tools: DeskTools, reader: Reader, question: Question<'spend'>): Ledger {
  const customer = customerByEmail(tools, reader, question.email);
  const orders = ordersOf(tools, reader, customer.customer_id, ['order_date'])
    .map(({ order }) => order)
    .filter((order) => order.order_date >= question.since);
  const rows = lineRows(tools, orders);
  const categories = categoriesOf(tools, reader, rows, question.category);
  for (const row of rows) {
    reader.sku(row.sku);
    if (categories.get(readSku(row.sku)) === question.category) reader.money(row.unit_price);
  }
  return {
    customers: [customer],
    orders,
    lines: rows.map(lineOf),
    categoryOf: (sku) => categories.get(sku) ?? missing(`a category for ${sku}`),
  };
}

function salesLedger(tools: DeskTools, reader: Reader, question: Question<'sku_sales'>): Ledger {
  const rows = rowsOf(tools, {
    file: 'order_lines.csv',
    where: [{ column: 'sku', op: 'contains', value: question.sku }],
    columns: ['order_id', 'sku', 'qty', 'unit_price'],
  });
  const orders = rowsOf(tools, {
    file: 'orders.csv',
    where: [{ column: 'order_id', op: 'in', value: rows.map((row) => String(row.order_id)) }],
    columns: ['order_id', 'customer_id', 'order_date'],
  }).map((row) => orderOf(reader, row));
  const { first, last } = monthSpan(question.month);
  const sold = new Set(
    orders
      .filter((order) => order.order_date >= first && order.order_date <= last)
      .map((order) => order.order_id),
  );
  for (const row of rows) {
    reader.sku(row.sku);
    if (sold.has(String(row.order_id))) reader.money(row.unit_price);
  }
  return {
    customers: [],
    orders,
    lines: rows.map(lineOf),
    categoryOf: () => missing('a category'),
  };
}

function unshippedLedger(
  tools: DeskTools,
  reader: Reader,
  question: Question<'unshipped'>,
): Ledger {
  const customers = rowsOf(tools, {
    file: 'customers.csv',
    where: [{ column: 'region', op: '=', value: question.region }],
    columns: ['customer_id', 'email', 'region'],
  }).map((row) => ({
    customer_id: String(row.customer_id),
    email: readEmail(row.email),
    region: question.region,
  }));
  const orders = rowsOf(tools, {
    file: 'orders.csv',
    where: [
      { column: 'customer_id', op: 'in', value: customers.map((c) => c.customer_id) },
      { column: 'shipped_on', op: '=', value: null },
    ],
    columns: ['order_id', 'customer_id', 'order_date', 'shipped_on'],
  }).map((row) => orderOf(reader, row));
  return { customers, orders, lines: [], categoryOf: () => missing('a category') };
}

function monthLedger(tools: DeskTools, reader: Reader, question: Question<'month_orders'>): Ledger {
  const customer = customerByEmail(tools, reader, question.email);
  const { first, last } = monthSpan(question.month);
  const placed = ordersOf(tools, reader, customer.customer_id, ['order_date', 'shipping']).filter(
    ({ order }) => order.order_date >= first && order.order_date <= last,
  );
  for (const { row } of placed) reader.money(row.shipping);
  const orders = placed.map(({ order }) => order);
  const rows = lineRows(tools, orders);
  for (const row of rows) reader.money(row.unit_price);
  return {
    customers: [customer],
    orders,
    lines: rows.map(lineOf),
    categoryOf: () => missing('a category'),
  };
}

function customerByEmail(tools: DeskTools, reader: Reader, email: string) {
  const row = onlyMatch(tools, {
    file: 'customers.csv',
    where: [{ column: 'email', op: 'contains', value: email }],
    columns: ['customer_id', 'email', 'region'],
  });
  return {
    customer_id: String(row.customer_id),
    email: reader.email(row.email),
    region: String(row.region) as Region,
  };
}

/** A customer's orders as rows and as the answer reads them, with these columns besides the ids. */
function ordersOf(
  tools: DeskTools,
  reader: Reader,
  customerId: string,
  columns: readonly string[],
): { row: Row; order: LedgerOrder }[] {
  return rowsOf(tools, {
    file: 'orders.csv',
    where: [{ column: 'customer_id', op: '=', value: customerId }],
    columns: ['order_id', 'customer_id', ...columns],
  }).map((row) => ({ row, order: orderOf(reader, row) }));
}

function lineRows(tools: DeskTools, orders: readonly LedgerOrder[]): Row[] {
  if (orders.length === 0) return [];
  return rowsOf(tools, {
    file: 'order_lines.csv',
    where: [{ column: 'order_id', op: 'in', value: orders.map((order) => order.order_id) }],
    columns: ['order_id', 'sku', 'qty', 'unit_price'],
  });
}

/**
 * The categories of the lines' products: the whole product list, and the old codes when one of
 * them is used. A code is noted only when it hides a product of the category asked about.
 */
function categoriesOf(
  tools: DeskTools,
  reader: Reader,
  rows: readonly Row[],
  asked: Category,
): Map<string, Category> {
  if (rows.length === 0) return new Map();
  const wanted = new Set(rows.map((row) => readSku(row.sku)));
  const products = rowsOf(tools, { file: 'products.csv', columns: ['sku', 'category'] }).filter(
    (row) => wanted.has(readSku(row.sku)),
  );
  const codes = products.every((row) => isCategoryName(row.category)) ? [] : legacyCodes(tools);
  return new Map(
    products.map((row) => {
      const category = readCategory(row.category, codes);
      if (category === asked) reader.category(row.category, codes);
      return [readSku(row.sku), category];
    }),
  );
}

/** An order as the answer needs it. Its date is noted when written another way; it decides. */
function orderOf(reader: Reader, row: Row): LedgerOrder {
  return {
    order_id: String(row.order_id),
    customer_id: String(row.customer_id),
    order_date: reader.date(row.order_date),
    shipped_on:
      row.shipped_on === undefined || row.shipped_on === null ? null : readDate(row.shipped_on),
    shipping_cents: row.shipping === undefined ? 0 : readMoney(row.shipping),
  };
}

/** A line as the answer needs it, read back without noting anything: callers note what counts. */
function lineOf(row: Row): LedgerLine {
  return {
    order_id: String(row.order_id),
    sku: readSku(row.sku),
    qty: Number(row.qty),
    unit_price_cents: readMoney(row.unit_price),
  };
}

/** The product with this SKU, found whatever capitals or stray spaces its row has. */
function productRow(tools: DeskTools, reader: Reader, sku: string): Row {
  const product = onlyMatch(tools, {
    file: 'products.csv',
    where: [{ column: 'sku', op: 'contains', value: sku }],
  });
  reader.sku(product.sku);
  return product;
}

function legacyCodes(tools: DeskTools): LegacyCode[] {
  return rowsOf(tools, { file: 'category_map.csv' }).map((row) => ({
    legacy_code: String(row.legacy_code),
    category: String(row.category) as Category,
  }));
}

function isCategoryName(cell: string | null | undefined): boolean {
  return CATEGORIES.some((category) => category === cell);
}

/** The row whose clean id column holds `value`. */
function onlyRow(tools: DeskTools, file: string, column: string, value: string): Row {
  return onlyMatch(tools, { file, where: [{ column, op: '=', value }] });
}

function onlyMatch(tools: DeskTools, read: TableRead): Row {
  const { rows, total } = tools.readTable(read);
  if (total !== 1 || !rows[0]) throw new Error(`${total} rows of ${read.file} match`);
  return rows[0];
}

/** Every matching row, page by page. */
function rowsOf(tools: DeskTools, read: TableRead): Row[] {
  const rows: Row[] = [];
  for (;;) {
    const page = tools.readTable({ ...read, limit: MAX_ROWS, offset: rows.length });
    if (page.rows.length === 0 && page.truncated) {
      throw new Error(`A single row of ${read.file} is longer than a tool result can hold`);
    }
    rows.push(...page.rows);
    if (!page.truncated) return rows;
  }
}

function missing(what: string): never {
  throw new Error(`Missing ${what}`);
}
