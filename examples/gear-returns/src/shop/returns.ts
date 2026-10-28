import { addDays, datesFrom, weekdayOf } from '../lib/calendar';
import { compareText, findOne } from '../lib/compare';
import type { Random } from '../lib/random';
import { BUSINESS_DATE, CARRIERS, pickupIdFor } from '../policy/rules';
import { carrierFor, earliestPickup } from '../reference/pickups';
import { decideReturn } from '../reference/refunds';
import type { ReturnFacts } from '../reference/refunds';
import type {
  Carrier,
  Condition,
  Customer,
  Order,
  OrderLine,
  Pickup,
  Product,
  ReturnRecord,
} from './types';

/** Returns decided from this day on were approved in the last two weeks; some await a pickup. */
const RECENT_FROM = '2026-11-12';
const LAST_DECIDED = addDays(BUSINESS_DATE, -1);
const RECENT_APPROVED = 150;
const RECENT_BOOKED = 36;
/** Days the recent bookings crowd onto, so some carrier days are already full. */
const BUSY_FROM = '2026-11-25';
const BUSY_TO = '2026-12-09';
const LATEST_READY = '2026-12-23';
/** When the desk books pickups during the day. */
const BOOKING_TIMES = ['09:10', '10:25', '11:40', '13:05', '14:30', '15:45', '16:20'];

interface Draft {
  order: Order;
  line: OrderLine;
  qty: number;
  condition: Condition;
  decided_on: string;
  recent: boolean;
}

export interface ReturnHistory {
  returns: ReturnRecord[];
  pickups: Pickup[];
  /** Approved returns that still need a pickup, oldest first. */
  awaitingPickup: string[];
}

interface Lookups {
  orderOf(id: string): Order;
  productOf(sku: string): Product;
  customerOf(id: string): Customer;
}

/**
 * Every return decided before today, by the rules in policy.md as they applied on its day, and
 * the carrier pickups booked for the ones customers sent back. Most are history; about a hundred
 * were approved in the last two weeks, and some of those still wait for a pickup.
 */
export function buildReturns(
  random: Random,
  customers: readonly Customer[],
  products: readonly Product[],
  orders: readonly Order[],
  lines: readonly OrderLine[],
): ReturnHistory {
  const byOrder = new Map(orders.map((order) => [order.order_id, order]));
  const lookups: Lookups = {
    orderOf: (id) => findOne(orders, (order) => order.order_id === id, id),
    productOf: (sku) => findOne(products, (product) => product.sku === sku, sku),
    customerOf: (id) => findOne(customers, (customer) => customer.customer_id === id, id),
  };
  const delivered = lines.filter((line) => byOrder.get(line.order_id)?.delivered_on);
  const drafts = [
    ...pastDrafts(random.fork('past'), delivered, lookups),
    ...recentDrafts(random.fork('recent'), delivered, lookups),
  ].sort(
    (a, b) =>
      compareText(a.decided_on, b.decided_on) ||
      compareText(a.order.order_id, b.order.order_id) ||
      compareText(a.line.sku, b.line.sku),
  );

  const decided: Decided[] = [];
  for (const draft of drafts) {
    const amounts = decideReturn(factsOf(draft, decided, lookups));
    // A recent request that turns out denied never reached the log: only approvals were drafted.
    if (draft.recent && amounts.decision === 'denied') continue;
    decided.push({
      order_id: draft.order.order_id,
      sku: draft.line.sku,
      qty: draft.qty,
      condition: draft.condition,
      decided_on: draft.decided_on,
      ...amounts,
    });
  }
  const returns = decided.map((record, index) => ({ return_id: `RT-${4001 + index}`, ...record }));
  return bookPickups(random.fork('pickups'), returns, lookups);
}

/** A decided return before it is known whether it goes back by carrier. */
type Decided = Omit<ReturnRecord, 'return_id' | 'pickup_from'>;

/** Facts for a draft as of its day, counting only the returns decided before it. */
function factsOf(draft: Draft, earlier: readonly Decided[], lookups: Lookups): ReturnFacts {
  const product = lookups.productOf(draft.line.sku);
  const sameOrder = earlier.filter(
    (record) => record.order_id === draft.order.order_id && record.decision === 'approved',
  );
  return {
    qty: draft.qty,
    condition: draft.condition,
    decided_on: draft.decided_on,
    line_qty: draft.line.qty,
    unit_price_cents: draft.line.unit_price_cents,
    category: product.category,
    final_sale: product.final_sale,
    order_date: draft.order.order_date,
    delivered_on: draft.order.delivered_on as string,
    shipping_cents: draft.order.shipping_cents,
    payment: draft.order.payment,
    member_since: lookups.customerOf(draft.order.customer_id).member_since,
    approved_before: sameOrder
      .filter((record) => record.sku === draft.line.sku)
      .reduce((total, record) => total + record.qty, 0),
    shipping_refunded_before: sameOrder.some((record) => record.shipping_refund_cents > 0),
  };
}

/** Requests over the months: mostly soon after delivery, some late, a few for too many units. */
function pastDrafts(random: Random, delivered: readonly OrderLine[], lookups: Lookups): Draft[] {
  const drafts: Draft[] = [];
  const latest = addDays(RECENT_FROM, -1);
  for (const line of delivered) {
    if (!random.chance(0.12)) continue;
    const order = lookups.orderOf(line.order_id);
    const after = random.weighted([
      [random.int(1, 14), 55],
      [random.int(15, 30), 25],
      [random.int(31, 62), 12],
      [random.int(63, 100), 8],
    ]);
    const decided_on = addDays(order.delivered_on as string, after);
    if (decided_on > latest) continue;
    const condition = randomCondition(random, [40, 42, 18]);
    const qty = random.chance(0.05) ? line.qty + 1 : random.int(1, line.qty);
    drafts.push({ order, line, qty, condition, decided_on, recent: false });
    // A second request on the same line, or another defective item from the same order.
    const later = addDays(decided_on, random.int(1, 20));
    if (line.qty >= 2 && random.chance(0.3) && later <= latest) {
      drafts.push({ order, line, qty: 1, condition, decided_on: later, recent: false });
    }
  }
  return drafts;
}

