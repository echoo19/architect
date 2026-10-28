import { addDays, datesFrom, daysBetween, weekdayOf } from '../lib/calendar';
import { roundHalfUp, sum } from '../lib/money';
import type { Random } from '../lib/random';
import { BUSINESS_DATE } from '../policy/rules';
import type { CustomerBase } from './customers';
import type { Order, OrderLine, Product } from './types';

/** The records start when the shop moved its web orders to the current system. */
export const HISTORY_START = '2026-05-04';

const FREE_SHIPPING_FROM_CENTS = 14900;
const STANDARD_SHIPPING_CENTS = 795;
const EXPRESS_SHIPPING_CENTS = 1450;

/** Chance an order placed this many days ago has shipped, for the last few days. */
const SHIPPED_BY_AGE = [0, 0.15, 0.35, 0.55, 0.75, 0.9];
/** Orders this recent can still be waiting on a backordered item. */
const BACKORDER_DAYS = 60;

export interface OrderHistory {
  orders: Order[];
  lines: OrderLine[];
}

/** Every web order since HISTORY_START, numbered in date order from ORD-10001. */
export function buildOrders(
  random: Random,
  base: CustomerBase,
  products: readonly Product[],
  weights: ReadonlyMap<string, number>,
): OrderHistory {
  const buyers = base.customers.map(
    (customer) => [customer, base.activity.get(customer.customer_id) ?? 1] as const,
  );
  const catalog = products.map((product) => [product, weights.get(product.sku) ?? 1] as const);
  const orders: Order[] = [];
  const lines: OrderLine[] = [];

  for (const date of datesFrom(HISTORY_START, BUSINESS_DATE)) {
    const weekend = weekdayOf(date) === 'Sat' || weekdayOf(date) === 'Sun';
    const count =
      date === BUSINESS_DATE ? random.int(1, 3) : weekend ? random.int(1, 4) : random.int(2, 4);
    for (let i = 0; i < count; i++) {
      const order_id = `ORD-${10001 + orders.length}`;
      const customer = random.weighted(buyers);
      const items = pickItems(random, catalog);
      const orderLines = items.map((product) => ({
        order_id,
        sku: product.sku,
        qty: random.weighted(
          product.list_price_cents < 4000
            ? [
                [1, 70],
                [2, 22],
                [3, 8],
              ]
            : [
                [1, 92],
                [2, 8],
              ],
        ),
        unit_price_cents: pricePaid(random, product),
      }));
      const subtotal = sum(orderLines.map((line) => line.qty * line.unit_price_cents));
      const shipping_cents = random.chance(0.09)
        ? EXPRESS_SHIPPING_CENTS
        : subtotal >= FREE_SHIPPING_FROM_CENTS
          ? 0
          : STANDARD_SHIPPING_CENTS;
      const shipped_on = shipDate(random, date);
      const arrives = shipped_on === null ? null : addDays(shipped_on, random.int(2, 6));
      orders.push({
        order_id,
        customer_id: customer.customer_id,
        order_date: date,
        shipped_on,
        delivered_on: arrives !== null && arrives <= BUSINESS_DATE ? arrives : null,
        shipping_cents,
        payment: random.chance(0.12) ? 'gift_card' : 'card',
      });
      lines.push(...orderLines);
    }
  }
  return { orders, lines };
}

/** One to four different products, popular ones more often. */
function pickItems(random: Random, catalog: readonly (readonly [Product, number])[]): Product[] {
  const count = random.weighted([
    [1, 50],
    [2, 30],
    [3, 15],
    [4, 5],
  ]);
  const items: Product[] = [];
  while (items.length < count) {
    const product = random.weighted(catalog);
    if (!items.includes(product)) items.push(product);
  }
  return items;
}

/** Most lines sell at the list price; about a quarter at 10 to 30 percent off. */
function pricePaid(random: Random, product: Product): number {
  if (!random.chance(0.24)) return product.list_price_cents;
  const off = random.pick([10, 15, 20, 25, 30]);
  return roundHalfUp(product.list_price_cents * (100 - off), 100);
}

/** When the order shipped, or null while it waits: the last few days, or a backorder. */
function shipDate(random: Random, ordered: string): string | null {
  const age = daysBetween(ordered, BUSINESS_DATE);
  if (age <= BACKORDER_DAYS && random.chance(0.12)) return null;
  const chance = SHIPPED_BY_AGE[age] ?? 1;
  if (!random.chance(chance)) return null;
  const delay = random.weighted([
    [0, 30],
    [1, 40],
    [2, 20],
    [3, 10],
  ]);
  return addDays(ordered, Math.min(delay, age));
}
