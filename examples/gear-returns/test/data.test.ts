import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED, buildJobFiles } from '../src';
import { parseCsv } from '../src/lib/csv';
import type { CsvRow } from '../src/lib/csv';
import { PLAIN_HEAD_ROWS, plainTables } from '../src/shop/exports';
import { BUSINESS_DATE, MESSY_TABLES, job } from './helpers';
import {
  carrierFromCsv,
  categoryOf,
  cents,
  decideFromCsv,
  emailOf,
  isoDate,
  skuOf,
} from './oracles';

const plain = Object.fromEntries(
  Object.entries(plainTables(buildJobFiles(DEFAULT_SEED).shop)).map(([name, text]) => [
    name,
    parseCsv(text),
  ]),
);

/** Each row's cells that the export wrote differently from their plain form, by column. */
function variantsOf(name: string): Map<number, string[]> {
  const written = job.table(name);
  const truth = plain[name] as CsvRow[];
  expect(written).toHaveLength(truth.length);
  const variants = new Map<number, string[]>();
  written.forEach((row, index) => {
    const columns = Object.keys(row).filter((column) => row[column] !== truth[index]?.[column]);
    if (columns.length > 0) variants.set(index, columns);
  });
  return variants;
}

/** What kind of value a column holds, for reading a variant back. */
const READ_BACK: Record<string, (cell: string | null) => string> = {
  email: emailOf,
  member_since: isoDate,
  sku: skuOf,
  category: (cell) => categoryOf(job, cell),
  list_price: (cell) => String(cents(cell)),
  unit_price: (cell) => String(cents(cell)),
  shipping: (cell) => String(cents(cell)),
  order_date: isoDate,
  shipped_on: isoDate,
  delivered_on: isoDate,
  decided_on: isoDate,
  pickup_from: isoDate,
  pickup_date: isoDate,
  booked_on: isoDate,
};

describe.each(MESSY_TABLES)('the export %s', (name) => {
  const variants = variantsOf(name);
  const rows = job.table(name);

  it('writes 15 to 25 percent of its rows with a value in another form', () => {
    const share = variants.size / rows.length;
    expect(share).toBeGreaterThanOrEqual(0.15);
    expect(share).toBeLessThanOrEqual(0.25);
  });

  it('keeps its first five rows plain, the rows a mentor is shown', () => {
    expect(PLAIN_HEAD_ROWS).toBe(5);
    for (let index = 0; index < 5; index++)
      expect(variants.has(index), `row ${index + 1}`).toBe(false);
  });

  it('spreads the other forms through the rest of the file', () => {
    const quarter = (rows.length - 5) / 4;
    const quarters = new Set(
      [...variants.keys()].map((index) => Math.floor((index - 5) / quarter)),
    );
    expect([...quarters].sort()).toEqual([0, 1, 2, 3]);
  });

  it('writes nothing that a careful reader cannot read back to the same value', () => {
    for (const [index, columns] of variants) {
      for (const column of columns) {
        const read = READ_BACK[column];
        if (!read) throw new Error(`${name} has a variant in ${column}, which has no other form`);
        const cell = rows[index]?.[column] ?? null;
        const truth = (plain[name] as CsvRow[])[index]?.[column] ?? null;
        const expected =
          column.endsWith('price') || column === 'shipping' ? String(cents(truth)) : truth;
        expect(read(cell), `${name} row ${index + 1} ${column}`).toBe(expected);
      }
    }
  });
});

describe('the forms values are written in', () => {
  const cells = (column: string) =>
    MESSY_TABLES.flatMap((name) =>
      job
        .table(name)
        .map((row) => row[column])
        .filter((cell): cell is string => typeof cell === 'string'),
    );
  const dateColumns = [
    'member_since',
    'order_date',
    'shipped_on',
    'delivered_on',
    'decided_on',
    'pickup_from',
    'pickup_date',
    'booked_on',
  ];
  const dates = dateColumns.flatMap(cells);
  const money = ['list_price', 'unit_price', 'shipping'].flatMap(cells);

  it('are the three date forms, and month-first only when the day cannot be a month', () => {
    const forms = { iso: 0, slash: 0, words: 0 };
    for (const date of dates) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) forms.iso += 1;
      else if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
        forms.slash += 1;
        expect(Number(date.slice(3, 5)), date).toBeGreaterThan(12);
      } else if (/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(date)) forms.words += 1;
      else throw new Error(`An unexpected date form: ${date}`);
    }
    expect(forms.slash).toBeGreaterThan(20);
    expect(forms.words).toBeGreaterThan(20);
  });

  it('are the four money forms', () => {
    const forms = { plain: 0, short: 0, symbol: 0, code: 0 };
    for (const amount of money) {
      if (/^\d+\.\d{2}$/.test(amount)) forms.plain += 1;
      else if (/^\d+(\.\d)?$/.test(amount)) forms.short += 1;
      else if (/^\$\d{1,3}(,\d{3})*\.\d{2}$/.test(amount)) forms.symbol += 1;
      else if (/^\d{1,3}(,\d{3})*\.\d{2} USD$/.test(amount)) forms.code += 1;
      else throw new Error(`An unexpected money form: ${amount}`);
    }
    expect(Math.min(forms.short, forms.symbol, forms.code)).toBeGreaterThan(10);
    expect(money.some((amount) => amount.includes(','))).toBe(true);
  });

  it('include old category codes that category_map.csv explains', () => {
    const codes = new Set(job.table('category_map.csv').map((row) => row.legacy_code));
    const used = job
      .table('products.csv')
      .map((row) => String(row.category))
      .filter((category) => codes.has(category));
    expect(used.length).toBeGreaterThanOrEqual(3);
    expect(job.table('category_map.csv').length).toBeLessThanOrEqual(12);
  });

  it('give every SKU and email one meaning: none is part of another', () => {
    const skus = job.table('products.csv').map((row) => skuOf(row.sku));
    expect(new Set(skus).size).toBe(skus.length);
    for (const sku of skus) expect(sku).toMatch(/^[A-Z]{2}-\d{4}$/);
    const emails = job.table('customers.csv').map((row) => emailOf(row.email));
    expect(new Set(emails).size).toBe(emails.length);
    for (const email of emails) {
      expect(
        emails.filter((other) => other.includes(email)),
        email,
      ).toEqual([email]);
    }
  });
});

