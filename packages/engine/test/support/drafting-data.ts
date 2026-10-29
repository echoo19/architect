import { seededRandom } from '../../src/splits/random';

/*
 * A small shop's records as an export would write them, with the true values kept beside the
 * text, so a test can work out an answer from the truth and compare it with the one Architect
 * worked out from the mess.
 */

export const REGIONS = ['North', 'South', 'East', 'West'] as const;
export const STATUSES = ['Pending', 'Shipped', 'Cancelled'] as const;

export interface ShopOrder {
  id: string;
  customerId: string;
  region: (typeof REGIONS)[number];
  status: (typeof STATUSES)[number];
  /** The amount in cents, or null where the export has none. */
  cents: number | null;
  /** `YYYY-MM-DD` */
  date: string;
  shipped: string | null;
}

export interface ShopCustomer {
  id: string;
  name: string;
  email: string;
  region: (typeof REGIONS)[number];
  since: string | null;
}

export interface ShopData {
  orders: ShopOrder[];
  customers: ShopCustomer[];
  ordersCsv: string;
  customersCsv: string;
}

const FIRST = ['Ada', 'Ben', 'Cho', 'Dana', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivo', 'Jun'];
const LAST = ['Park', 'Ruiz', 'Lin', 'Okafor', 'Novak', 'Quinn', 'Silva', 'Tran', 'Vance', 'Wu'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function csvCell(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** The same word as a messy export spells it: as is, lowercase, uppercase, spaced or quoted. */
function spelled(word: string, pick: number): string {
  switch (pick % 6) {
    case 1:
      return word.toLowerCase();
    case 2:
      return word.toUpperCase();
    case 3:
      return ` ${word} `;
    case 4:
      return `"${word}"`;
    default:
      return word;
  }
}

function money(cents: number, style: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = pad(absolute % 100);
  const grouped = whole.toLocaleString('en-US');
  switch (style % 5) {
    case 1:
      return negative ? `(${grouped}.${fraction})` : `$${grouped}.${fraction}`;
    case 2:
      return `${negative ? '-' : ''}${whole}.${fraction}`;
    case 3:
      return `${negative ? '-' : ''}$ ${grouped}.${fraction}`;
    default:
      return `${negative ? '-' : ''}${grouped}.${fraction}`;
  }
}

/** A day written one of several ways; slash dates are month first, and some have a day over 12. */
function written(day: string, style: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  switch (style % 4) {
    case 1:
      return `${month}/${date}/${year}`;
    case 2:
      return `${MONTHS[month - 1]} ${date}, ${year}`;
    case 3:
      return `${day} 09:30`;
    default:
      return day;
  }
}

/** The days from `from` for `count` days, as ISO text. */
function dayAt(from: string, offset: number): string {
  return new Date(Date.parse(`${from}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
}

export function shopData(seed: string, orderCount = 400, customerCount = 150): ShopData {
  const random = seededRandom(seed);
  const choose = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;

  const customers: ShopCustomer[] = Array.from({ length: customerCount }, (_, index) => {
    const first = choose(FIRST);
    const last = choose(LAST);
    return {
      id: `C-${1001 + index}`,
      name: `${first} ${last}`,
      email: `${first}.${last}.${1001 + index}@example.com`.toLowerCase(),
      region: choose(REGIONS),
      since: random() < 0.3 ? null : dayAt('2024-01-01', Math.floor(random() * 900)),
    };
  });

  const orders: ShopOrder[] = Array.from({ length: orderCount }, (_, index) => {
    const status = choose(STATUSES);
    const date = dayAt('2026-08-01', Math.floor(random() * 117));
    const refund = random() < 0.06;
    const missing = random() < 0.04;
    return {
      id: `ORD-${10_001 + index}`,
      customerId: choose(customers).id,
      region: choose(REGIONS),
      status,
      cents: missing ? null : Math.round((5 + random() * 1500) * 100) * (refund ? -1 : 1),
      date,
      shipped: status === 'Shipped' ? dayAt(date, 1 + Math.floor(random() * 4)) : null,
    };
  });

  const ordersCsv = [
    'order_id,customer_id,region,status,amount,order_date,shipped_on',
    ...orders.map((order, index) =>
      [
        order.id,
        order.customerId,
        spelled(order.region, index + Math.floor(random() * 6)),
        spelled(order.status, index + Math.floor(random() * 6)),
        order.cents === null ? (index % 2 === 0 ? 'N/A' : '') : money(order.cents, index),
        written(order.date, index + Math.floor(random() * 4)),
        order.shipped === null ? '' : order.shipped,
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\n');

  const customersCsv = [
    'customer_id,name,email,region,member_since',
    ...customers.map((customer, index) =>
      [
        customer.id,
        spelled(customer.name, index % 7 === 0 ? 3 : 0),
        customer.email,
        spelled(customer.region, index),
        customer.since ?? (index % 2 === 0 ? 'N/A' : ''),
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\n');

  return { orders, customers, ordersCsv: `${ordersCsv}\n`, customersCsv: `${customersCsv}\n` };
}
