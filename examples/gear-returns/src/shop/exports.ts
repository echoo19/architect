import { MONTH_NAMES } from '../lib/calendar';
import { toCsv } from '../lib/csv';
import type { CsvCell } from '../lib/csv';
import { plainDollars } from '../lib/money';
import type { Random } from '../lib/random';
import type {
  Customer,
  LegacyCode,
  Order,
  OrderLine,
  Pickup,
  Product,
  ReturnRecord,
  Shop,
} from './types';

/**
 * How the shop's systems wrote each table. Every value has a plain form (dates YYYY-MM-DD, money
 * as dollars with two decimals, SKUs in capitals, emails in lower case, categories by name). The
 * exports this job ships came from different systems over the years, so in about a fifth of the
 * rows of each table some values are written another way that still means the same thing. The
 * first rows of every file are plain, and the others are spread through the rest.
 */

/** The ways a value can be written differently. */
export type VariantKind = 'date' | 'money' | 'sku' | 'email' | 'category';

/** Rows at the top of every file are always plain. */
export const PLAIN_HEAD_ROWS = 5;

interface Column<Row> {
  name: string;
  plain(row: Row): CsvCell;
  /**
   * Writes the value another way, or returns null when this value has no other way. In a row
   * written differently, a column with more weight is the likelier one to differ (default 1).
   */
  variant?: { kind: VariantKind; weight?: number; write(row: Row, random: Random): string | null };
}

interface Layout<Row> {
  file: string;
  columns: readonly Column<Row>[];
}

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

function column<Row>(name: string, plain: (row: Row) => CsvCell): Column<Row> {
  return { name, plain };
}

function dateColumn<Row>(
  name: string,
  value: (row: Row) => string | null,
  weight = 1,
): Column<Row> {
  return {
    name,
    plain: value,
    variant: { kind: 'date', weight, write: (row, random) => otherDate(value(row), random) },
  };
}

function moneyColumn<Row>(name: string, cents: (row: Row) => number): Column<Row> {
  return {
    name,
    plain: (row) => plainDollars(cents(row)),
    variant: { kind: 'money', write: (row, random) => otherMoney(cents(row), random) },
  };
}

function skuColumn<Row extends { sku: string }>(): Column<Row> {
  return {
    name: 'sku',
    plain: (row) => row.sku,
    variant: { kind: 'sku', write: (row, random) => otherSku(row.sku, random) },
  };
}

const CUSTOMERS: Layout<Customer> = {
  file: 'customers.csv',
  columns: [
    column('customer_id', (c) => c.customer_id),
    column('name', (c) => c.name),
    {
      name: 'email',
      plain: (c) => c.email,
      variant: { kind: 'email', weight: 2, write: (c, random) => otherEmail(c.email, random) },
    },
    column('region', (c) => c.region),
    dateColumn('member_since', (c) => c.member_since),
  ],
};

/** `codes` are the old category codes still in use, by category. */
function productsLayout(codes: readonly LegacyCode[]): Layout<Product> {
  return {
    file: 'products.csv',
    columns: [
      skuColumn(),
      column('name', (p) => p.name),
      {
        name: 'category',
        plain: (p) => p.category,
        variant: {
          kind: 'category',
          write: (p, random) => {
            const old = codes.filter((code) => code.category === p.category);
            return old.length === 0 ? null : random.pick(old).legacy_code;
          },
        },
      },
      moneyColumn('list_price', (p) => p.list_price_cents),
      column('final_sale', (p) => yesNo(p.final_sale)),
      column('bulky', (p) => yesNo(p.bulky)),
    ],
  };
}

const CATEGORY_MAP: Layout<LegacyCode> = {
  file: 'category_map.csv',
  columns: [column('legacy_code', (c) => c.legacy_code), column('category', (c) => c.category)],
};

const ORDERS: Layout<Order> = {
  file: 'orders.csv',
  columns: [
    column('order_id', (o) => o.order_id),
    column('customer_id', (o) => o.customer_id),
    dateColumn('order_date', (o) => o.order_date),
    dateColumn('shipped_on', (o) => o.shipped_on),
    dateColumn('delivered_on', (o) => o.delivered_on),
    moneyColumn('shipping', (o) => o.shipping_cents),
    column('payment', (o) => o.payment),
  ],
};

const ORDER_LINES: Layout<OrderLine> = {
  file: 'order_lines.csv',
  columns: [
    column('order_id', (l) => l.order_id),
    skuColumn(),
    column('qty', (l) => l.qty),
    moneyColumn('unit_price', (l) => l.unit_price_cents),
  ],
};

const RETURNS: Layout<ReturnRecord> = {
  file: 'returns.csv',
  columns: [
    column('return_id', (r) => r.return_id),
    column('order_id', (r) => r.order_id),
    skuColumn(),
    column('qty', (r) => r.qty),
    column('condition', (r) => r.condition),
    dateColumn('decided_on', (r) => r.decided_on),
    column('decision', (r) => r.decision),
    column('item_cents', (r) => r.item_cents),
    column('restocking_fee_cents', (r) => r.restocking_fee_cents),
    column('return_shipping_cents', (r) => r.return_shipping_cents),
    column('shipping_refund_cents', (r) => r.shipping_refund_cents),
    column('refund_cents', (r) => r.refund_cents),
    column('refund_to', (r) => r.refund_to),
    dateColumn('pickup_from', (r) => r.pickup_from, 3),
  ],
};

