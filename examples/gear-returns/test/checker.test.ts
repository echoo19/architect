import vm from 'node:vm';
import type { CheckResult, JsonValue, Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { CsvRow } from '../src/lib/csv';
import {
  expectedOrderAnswer,
  expectedPickupRow,
  expectedReturnAnswer,
  expectedReturnRow,
  job,
  paramsOf,
  trapsOf,
} from './helpers';

const refunds = job.tasksOfType('refund');
const pickups = job.tasksOfType('pickup');
const orders = job.tasksOfType('order');

const checkReturn = (
  task: Task,
  row: CsvRow,
  answer: JsonValue | null = expectedReturnAnswer(task),
) => job.check(task, job.withAppended('returns.csv', [row], answer));
const checkPickup = (task: Task, row: CsvRow) =>
  job.check(task, job.withAppended('pickups.csv', [row]));
const checkOrder = (task: Task, answer: JsonValue | null) =>
  job.check(task, job.contextWith({}, answer));

/** What a locked-test result keeps of a failure: the field its reason starts with. */
function failedField(task: Task, result: CheckResult): string | null {
  expect(result.pass).toBe(false);
  const keys = (value: JsonValue): string[] =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner)])
      : [];
  const fields = keys(paramsOf(task) as JsonValue);
  return fields.find((field) => result.reason.startsWith(`${field} `)) ?? null;
}

describe('the checker sandbox', () => {
  it('has no clock and no randomness, and defines the three validators', () => {
    const sandbox = job.checkerSandbox();
    expect(vm.runInContext('typeof Date', sandbox)).toBe('undefined');
    expect(vm.runInContext('typeof Math.random', sandbox)).toBe('undefined');
    expect(vm.runInContext('Object.keys(validators).sort().join()', sandbox)).toBe(
      'order_answer,pickup_booked,return_recorded',
    );
  });

  it('gives the same verdict every time', () => {
    const task = refunds[0] as Task;
    const row = { ...expectedReturnRow(task), refund_cents: '1' };
    expect(checkReturn(task, row)).toEqual(checkReturn(task, row));
  });
});

describe('return_recorded', () => {
  it('passes the ground-truth row and ANSWER for every refund task', () => {
    for (const task of refunds) {
      expect(checkReturn(task, expectedReturnRow(task)), task.id).toMatchObject({ pass: true });
    }
  });

  const approved = refunds.find(
    (t) => paramsOf(t).decision === 'approved' && Number(paramsOf(t).refund_cents) > 0,
  ) as Task;
  const right = expectedReturnRow(approved);
  const refund = Number(paramsOf(approved).refund_cents);

  it('names the wrong field first, then the others, with what it should be', () => {
    const result = checkReturn(approved, { ...right, refund_cents: '1', refund_to: 'none' });
    expect(result.reason).toBe(
      `refund_cents is "1" but should be ${refund}; also wrong: refund_to.`,
    );
    expect(failedField(approved, result)).toBe('refund_cents');
  });

  it('wants amounts in whole cents, dates as YYYY-MM-DD and the SKU as the request gives it', () => {
    const dollars = (refund / 100).toFixed(2);
    expect(checkReturn(approved, { ...right, refund_cents: dollars }).reason).toBe(
      `refund_cents is "${dollars}" but should be ${refund}.`,
    );
    expect(checkReturn(approved, { ...right, decided_on: '11/24/2026' }).reason).toBe(
      'decided_on is "11/24/2026" but should be 2026-11-24.',
    );
    const lower = String(right.sku).toLowerCase();
    expect(checkReturn(approved, { ...right, sku: lower }).reason).toBe(
      `sku is "${lower}" but should be ${right.sku}.`,
    );
  });

  it('wants pickup_from left empty for a return at the desk', () => {
    const result = checkReturn(approved, { ...right, pickup_from: '2026-11-25' });
    expect(result.reason).toBe('pickup_from is "2026-11-25" but should be empty.');
    expect(failedField(approved, result)).toBe('pickup_from');
  });

  it('checks the ANSWER line: decision and refund_to in any capitals, the refund to the cent', () => {
    const answer = expectedReturnAnswer(approved) as Record<string, JsonValue>;
    const shouted = {
      ...answer,
      decision: 'APPROVED',
      refund_to: String(answer.refund_to).toUpperCase(),
    };
    expect(checkReturn(approved, right, shouted).pass).toBe(true);
    expect(checkReturn(approved, right, { ...answer, refund_cents: refund - 1e-9 }).pass).toBe(
      true,
    );
    expect(checkReturn(approved, right, { ...answer, refund_cents: String(refund) }).pass).toBe(
      true,
    );
    const short = checkReturn(approved, right, { ...answer, refund_cents: refund - 1 });
    expect(short.reason).toBe(
      `refund_cents in the ANSWER line is ${refund - 1} but should be ${refund}.`,
    );
    expect(failedField(approved, short)).toBe('refund_cents');
    const noAnswer = checkReturn(approved, right, null);
    expect(noAnswer.reason).toBe('The reply has no ANSWER line with a JSON object.');
    expect(failedField(approved, noAnswer)).toBeNull();
    expect(
      checkReturn(approved, right, { decision: 'approved', refund_cents: refund }).reason,
    ).toBe('refund_to is missing from the ANSWER line.');
  });

  it('fails a denied return recorded as approved', () => {
    const denied = refunds.find((t) => paramsOf(t).decision === 'denied') as Task;
    const row = { ...expectedReturnRow(denied), decision: 'approved' };
    expect(checkReturn(denied, row).reason).toMatch(/^decision is "approved" but should be denied/);
  });

  it('fails no new row, two new rows, a changed old row and the wrong return id', () => {
    expect(job.check(approved, job.contextWith({}, expectedReturnAnswer(approved))).reason).toBe(
      'No new return row was added.',
    );
    const second = { ...right, return_id: 'RT-9999' };
    expect(
      job.check(
        approved,
        job.withAppended('returns.csv', [right, second], expectedReturnAnswer(approved)),
      ).reason,
    ).toBe('Expected one new return row, found 2.');
    const [first, ...rest] = job.table('returns.csv') as [CsvRow, ...CsvRow[]];
    const edited = [{ ...first, refund_cents: '1' }, ...rest, right];
    expect(job.check(approved, job.contextWith({ 'returns.csv': edited })).reason).toBe(
      `An existing return row was changed or deleted (${first.return_id}).`,
    );
    expect(checkReturn(approved, { ...right, return_id: 'RT-9999' }).reason).toBe(
      `return_id is "RT-9999" but should be ${right.return_id}.`,
    );
  });
});

