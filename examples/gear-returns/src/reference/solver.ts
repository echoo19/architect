import type { JsonValue } from '@architect/shared';
import type { CsvRow } from '../lib/csv';
import { monthSpan } from '../lib/calendar';
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
import { answerOrderQuestion, answerTerms } from './orders';
import type { AnswerTerms, Ledger, LedgerLine, LedgerOrder, OrderQuestion } from './orders';
import { carrierFor, earliestPickup } from './pickups';
import { decideReturn } from './refunds';
import { cell } from './tools';
import type { AgentTools, CodeRow } from './tools';

/**
 * Reference solutions that use only the agent's built-in tools, so the calls they make show what
 * each task costs in turns and context. Each reads the policy first, then sends code to run that
 * fetches exactly the rows the task needs, the way a careful agent writes it: equality on clean
 * ids, a case-blind search for a SKU or an email (which finds a value whatever its capitals or
 * stray spaces), and joins from one table to the next. The policy's rules are applied here, to
 * what the code fetched, and values are read back with `Reader`, which notes every kind of value
 * it found written another way. Arithmetic goes through run as well, and a write task ends by
 * appending its row.
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

/** The first line of every fetch: a table's rows by its file name. */
const READ = `const read = (name) => csv.parse(files.read('data/' + name));`;

/** A value written into the code. */
const text = (value: string): string => JSON.stringify(value);