/**
 * Requests decided in the last two weeks that the rules approve, one per line, drawn from lines
 * delivered recently enough. Each is checked on its own here; the decision that counts is made
 * later, in date order with every earlier return.
 */
function recentDrafts(random: Random, delivered: readonly OrderLine[], lookups: Lookups): Draft[] {
  const drafts: Draft[] = [];
  const firstDelivery = addDays(RECENT_FROM, -85);
  for (const line of random.shuffle(delivered)) {
    if (drafts.length === RECENT_APPROVED) break;
    const order = lookups.orderOf(line.order_id);
    const deliveredOn = order.delivered_on as string;
    if (deliveredOn < firstDelivery || deliveredOn >= LAST_DECIDED) continue;
    const from = deliveredOn >= RECENT_FROM ? addDays(deliveredOn, 1) : RECENT_FROM;
    const draft: Draft = {
      order,
      line,
      qty: random.chance(0.85) ? 1 : line.qty,
      condition: randomCondition(random, [50, 38, 12]),
      decided_on: random.pick(datesFrom(from, LAST_DECIDED)),
      recent: true,
    };
    if (decideReturn(factsOf(draft, [], lookups)).decision === 'approved') drafts.push(draft);
  }
  return drafts;
}

function randomCondition(random: Random, weights: readonly [number, number, number]): Condition {
  return random.weighted([
    ['unopened', weights[0]],
    ['opened', weights[1]],
    ['defective', weights[2]],
  ]);
}

/**
 * Which approved returns go back by carrier, the day each customer can hand the parcel over, and
 * the pickups booked for them by the rules in policy.md on the day each return was decided.
 * Older ones were collected long ago. Every recent one goes by carrier: some are booked onto the
 * next few weeks, crowding a few busy days, and the rest still wait for a pickup.
 */
function bookPickups(
  random: Random,
  decided: readonly (Decided & { return_id: string })[],
  lookups: Lookups,
): ReturnHistory {
  const recent = decided.filter(
    (record) => record.decision === 'approved' && record.decided_on >= RECENT_FROM,
  );
  const booked = new Set(random.sample(recent, RECENT_BOOKED).map((record) => record.return_id));
  const busyDays = new Map(
    (Object.keys(CARRIERS) as Carrier[]).map((carrier) => [
      carrier,
      random.sample(
        datesFrom(BUSY_FROM, BUSY_TO).filter((date) =>
          CARRIERS[carrier].days.includes(weekdayOf(date)),
        ),
        carrier === 'Basalt Freight' ? 1 : 2,
      ),
    ]),
  );
  // Customers still waiting name days spread over the coming weeks, most of them a day their
  // carrier comes; a few can hand the parcel over at once.
  const carrierDays = new Map(
    (Object.keys(CARRIERS) as Carrier[]).map((carrier) => [
      carrier,
      random.shuffle(
        datesFrom(BUSY_FROM, LATEST_READY).filter((date) =>
          CARRIERS[carrier].days.includes(weekdayOf(date)),
        ),
      ),
    ]),
  );
  const named = new Map<Carrier, number>();
  const counts = new Map<string, number>();
  const returns: ReturnRecord[] = [];
  const pickups: Pickup[] = [];
  const awaitingPickup: string[] = [];

  for (const record of decided) {
    const isRecent = record.decided_on >= RECENT_FROM;
    const byCarrier = record.decision === 'approved' && (isRecent || random.chance(0.55));
    if (!byCarrier) {
      returns.push({ ...record, pickup_from: null });
      continue;
    }
    const order = lookups.orderOf(record.order_id);
    const carrier = carrierFor(
      lookups.customerOf(order.customer_id).region,
      lookups.productOf(record.sku).bulky,
    );
    const soon = addDays(record.decided_on, random.int(1, 3));
    if (isRecent && !booked.has(record.return_id)) {
      const days = carrierDays.get(carrier) ?? [];
      const turn = named.get(carrier) ?? 0;
      named.set(carrier, turn + 1);
      const roll = random.next();
      const pickup_from =
        roll < 0.08
          ? soon
          : roll < 0.3
            ? random.pick(datesFrom(BUSY_FROM, LATEST_READY))
            : (days[turn % days.length] as string);
      awaitingPickup.push(record.return_id);
      returns.push({ ...record, pickup_from });
      continue;
    }
    const busy = busyDays.get(carrier) ?? [];
    const pickup_from = !isRecent
      ? soon
      : random.chance(0.4)
        ? random.pick(busy)
        : random.pick(datesFrom(BUSY_FROM, LATEST_READY));
    const pickup_date = earliestPickup({
      carrier,
      today: record.decided_on,
      bookedAt: random.pick(BOOKING_TIMES),
      readyFrom: pickup_from,
      bookedOn: (date) => counts.get(`${carrier} ${date}`) ?? 0,
    });
    counts.set(`${carrier} ${pickup_date}`, (counts.get(`${carrier} ${pickup_date}`) ?? 0) + 1);
    returns.push({ ...record, pickup_from });
    pickups.push({
      pickup_id: pickupIdFor(record.return_id),
      return_id: record.return_id,
      carrier,
      pickup_date,
      booked_on: record.decided_on,
    });
  }
  return { returns, pickups, awaitingPickup };
}
