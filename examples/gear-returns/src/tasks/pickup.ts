import type { Task } from '@architect/shared';
import { addDays, datesFrom, weekdayOf } from '../lib/calendar';
import { compareText } from '../lib/compare';
import type { Random } from '../lib/random';
import {
  BUSINESS_DATE,
  CARRIERS,
  HOLIDAY,
  PICKUP_CAPACITY,
  PICKUP_CUTOFF,
  pickupIdFor,
} from '../policy/rules';
import { carrierFor, earliestPickup, firstPickupDate } from '../reference/pickups';
import type { PickupRequest as PickupRules } from '../reference/pickups';
import { solvePickup } from '../reference/solver';
import type { PickupRequest } from '../reference/solver';
import { DeskTools } from '../reference/tools';
import type { JobData, Row } from '../reference/tools';
import type { ShopIndex } from '../shop/records';
import type { Carrier, ReturnRecord } from '../shop/types';
import { TODAY, withAnswerLine } from './prompts';
import { difficultyOf, pickMix, taskId } from './select';
import type { Candidate, Quota } from './select';

const QUOTA: Quota = { easy: 6, medium: 30, hard: 24 };

const ANSWER_SHAPE = '{"pickup_id": "<id>", "carrier": "<carrier>", "pickup_date": "<YYYY-MM-DD>"}';

/** When the desk books pickups, with the minutes either side of the cutoff among them. */
const BOOKING_TIMES = [
  '08:50',
  '09:35',
  '10:40',
  '11:15',
  '12:30',
  '13:20',
  '13:55',
  '14:00',
  '14:05',
  '14:45',
  '15:30',
  '16:10',
];
const CUTOFF_EDGE = ['13:55', '14:00', '14:05'];

interface PickupCase {
  record: ReturnRecord;
  request: PickupRequest;
  carrier: Carrier;
  pickupDate: string;
  rules: PickupRules;
}

/**
 * One pickup per approved return still waiting for one, booked at some time of day. The day the
 * customer can hand the parcel over is on the return's row, so the answers spread over the next
 * weeks, and the time decides whether tomorrow is still possible.
 */
export function buildPickupTasks(
  random: Random,
  index: ShopIndex,
  data: JobData,
  awaiting: readonly string[],
): Task[] {
  const booked = new Map<string, number>();
  for (const pickup of index.shop.pickups) {
    const key = `${pickup.carrier} ${pickup.pickup_date}`;
    booked.set(key, (booked.get(key) ?? 0) + 1);
  }
  const carelessCounts = isoOnlyCounts(data);
  const exported = new Map(
    (data.tables.get('returns.csv')?.rows ?? []).map((row) => [row.return_id, row]),
  );
  // Products whose SKU an export wrote another way, so an exact lookup misses them.
  const oddSkus = new Set(
    (data.tables.get('products.csv')?.rows ?? [])
      .filter((row) => !/^[A-Z]{2}-\d{4}$/.test(row.sku ?? ''))
      .map((row) => String(row.sku).trim().toUpperCase()),
  );
  const candidates = awaiting.flatMap((id) => {
    const record = index.shop.returns.find((candidate) => candidate.return_id === id);
    const row = exported.get(id);
    if (!record || !row) throw new Error(`No return ${id}`);
    const messySku = row.sku !== record.sku || oddSkus.has(record.sku);
    return candidatesFor(random, index, record, row, booked, carelessCounts, messySku);
  });
  const has = (trap: string) => (c: Candidate<PickupCase>) => c.traps.includes(trap);
  const picked = pickMix(random, candidates, QUOTA, 'pickup', [
    has('holiday'),
    has('holiday'),
    has('cutoff_edge'),
    has('cutoff_edge'),
    has('full_day'),
    has('full_day'),
    has('bulky'),
    has('bulky'),
    // Pickups read fewer values than refunds, so the ones written another way are sought out.
    ...Array.from({ length: 10 }, () => has('messy_date')),
    ...Array.from({ length: 5 }, () => has('messy_sku')),
  ]).sort((a, b) => compareText(a.value.record.return_id, b.value.record.return_id));
  for (const { value: c } of picked) {
    const solved = solvePickup(new DeskTools(data), c.request, BUSINESS_DATE);
    if (solved.result.carrier !== c.carrier || solved.result.pickup_date !== c.pickupDate) {
      throw new Error(`The reference books ${c.record.return_id} differently from the records`);
    }
  }

  return picked.map(({ value: c, traps }, i) => ({
    id: taskId('pickup', i),
    type: 'pickup',
    family: `order:${c.record.order_id}`,
    prompt: withAnswerLine(promptFor(random, index, c), ANSWER_SHAPE),
    expected: {
      kind: 'end_state',
      validator: 'pickup_booked',
      params: {
        pickup_id: pickupIdFor(c.record.return_id),
        return_id: c.record.return_id,
        carrier: c.carrier,
        pickup_date: c.pickupDate,
        booked_on: BUSINESS_DATE,
        booked_at: c.request.booked_at,
        first_date: firstPickupDate(BUSINESS_DATE, c.request.booked_at),
        pickup_from: c.record.pickup_from,
        region: index.customerOfOrder(c.record.order_id).region,
        bulky: index.product(c.record.sku).bulky,
        carrier_days: [...CARRIERS[c.carrier].days],
        closed_dates: [HOLIDAY],
        full_dates: fullDates(c),
      },
    },
    meta: {
      summary: `${c.carrier} on ${c.pickupDate}`,
      difficulty: difficultyOf(traps),
      traps,
      request: { ...c.request },
    },
  }));
}