describe('pickup_booked', () => {
  it('passes the ground-truth row for every pickup task', () => {
    for (const task of pickups) {
      expect(checkPickup(task, expectedPickupRow(task)), task.id).toMatchObject({ pass: true });
    }
  });

  const reasonFor = (task: Task, date: string) => {
    const result = checkPickup(task, { ...expectedPickupRow(task), pickup_date: date });
    expect(failedField(task, result)).toBe('pickup_date');
    return result.reason;
  };

  it('explains a date the carrier already filled', () => {
    const full = pickups.filter((task) => trapsOf(task).includes('full_day'));
    let explained = 0;
    for (const task of full) {
      const params = paramsOf(task);
      const from = [String(params.first_date), String(params.pickup_from)].sort().at(-1) as string;
      const day = (params.full_dates as string[]).find(
        (date) => date >= from && date < String(params.pickup_date),
      );
      if (!day) continue;
      expect(reasonFor(task, day)).toBe(
        `pickup_date is ${day} but should be ${params.pickup_date}: ${params.carrier} is already full on ${day}.`,
      );
      explained += 1;
    }
    expect(explained).toBeGreaterThan(0);
  });

  it('explains Thanksgiving, a day the carrier does not come, and the hand-over date', () => {
    const task = pickups.find((t) => trapsOf(t).includes('holiday')) as Task;
    const params = paramsOf(task);
    expect(reasonFor(task, '2026-11-26')).toBe(
      `pickup_date is 2026-11-26 but should be ${params.pickup_date}: no carrier picks up on 2026-11-26.`,
    );
    const sunday = '2026-12-06';
    if (String(params.pickup_from) <= sunday) {
      expect(reasonFor(task, sunday)).toBe(
        `pickup_date is ${sunday} but should be ${params.pickup_date}: ${params.carrier} doesn't pick up on a Sunday.`,
      );
    }
    const waiting = pickups.find((t) => String(paramsOf(t).pickup_from) > '2026-12-01') as Task;
    const waitingParams = paramsOf(waiting);
    expect(reasonFor(waiting, '2026-12-01')).toBe(
      `pickup_date is 2026-12-01 but should be ${waitingParams.pickup_date}: the customer can hand the parcel over from ${waitingParams.pickup_from}.`,
    );
  });

  it('explains a pickup booked too soon for the time of day', () => {
    const late = pickups.find((t) => String(paramsOf(t).booked_at) >= '14:00') as Task;
    const params = paramsOf(late);
    expect(reasonFor(late, '2026-11-25')).toBe(
      `pickup_date is 2026-11-25 but should be ${params.pickup_date}: booked at ${params.booked_at}, the first possible pickup is 2026-11-26.`,
    );
    expect(reasonFor(late, '2026-11-24')).toBe(
      `pickup_date is 2026-11-24 but should be ${params.pickup_date}: a pickup is never booked for today or earlier.`,
    );
  });

  it('fails a later date, a date in another form, and the wrong carrier', () => {
    const task = pickups[0] as Task;
    const params = paramsOf(task);
    const days = params.carrier_days as string[];
    const later = Array.from({ length: 14 }, (_, i) => {
      const day = new Date(`${params.pickup_date}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() + i + 1);
      return day.toISOString().slice(0, 10);
    }).find(
      (date) =>
        days.includes(
          ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
            new Date(`${date}T12:00:00Z`).getUTCDay()
          ] as string,
        ) && !(params.full_dates as string[]).includes(date),
    ) as string;
    expect(reasonFor(task, later)).toBe(
      `pickup_date is ${later} but should be ${params.pickup_date}: ${params.carrier} can pick up earlier, on ${params.pickup_date}.`,
    );
    const right = expectedPickupRow(task);
    const [y, m, d] = String(params.pickup_date).split('-');
    expect(checkPickup(task, { ...right, pickup_date: `${m}/${d}/${y}` }).reason).toBe(
      `pickup_date is "${m}/${d}/${y}" but should be a YYYY-MM-DD date.`,
    );
    const other =
      params.carrier === 'Cedarline Parcel' ? 'Kettlepoint Courier' : 'Cedarline Parcel';
    const wrongCarrier = checkPickup(task, { ...right, carrier: other });
    expect(wrongCarrier.reason).toMatch(
      new RegExp(
        `^carrier is "${other}" but should be ${params.carrier}, which (serves the ${params.region} region|takes bulky products)\\.$`,
      ),
    );
    expect(failedField(task, wrongCarrier)).toBe('carrier');
    expect(checkPickup(task, { ...right, booked_on: '2026-11-23' }).reason).toBe(
      'booked_on is "2026-11-23" but should be 2026-11-24.',
    );
  });
});

describe('order_answer', () => {
  it('passes the ground-truth ANSWER for every order task', () => {
    for (const task of orders) {
      expect(checkOrder(task, expectedOrderAnswer(task)), task.id).toMatchObject({ pass: true });
    }
  });

  const ofKind = (kind: string) =>
    orders.find((t) => (t.meta?.question as { kind: string }).kind === kind) as Task;

  it('compares money to the cent, forgiving floating-point noise but not a cent', () => {
    const task = ofKind('spend');
    const spent = Number(expectedOrderAnswer(task).spent_cents);
    expect(checkOrder(task, { spent_cents: spent + 0.4 }).pass).toBe(true);
    expect(checkOrder(task, { spent_cents: `${spent}` }).pass).toBe(true);
    const off = checkOrder(task, { spent_cents: spent + 1 });
    expect(off.reason).toBe(`spent_cents is ${spent + 1} but should be ${spent}.`);
    expect(failedField(task, off)).toBe('spent_cents');
    expect(checkOrder(task, { spent_cents: (spent / 100).toFixed(2) }).pass).toBe(false);
  });

  it('counts units exactly', () => {
    const task = ofKind('sku_sales');
    const answer = expectedOrderAnswer(task);
    const wrong = checkOrder(task, { ...answer, units: Number(answer.units) + 1 });
    expect(wrong.reason).toBe(
      `units is ${Number(answer.units) + 1} but should be ${answer.units}.`,
    );
  });

  it('compares lists of order ids as sets, in any order and capitals', () => {
    const task = ofKind('unshipped');
    const ids = expectedOrderAnswer(task).order_ids as string[];
    const shuffled = [...ids].reverse().map((id) => id.toLowerCase());
    expect(checkOrder(task, { order_ids: shuffled }).pass).toBe(true);
    const missing = checkOrder(task, { order_ids: ids.slice(1) });
    expect(missing.reason).toBe(`order_ids is missing ${ids[0]}.`);
    expect(failedField(task, missing)).toBe('order_ids');
    expect(checkOrder(task, { order_ids: [...ids, 'ORD-99999'] }).reason).toBe(
      'order_ids includes "ORD-99999", which it should not.',
    );
  });

  it('fails a missing ANSWER, a missing key and a key the question does not ask for', () => {
    const task = ofKind('month_orders');
    const answer = expectedOrderAnswer(task);
    expect(checkOrder(task, null).reason).toBe('The reply has no ANSWER line with a JSON object.');
    expect(checkOrder(task, { order_ids: answer.order_ids ?? [] }).reason).toBe(
      'total_cents is missing from the ANSWER line.',
    );
    const extra = checkOrder(task, { ...answer, note: 'shipping included' });
    expect(extra.reason).toBe("The ANSWER line has note, which the question doesn't ask for.");
    expect(failedField(task, extra)).toBeNull();
  });
});