describe('the records', () => {
  const idsOf = (name: string, column: string) =>
    new Set(job.table(name).map((row) => String(row[column])));

  it('have unique ids and refer only to records that exist', () => {
    for (const [name, column] of [
      ['customers.csv', 'customer_id'],
      ['orders.csv', 'order_id'],
      ['returns.csv', 'return_id'],
      ['pickups.csv', 'pickup_id'],
    ] as const) {
      expect(idsOf(name, column).size, name).toBe(job.table(name).length);
    }
    const skus = new Set(job.table('products.csv').map((row) => skuOf(row.sku)));
    const orders = idsOf('orders.csv', 'order_id');
    expect(
      job
        .table('orders.csv')
        .every((row) => idsOf('customers.csv', 'customer_id').has(String(row.customer_id))),
    ).toBe(true);
    for (const name of ['order_lines.csv', 'returns.csv']) {
      for (const row of job.table(name)) {
        expect(orders.has(String(row.order_id)), `${name} ${row.order_id}`).toBe(true);
        expect(skus.has(skuOf(row.sku)), `${name} ${row.sku}`).toBe(true);
      }
    }
    const returns = idsOf('returns.csv', 'return_id');
    expect(job.table('pickups.csv').every((row) => returns.has(String(row.return_id)))).toBe(true);
  });

  it('are a small shop: 160 customers, 64 products and a few hundred orders', () => {
    expect(job.table('customers.csv')).toHaveLength(160);
    expect(job.table('products.csv')).toHaveLength(64);
    expect(job.table('orders.csv').length).toBeGreaterThan(400);
    expect(job.table('orders.csv').length).toBeLessThan(700);
  });

  it('ship and deliver every order in order, never after today', () => {
    for (const row of job.table('orders.csv')) {
      const ordered = isoDate(row.order_date);
      if (row.shipped_on === null) {
        expect(row.delivered_on, String(row.order_id)).toBeNull();
        continue;
      }
      const shipped = isoDate(row.shipped_on);
      expect(shipped >= ordered && shipped <= BUSINESS_DATE, String(row.order_id)).toBe(true);
      if (row.delivered_on !== null) {
        const delivered = isoDate(row.delivered_on);
        expect(delivered > shipped && delivered <= BUSINESS_DATE, String(row.order_id)).toBe(true);
      }
    }
  });

  it('decided every past return by the policy, in the order they were decided', () => {
    const rows = job.table('returns.csv');
    rows.forEach((row, index) => {
      const decided = decideFromCsv(
        job,
        {
          order_id: String(row.order_id),
          sku: skuOf(row.sku),
          qty: Number(row.qty),
          condition: String(row.condition),
        },
        isoDate(row.decided_on),
        rows.slice(0, index),
      );
      expect(
        {
          decision: row.decision,
          item_cents: Number(row.item_cents),
          restocking_fee_cents: Number(row.restocking_fee_cents),
          return_shipping_cents: Number(row.return_shipping_cents),
          shipping_refund_cents: Number(row.shipping_refund_cents),
          refund_cents: Number(row.refund_cents),
          refund_to: row.refund_to,
        },
        String(row.return_id),
      ).toEqual(decided);
      if (index > 0)
        expect(isoDate(row.decided_on) >= isoDate(rows[index - 1]?.decided_on)).toBe(true);
      expect(isoDate(row.decided_on) < BUSINESS_DATE).toBe(true);
    });
  });

  it('only send approved returns back by carrier, and book pickups by the rules', () => {
    const returns = new Map(job.table('returns.csv').map((row) => [row.return_id, row]));
    const perDay = new Map<string, number>();
    for (const row of job.table('returns.csv')) {
      if (row.pickup_from !== null) expect(row.decision, String(row.return_id)).toBe('approved');
    }
    for (const pickup of job.table('pickups.csv')) {
      const record = returns.get(pickup.return_id) as CsvRow;
      const date = isoDate(pickup.pickup_date);
      expect(pickup.pickup_id).toBe(String(pickup.return_id).replace('RT-', 'PU-'));
      expect(record.pickup_from, String(pickup.pickup_id)).not.toBeNull();
      expect(pickup.carrier, String(pickup.pickup_id)).toBe(carrierFromCsv(job, record));
      expect(date > isoDate(pickup.booked_on)).toBe(true);
      expect(date >= isoDate(record.pickup_from)).toBe(true);
      expect(date).not.toBe('2026-11-26');
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const days = {
        'Cedarline Parcel': [1, 2, 4, 5],
        'Kettlepoint Courier': [1, 3, 5, 6],
        'Basalt Freight': [2, 4],
      };
      expect(days[pickup.carrier as keyof typeof days], String(pickup.pickup_id)).toContain(
        weekday,
      );
      const key = `${pickup.carrier} ${date}`;
      perDay.set(key, (perDay.get(key) ?? 0) + 1);
    }
    expect(Math.max(...perDay.values())).toBe(3);
  });
});