/** The return booked at each time of day: one candidate for each date that leads to. */
function candidatesFor(
  random: Random,
  index: ShopIndex,
  record: ReturnRecord,
  row: Row,
  booked: ReadonlyMap<string, number>,
  carelessCounts: ReadonlyMap<string, number>,
  messySku: boolean,
): Candidate<PickupCase>[] {
  const bulky = index.product(record.sku).bulky;
  const carrier = carrierFor(index.customerOfOrder(record.order_id).region, bulky);
  const rulesAt = (bookedAt: string): PickupRules => ({
    carrier,
    today: BUSINESS_DATE,
    bookedAt,
    readyFrom: record.pickup_from,
    bookedOn: (date) => booked.get(`${carrier} ${date}`) ?? 0,
  });
  const byDate = new Map<string, string[]>();
  for (const time of BOOKING_TIMES) {
    const date = earliestPickup(rulesAt(time));
    byDate.set(date, [...(byDate.get(date) ?? []), time]);
  }
  return [...byDate].map(([pickupDate, times]) => {
    const request: PickupRequest = { return_id: record.return_id, booked_at: random.pick(times) };
    const rules = rulesAt(request.booked_at);
    const without = (rule: Parameters<typeof earliestPickup>[1]) => earliestPickup(rules, rule);
    const readyMatters = without('not_ready') !== pickupDate;
    const carelessDate = earliestPickup({
      ...rules,
      bookedOn: (date) => carelessCounts.get(`${carrier} ${date}`) ?? 0,
    });
    const otherSide = request.booked_at < PICKUP_CUTOFF ? PICKUP_CUTOFF : '13:55';
    const traps = [
      ...(bulky ? ['bulky'] : []),
      ...(earliestPickup({ ...rules, bookedAt: '09:00' }) !== pickupDate ? ['cutoff'] : []),
      ...(CUTOFF_EDGE.includes(request.booked_at) &&
      earliestPickup({ ...rules, bookedAt: otherSide }) !== pickupDate
        ? ['cutoff_edge']
        : []),
      ...(readyMatters ? ['pickup_from'] : []),
      ...(without('holiday') !== pickupDate ? ['holiday'] : []),
      ...(without('full') !== pickupDate ? ['full_day'] : []),
      // The hand-over day written another way, or a full day a date filter would miss.
      ...((readyMatters && row.pickup_from !== record.pickup_from) || carelessDate !== pickupDate
        ? ['messy_date']
        : []),
      ...(messySku ? ['messy_sku'] : []),
    ];
    return {
      value: { record, request, carrier, pickupDate, rules },
      traps,
      kind: carrier,
      answer: `${carrier} ${pickupDate}`,
      group: record.return_id,
    };
  });
}

/**
 * Pickups per carrier and day as a careless reader counts them: only the rows whose date is
 * written YYYY-MM-DD, as a filter on the date column would find them.
 */
function isoOnlyCounts(data: JobData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of data.tables.get('pickups.csv')?.rows ?? []) {
    const cell = row.pickup_date ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cell)) continue;
    const key = `${row.carrier} ${cell}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** The carrier's full days from tomorrow to two weeks past the answer. */
function fullDates(c: PickupCase): string[] {
  return datesFrom(addDays(BUSINESS_DATE, 1), addDays(c.pickupDate, 14)).filter(
    (date) =>
      CARRIERS[c.carrier].days.includes(weekdayOf(date)) &&
      c.rules.bookedOn(date) >= PICKUP_CAPACITY,
  );
}

function promptFor(random: Random, index: ShopIndex, c: PickupCase): string {
  const id = c.record.return_id;
  const now = `It's ${c.request.booked_at} on ${TODAY}.`;
  const customer = index.customerOfOrder(c.record.order_id);
  const product = index.product(c.record.sku);
  const templates = [
    `${now} Return ${id} is approved and the customer is sending it back. Book the earliest carrier pickup and add it to pickups.csv.`,
    `${now} Please book a carrier pickup for approved return ${id}, and record it in pickups.csv.`,
    `${now} ${customer.name} is sending back return ${id} (${product.name}). Book the pickup in pickups.csv for the earliest day that works.`,
  ];
  return random.pick(templates);
}