/** Decides a return request at the desk and appends its row to returns.csv. */
export function solveReturn(
  tools: AgentTools,
  request: ReturnRequest,
  today: string,
): Solved<ReturnAmounts> {
  const reader = new Reader();
  tools.readAll('policy.md');
  const sku = request.sku.toLowerCase();
  const found = tools.run(
    [
      READ,
      `const order = read('orders.csv').find((row) => row.order_id === ${text(request.order_id)});`,
      '({',
      '  order,',
      "  customer: read('customers.csv').find((row) => row.customer_id === order.customer_id),",
      "  lines: read('order_lines.csv').filter((row) => row.order_id === order.order_id),",
      `  products: read('products.csv').filter((row) => row.sku.toLowerCase().includes(${text(sku)})),`,
      "  returns: read('returns.csv').filter((row) => row.order_id === order.order_id),",
      '})',
    ].join('\n'),
    (t) => {
      const order = t.one('orders.csv', (row) => row.order_id === request.order_id);
      return {
        order,
        customer: t.one('customers.csv', (row) => row.customer_id === order.customer_id),
        lines: t.where('order_lines.csv', (row) => row.order_id === order.order_id),
        products: t.where('products.csv', (row) => cell(row, 'sku').toLowerCase().includes(sku)),
        returns: t.where('returns.csv', (row) => row.order_id === order.order_id),
      };
    },
  );
  const order = asRow(found.order);
  const customer = asRow(found.customer);
  const line = found.lines.map(asRow).find((candidate) => readSku(candidate.sku) === request.sku);
  if (!line) throw new Error(`Order ${request.order_id} has no line for ${request.sku}`);
  reader.sku(line.sku);
  const product = onlyOne(found.products, 'products.csv');
  reader.sku(product.sku);
  const codes = isCategoryName(product.category) ? [] : legacyCodes(tools);
  const earlier = found.returns.map(asRow).filter((row) => row.decision === 'approved');
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

  addUpRefund(tools, request.qty, unitPrice, amounts);
  tools.append('returns.csv', [
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

/**
 * Works a return's amounts out in code, in cents: the item, the restocking fee when there is one
 * and the refund when the return is approved. The fee rounds half up, as the policy says.
 */
function addUpRefund(
  tools: AgentTools,
  qty: number,
  unitCents: number,
  amounts: ReturnAmounts,
): void {
  const fee = amounts.restocking_fee_cents > 0;
  const approved = amounts.decision === 'approved';
  const refund = `item${fee ? ' - fee' : ''} - ${amounts.return_shipping_cents} + ${amounts.shipping_refund_cents}`;
  const code = [
    `const item = ${qty} * ${unitCents};`,
    ...(fee ? [`const fee = Math.round((item * ${RESTOCKING_PCT}) / 100);`] : []),
    `({ item_cents: item${fee ? ', restocking_fee_cents: fee' : ''}${approved ? `, refund_cents: ${refund}` : ''} })`,
  ];
  tools.run(code.join('\n'), () => ({
    item_cents: amounts.item_cents,
    ...(fee ? { restocking_fee_cents: amounts.restocking_fee_cents } : {}),
    ...(approved ? { refund_cents: amounts.refund_cents } : {}),
  }));
}

export interface BookedPickup {
  carrier: Carrier;
  pickup_date: string;
}

/** Books the earliest pickup for an approved return and appends it to pickups.csv. */
export function solvePickup(
  tools: AgentTools,
  request: PickupRequest,
  today: string,
): Solved<BookedPickup> {
  const reader = new Reader();
  tools.readAll('policy.md');
  const found = tools.run(
    [
      READ,
      `const record = read('returns.csv').find((row) => row.return_id === ${text(request.return_id)});`,
      "const order = read('orders.csv').find((row) => row.order_id === record.order_id);",
      'const sku = record.sku.trim().toLowerCase();',
      '({',
      '  record,',
      '  order,',
      "  customer: read('customers.csv').find((row) => row.customer_id === order.customer_id),",
      "  products: read('products.csv').filter((row) => row.sku.toLowerCase().includes(sku)),",
      '})',
    ].join('\n'),
    (t) => {
      const record = t.one('returns.csv', (row) => row.return_id === request.return_id);
      const order = t.one('orders.csv', (row) => row.order_id === record.order_id);
      const sku = cell(record, 'sku').trim().toLowerCase();
      return {
        record,
        order,
        customer: t.one('customers.csv', (row) => row.customer_id === order.customer_id),
        products: t.where('products.csv', (row) => cell(row, 'sku').toLowerCase().includes(sku)),
      };
    },
  );
  const record = asRow(found.record);
  if (record.decision !== 'approved') throw new Error(`${request.return_id} is not approved`);
  const customer = asRow(found.customer);
  reader.sku(record.sku);
  const product = onlyOne(found.products, 'products.csv');
  reader.sku(product.sku);
  const carrier = carrierFor(String(customer.region) as Region, product.bulky === 'yes');
  const dates = tools.run(
    `csv.parse(files.read('data/pickups.csv')).filter((row) => row.carrier === ${text(carrier)}).map((row) => row.pickup_date)`,
    (t) =>
      t
        .where('pickups.csv', (row) => row.carrier === carrier)
        .map((row) => cell(row, 'pickup_date')),
  );
  const booked = new Map<string, number>();
  for (const cell of dates) {
    const date = reader.date(cell);
    booked.set(date, (booked.get(date) ?? 0) + 1);
  }
  const pickup_date = earliestPickup({
    carrier,
    today,
    bookedAt: request.booked_at,
    readyFrom: reader.optionalDate(record.pickup_from),
    bookedOn: (date) => booked.get(date) ?? 0,
  });
  tools.append('pickups.csv', [
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
 * added up in code from the lines and charges the answer counts. Of the values written another
 * way, only those the answer depends on are noted: every date that decides whether an order
 * counts, but only the prices, shipping charges and categories that are added up or matched.
 */
export function answerOrder(tools: AgentTools, question: OrderQuestion): Solved<JsonValue> {
  const reader = new Reader();
  tools.readAll('policy.md');
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
  addUpAnswer(tools, question, answerTerms(question, ledger), answer);
  return { result: answer, variants: reader.variants };
}

/** The numbers in an answer, added up in code from the terms it counts. */
function addUpAnswer(
  tools: AgentTools,
  question: OrderQuestion,
  terms: AnswerTerms,
  answer: JsonValue,
): void {
  if (question.kind === 'unshipped') return;
  const lines = `const lines = ${JSON.stringify(terms.lines.map((line) => [line.qty, line.unit_price_cents]))};`;
  const amount = 'lines.reduce((sum, [qty, cents]) => sum + qty * cents, 0)';
  const code = (() => {
    switch (question.kind) {
      case 'spend':
        return [lines, `({ spent_cents: ${amount} })`];
      case 'sku_sales':
        return [
          lines,
          `({ units: lines.reduce((sum, [qty]) => sum + qty, 0), sales_cents: ${amount} })`,
        ];
      case 'month_orders':
        return [
          lines,
          `const shipping = ${JSON.stringify(terms.shipping)};`,
          `({ total_cents: ${amount} + shipping.reduce((sum, cents) => sum + cents, 0) })`,
        ];
    }
  })();
  const numbers = Object.fromEntries(
    Object.entries(answer as Record<string, JsonValue>).filter(
      ([, value]) => typeof value === 'number',
    ),
  );
  tools.run(code.join('\n'), () => numbers);
}

type Question<K extends OrderQuestion['kind']> = Extract<OrderQuestion, { kind: K }>;

/** A customer found by email, and their orders with these columns besides the ids. */
interface CustomerOrders {
  customer: CodeRow;
  orders: CodeRow[];
}

function customerOrders(
  tools: AgentTools,
  email: string,
  columns: readonly string[],
): CustomerOrders {
  const needle = email.toLowerCase();
  const fields = ['order_id', 'customer_id', ...columns];
  return tools.run(
    [
      READ,
      `const customer = read('customers.csv').find((row) => row.email.toLowerCase().includes(${text(needle)}));`,
      '({',
      '  customer: { customer_id: customer.customer_id, email: customer.email, region: customer.region },',
      `  orders: read('orders.csv').filter((row) => row.customer_id === customer.customer_id).map((row) => (${fieldsOf(fields)})),`,
      '})',
    ].join('\n'),
    (t) => {
      const customer = t.one('customers.csv', (row) =>
        cell(row, 'email').toLowerCase().includes(needle),
      );
      return {
        customer: pick(customer, ['customer_id', 'email', 'region']),
        orders: t
          .where('orders.csv', (row) => row.customer_id === customer.customer_id)
          .map((row) => pick(row, fields)),
      };
    },
  );
}

function spendLedger(tools: AgentTools, reader: Reader, question: Question<'spend'>): Ledger {
  const found = customerOrders(tools, question.email, ['order_date']);
  const customer = customerOf(reader, asRow(found.customer));
  const orders = found.orders
    .map((row) => orderOf(reader, asRow(row)))
    .filter((order) => order.order_date >= question.since);
  const fetched =
    orders.length === 0 ? { lines: [], products: [] } : linesAndProducts(tools, orders);
  const rows = fetched.lines.map(asRow);
  const categories = categoriesOf(tools, reader, rows, fetched.products, question.category);
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

/** The lines of some orders, and every product's SKU and category to match them against. */
function linesAndProducts(
  tools: AgentTools,
  orders: readonly LedgerOrder[],
): { lines: CodeRow[]; products: CodeRow[] } {
  const ids = orders.map((order) => order.order_id);
  return tools.run(
    [
      READ,
      `const ids = ${JSON.stringify(ids)};`,
      '({',
      `  lines: read('order_lines.csv').filter((row) => ids.includes(row.order_id)).map((row) => (${fieldsOf(LINE_FIELDS)})),`,
      "  products: read('products.csv').map((row) => ({ sku: row.sku, category: row.category })),",
      '})',
    ].join('\n'),
    (t) => ({
      lines: t
        .where('order_lines.csv', (row) => ids.includes(cell(row, 'order_id')))
        .map((row) => pick(row, LINE_FIELDS)),
      products: t.where('products.csv', () => true).map((row) => pick(row, ['sku', 'category'])),
    }),
  );
}

function salesLedger(tools: AgentTools, reader: Reader, question: Question<'sku_sales'>): Ledger {
  const needle = question.sku.toLowerCase();
  const orderFields = ['order_id', 'customer_id', 'order_date'];
  const found = tools.run(
    [
      READ,
      `const lines = read('order_lines.csv').filter((row) => row.sku.toLowerCase().includes(${text(needle)})).map((row) => (${fieldsOf(LINE_FIELDS)}));`,
      'const ids = lines.map((line) => line.order_id);',
      '({',
      '  lines,',
      `  orders: read('orders.csv').filter((row) => ids.includes(row.order_id)).map((row) => (${fieldsOf(orderFields)})),`,
      '})',
    ].join('\n'),
    (t) => {
      const lines = t
        .where('order_lines.csv', (row) => cell(row, 'sku').toLowerCase().includes(needle))
        .map((row) => pick(row, LINE_FIELDS));
      const ids = lines.map((line) => cell(line, 'order_id'));
      return {
        lines,
        orders: t
          .where('orders.csv', (row) => ids.includes(cell(row, 'order_id')))
          .map((row) => pick(row, orderFields)),
      };
    },
  );
  const rows = found.lines.map(asRow);
  const orders = found.orders.map((row) => orderOf(reader, asRow(row)));
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
  tools: AgentTools,
  reader: Reader,
  question: Question<'unshipped'>,
): Ledger {
  const orderFields = ['order_id', 'customer_id', 'order_date', 'shipped_on'];
  const found = tools.run(
    [
      READ,
      `const customers = read('customers.csv').filter((row) => row.region === ${text(question.region)}).map((row) => ({ customer_id: row.customer_id, email: row.email, region: row.region }));`,
      'const ids = customers.map((customer) => customer.customer_id);',
      '({',
      '  customers,',
      `  orders: read('orders.csv').filter((row) => ids.includes(row.customer_id) && row.shipped_on === '').map((row) => (${fieldsOf(orderFields)})),`,
      '})',
    ].join('\n'),
    (t) => {
      const customers = t
        .where('customers.csv', (row) => row.region === question.region)
        .map((row) => pick(row, ['customer_id', 'email', 'region']));
      const ids = customers.map((customer) => cell(customer, 'customer_id'));
      return {
        customers,
        orders: t
          .where(
            'orders.csv',
            (row) => ids.includes(cell(row, 'customer_id')) && row.shipped_on === '',
          )
          .map((row) => pick(row, orderFields)),
      };
    },
  );
  return {
    customers: found.customers.map((row) => ({
      customer_id: String(row.customer_id),
      email: readEmail(row.email),
      region: question.region,
    })),
    orders: found.orders.map((row) => orderOf(reader, asRow(row))),
    lines: [],
    categoryOf: () => missing('a category'),
  };
}

function monthLedger(
  tools: AgentTools,
  reader: Reader,
  question: Question<'month_orders'>,
): Ledger {
  const found = customerOrders(tools, question.email, ['order_date', 'shipping']);
  const customer = customerOf(reader, asRow(found.customer));
  const { first, last } = monthSpan(question.month);
  const placed = found.orders
    .map(asRow)
    .map((row) => ({ row, order: orderOf(reader, row) }))
    .filter(({ order }) => order.order_date >= first && order.order_date <= last);
  for (const { row } of placed) reader.money(row.shipping);
  const orders = placed.map(({ order }) => order);
  const rows = orders.length === 0 ? [] : linesOf(tools, orders).map(asRow);
  for (const row of rows) reader.money(row.unit_price);
  return {
    customers: [customer],
    orders,
    lines: rows.map(lineOf),
    categoryOf: () => missing('a category'),
  };
}

/** The lines of some orders, with the columns an answer reads. */
function linesOf(tools: AgentTools, orders: readonly LedgerOrder[]): CodeRow[] {
  const ids = orders.map((order) => order.order_id);
  return tools.run(
    [
      `const ids = ${JSON.stringify(ids)};`,
      `csv.parse(files.read('data/order_lines.csv')).filter((row) => ids.includes(row.order_id)).map((row) => (${fieldsOf(LINE_FIELDS)}))`,
    ].join('\n'),
    (t) =>
      t
        .where('order_lines.csv', (row) => ids.includes(cell(row, 'order_id')))
        .map((row) => pick(row, LINE_FIELDS)),
  );
}

const LINE_FIELDS = ['order_id', 'sku', 'qty', 'unit_price'];

/** A customer found by email, with the email read back from however the export wrote it. */
function customerOf(reader: Reader, row: CsvRow) {
  return {
    customer_id: String(row.customer_id),
    email: reader.email(row.email),
    region: String(row.region) as Region,
  };
}

/**
 * The categories of the lines' products, from every product's row, and the old codes when one
 * of them uses one. A code is noted only when it hides a product of the category asked about.
 */
function categoriesOf(
  tools: AgentTools,
  reader: Reader,
  rows: readonly CsvRow[],
  everyProduct: readonly CodeRow[],
  asked: Category,
): Map<string, Category> {
  if (rows.length === 0) return new Map();
  const wanted = new Set(rows.map((row) => readSku(row.sku)));
  const products = everyProduct.map(asRow).filter((row) => wanted.has(readSku(row.sku)));
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
function orderOf(reader: Reader, row: CsvRow): LedgerOrder {
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
function lineOf(row: CsvRow): LedgerLine {
  return {
    order_id: String(row.order_id),
    sku: readSku(row.sku),
    qty: Number(row.qty),
    unit_price_cents: readMoney(row.unit_price),
  };
}

/** Every old category code and its category, fetched when a product carries one. */
function legacyCodes(tools: AgentTools): LegacyCode[] {
  return tools
    .run("csv.parse(files.read('data/category_map.csv'))", (t) =>
      t.where('category_map.csv', () => true),
    )
    .map((row) => ({ legacy_code: String(row.legacy_code), category: row.category as Category }));
}

function isCategoryName(cell: string | null | undefined): boolean {
  return CATEGORIES.some((category) => category === cell);
}

/** A row the agent's code fetched, with its empty cells null as the export reads them. */
function asRow(row: CodeRow): CsvRow {
  return Object.fromEntries(
    Object.entries(row).map(([column, cell]) => [column, cell === '' ? null : cell]),
  );
}

function onlyOne(rows: readonly CodeRow[], file: string): CsvRow {
  if (rows.length !== 1 || !rows[0]) throw new Error(`${rows.length} rows of ${file} match`);
  return asRow(rows[0]);
}

/** Some of a row's columns, in the order given. */
function pick(row: CodeRow, columns: readonly string[]): CodeRow {
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? '']));
}

/** The object the code builds from a row: these columns, in this order. */
function fieldsOf(columns: readonly string[]): string {
  return `{ ${columns.map((column) => `${column}: row.${column}`).join(', ')} }`;
}

function missing(what: string): never {
  throw new Error(`Missing ${what}`);
}