const PICKUPS: Layout<Pickup> = {
  file: 'pickups.csv',
  columns: [
    column('pickup_id', (p) => p.pickup_id),
    column('return_id', (p) => p.return_id),
    column('carrier', (p) => p.carrier),
    dateColumn('pickup_date', (p) => p.pickup_date, 3),
    dateColumn('booked_on', (p) => p.booked_on),
  ],
};

/** Every table as CSV text, by file name, in the order job.json lists them. */
export function exportTables(shop: Shop, random: Random): Record<string, string> {
  return renderAll(shop, (layout, rows) => render(layout, rows, random.fork(layout.file)));
}

/** The same tables with every value in its plain form, the way no export wrote them. */
export function plainTables(shop: Shop): Record<string, string> {
  return renderAll(shop, (layout, rows) => render(layout, rows, null));
}

function renderAll(
  shop: Shop,
  write: <Row>(layout: Layout<Row>, rows: readonly Row[]) => string,
): Record<string, string> {
  return {
    'customers.csv': write(CUSTOMERS, shop.customers),
    'products.csv': write(productsLayout(shop.legacyCodes), shop.products),
    // The key to the old codes is kept by hand, so it is written plainly.
    'category_map.csv': write(CATEGORY_MAP, shop.legacyCodes),
    'orders.csv': write(ORDERS, shop.orders),
    'order_lines.csv': write(ORDER_LINES, shop.lines),
    'returns.csv': write(RETURNS, shop.returns),
    'pickups.csv': write(PICKUPS, shop.pickups),
  };
}

/**
 * Writes the rows, with a share of 17 to 23 percent of them (never the first few) written with
 * one value, now and then two, in another form. With no random stream every value is plain.
 */
function render<Row>(layout: Layout<Row>, rows: readonly Row[], random: Random | null): string {
  const cells = rows.map((row) => layout.columns.map((c) => c.plain(row)));
  const varying = layout.columns.filter((c) => c.variant !== undefined);
  if (random !== null && varying.length > 0) {
    const wanted = Math.round(rows.length * (0.17 + 0.06 * random.next()));
    const candidates = random.shuffle(
      rows.map((_, index) => index).filter((index) => index >= PLAIN_HEAD_ROWS),
    );
    let varied = 0;
    for (const index of candidates) {
      if (varied === wanted) break;
      const row = rows[index] as Row;
      const options = weightedOrder(random, varying);
      const count = options.length > 1 && random.chance(0.2) ? 2 : 1;
      let changed = 0;
      for (const option of options) {
        if (changed === count) break;
        const text = option.variant?.write(row, random) ?? null;
        if (text === null) continue;
        const at = layout.columns.indexOf(option);
        (cells[index] as CsvCell[])[at] = text;
        changed += 1;
      }
      if (changed > 0) varied += 1;
    }
  }
  return toCsv(
    layout.columns.map((c) => c.name),
    cells,
  );
}

/** The columns in a random order where weightier ones tend to come first. */
function weightedOrder<Row>(random: Random, columns: readonly Column<Row>[]): Column<Row>[] {
  const left = [...columns];
  const order: Column<Row>[] = [];
  while (left.length > 0) {
    const next = random.weighted(left.map((c) => [c, c.variant?.weight ?? 1] as const));
    order.push(next);
    left.splice(left.indexOf(next), 1);
  }
  return order;
}

/** A date written month first with slashes (only when the day can't be read as a month) or in words. */
function otherDate(date: string | null, random: Random): string | null {
  if (date === null) return null;
  const [year, month, day] = date.split('-') as [string, string, string];
  const words = `${MONTH_NAMES[Number(month) - 1]?.slice(0, 3)} ${Number(day)}, ${year}`;
  if (Number(day) <= 12) return words;
  return random.chance(0.5) ? `${month}/${day}/${year}` : words;
}

/** Dollars without trailing zeros, with a dollar sign and separators, or with the currency code. */
function otherMoney(cents: number, random: Random): string {
  const [whole, fraction] = plainDollars(cents).split('.') as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const styles = [`$${grouped}.${fraction}`, `${grouped}.${fraction} USD`];
  if (fraction.endsWith('0')) {
    styles.push(fraction === '00' ? whole : `${whole}.${fraction.slice(0, 1)}`);
  }
  return random.pick(styles);
}

/** A SKU in lower or mixed case, or with a stray space before or after it. */
function otherSku(sku: string, random: Random): string {
  const styles = [
    sku.toLowerCase(),
    `${sku.slice(0, 1)}${sku.slice(1).toLowerCase()}`,
    ` ${sku}`,
    `${sku} `,
    ` ${sku.toLowerCase()}`,
  ];
  return random.pick(styles);
}

/** An email with capitals, or with a stray space before or after it. */
function otherEmail(email: string, random: Random): string {
  const [local, domain] = email.split('@') as [string, string];
  const capitalized = local
    .split('.')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('.');
  const styles = [`${capitalized}@${domain}`, email.toUpperCase(), ` ${email}`, `${email} `];
  return random.pick(styles);
}
