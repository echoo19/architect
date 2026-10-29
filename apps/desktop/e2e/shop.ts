/*
 * A small shop's records as an export writes them, with the true values kept beside the text, so
 * a test can work out an answer from the truth and compare it with the one the app worked out
 * from the mess: region and status spelled several ways, amounts with signs and separators, N/A
 * where an amount is missing, and dates written in three styles.
 */

export interface ShopCustomer {
  id: string;
  email: string;
  region: string;
}

export interface ShopOrder {
  id: string;
  customerId: string;
  region: string;
  status: string;
  /** `null` where the export has no amount. */
  cents: number | null;
  /** `YYYY-MM-DD` */
  date: string;
}

export interface Shop {
  customers: ShopCustomer[];
  orders: ShopOrder[];
  customersCsv: string;
  ordersCsv: string;
}

const REGIONS = ['North', 'South', 'East', 'West'];
const STATUSES = ['Pending', 'Shipped', 'Cancelled'];
const NAMES = ['ada', 'ben', 'cho', 'dana', 'eli', 'fay', 'gus', 'hana', 'ivo', 'jun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function cell(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The same word spelled as an export might: as is, lowercase, uppercase or with spaces around it. */
function spelled(word: string, pick: number): string {
  return [word, word.toLowerCase(), word.toUpperCase(), ` ${word} `][pick % 4] ?? word;
}

function money(cents: number, style: number): string {
  const whole = Math.floor(cents / 100);
  const text = `${whole.toLocaleString('en-US')}.${pad(cents % 100)}`;
  return [text, `$${text}`, `${whole}.${pad(cents % 100)}`][style % 3] ?? text;
}

function written(day: string, style: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return (
    [day, `${month}/${date}/${year}`, `${MONTHS[month - 1]} ${date}, ${year}`][style % 3] ?? day
  );
}

function dayAt(offset: number): string {
  return new Date(Date.parse('2026-08-01T00:00:00Z') + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** 150 customers and 400 orders, the same every time. */
export function shop(): Shop {
  let state = 20_261_124;
  const next = (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;

  const customers: ShopCustomer[] = Array.from({ length: 150 }, (_, index) => ({
    id: `C-${1001 + index}`,
    email: `${pick(NAMES)}.${1001 + index}@example.com`,
    region: pick(REGIONS),
  }));
  const orders: ShopOrder[] = Array.from({ length: 400 }, (_, index) => ({
    id: `ORD-${10_001 + index}`,
    customerId: pick(customers).id,
    region: pick(REGIONS),
    status: pick(STATUSES),
    cents: next() < 0.04 ? null : Math.round((5 + next() * 1500) * 100),
    date: dayAt(Math.floor(next() * 117)),
  }));

  const customersCsv = [
    'customer_id,name,email,region',
    ...customers.map((customer, index) =>
      [customer.id, `Customer ${index + 1}`, customer.email, spelled(customer.region, index)]
        .map(cell)
        .join(','),
    ),
  ].join('\n');
  const ordersCsv = [
    'order_id,customer_id,region,status,amount,order_date',
    ...orders.map((order, index) =>
      [
        order.id,
        order.customerId,
        spelled(order.region, index + 1),
        spelled(order.status, index + 2),
        order.cents === null ? 'N/A' : money(order.cents, index),
        written(order.date, index),
      ]
        .map(cell)
        .join(','),
    ),
  ].join('\n');
  return { customers, orders, customersCsv: `${customersCsv}\n`, ordersCsv: `${ordersCsv}\n` };
}
