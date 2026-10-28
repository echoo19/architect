import { describe, expect, it } from 'vitest';
import { roundHalfUp } from '../src/lib/money';
import { answerOrderQuestion } from '../src/reference/orders';
import { earliestPickup } from '../src/reference/pickups';
import { decideReturn } from '../src/reference/refunds';
import type { ReturnFacts } from '../src/reference/refunds';
import { DeskTools } from '../src/reference/tools';
import type { Category } from '../src/shop/types';
import { job } from './helpers';
import { dayCount } from './oracles';

/** The worked examples in policy.md are what the agent learns from, so they must be right. */

const policy = job.file('data/policy.md');

const facts = (changes: Partial<ReturnFacts>): ReturnFacts => ({
  qty: 1,
  condition: 'unopened',
  decided_on: '2026-11-24',
  line_qty: 1,
  unit_price_cents: 5995,
  category: 'electronics',
  final_sale: false,
  order_date: '2026-10-20',
  delivered_on: '2026-10-27',
  shipping_cents: 0,
  payment: 'card',
  member_since: null,
  approved_before: 0,
  shipping_refunded_before: false,
  ...changes,
});

describe('policy.md', () => {
  it('states the business date and the closed holiday', () => {
    expect(policy).toContain('**Tuesday, November 24, 2026** (2026-11-24)');
    expect(policy).toContain('Thursday, November 26, 2026 (Thanksgiving)');
  });

  it('fits in a single read_text result', () => {
    const tools = new DeskTools(job.data());
    tools.readText('policy.md');
    expect(tools.calls).toBe(1);
  });

  it('says the files came from different systems, and nothing about how any of them wrote a value', () => {
    expect(policy).toContain('not every system wrote values the same way');
    for (const hint of [
      'USD',
      '/2026',
      'category_map',
      'D11',
      'lower case',
      'capital',
      'spaces',
      'Nov 3',
    ]) {
      expect(policy, hint).not.toContain(hint);
    }
  });

  it('rounds half up the way it says', () => {
    expect(policy).toContain('1948.5 becomes 1949');
    expect(roundHalfUp(12990 * 15, 100)).toBe(1949);
  });

  it('works its first refund example out the way the reference does', () => {
    expect(policy).toContain(
      'Example: a customer without member perks returns 2 opened sleeping pads (sleeping) bought at 64.50 each on an order delivered 2026-10-27, 28 days ago, paid by card. Item 12900. Restocking fee 15% of 12900 = 1935. Return shipping 695. Refund 12900 − 1935 − 695 = 10270, to card.',
    );
    expect(dayCount('2026-10-27', '2026-11-24')).toBe(28);
    expect(
      decideReturn(
        facts({
          qty: 2,
          line_qty: 2,
          condition: 'opened',
          unit_price_cents: 6450,
          category: 'sleeping',
        }),
      ),
    ).toEqual({
      decision: 'approved',
      item_cents: 12900,
      restocking_fee_cents: 1935,
      return_shipping_cents: 695,
      shipping_refund_cents: 0,
      refund_cents: 10270,
      refund_to: 'card',
    });
  });

  it('works its defective refund example out the way the reference does', () => {
    expect(policy).toContain(
      "Example: a member whose perks cover the order returns a defective headlamp bought at 59.95. The order was delivered 45 days ago, shipping was 7.95, and nothing on it was refunded before. Item 5995, no fees, shipping refund 795, refund 6790. It's more than 30 days since delivery, so it goes to store_credit.",
    );
    expect(
      decideReturn(
        facts({
          condition: 'defective',
          delivered_on: '2026-10-10',
          order_date: '2026-10-05',
          member_since: '2025-03-01',
          shipping_cents: 795,
        }),
      ),
    ).toEqual({
      decision: 'approved',
      item_cents: 5995,
      restocking_fee_cents: 0,
      return_shipping_cents: 0,
      shipping_refund_cents: 795,
      refund_cents: 6790,
      refund_to: 'store_credit',
    });
    expect(dayCount('2026-10-10', '2026-11-24')).toBe(45);
  });

  it('states every return window, and the reference keeps to them', () => {
    expect(policy).toContain(
      'On time: at most 30 days, or at most 60 with member perks. A defective item has 90 days for everyone.',
    );
    const on = (days: number, changes: Partial<ReturnFacts>) =>
      decideReturn(
        facts({ delivered_on: '2026-11-24', ...changes, decided_on: plus('2026-11-24', days) }),
      ).decision;
    expect([on(30, {}), on(31, {})]).toEqual(['approved', 'denied']);
    const member = { member_since: '2026-01-01', order_date: '2026-11-20' };
    expect([on(60, member), on(61, member)]).toEqual(['approved', 'denied']);
    const late = { member_since: '2026-11-21', order_date: '2026-11-20' };
    expect(on(31, late)).toBe('denied');
    const defective = { condition: 'defective' as const };
    expect([on(90, defective), on(91, defective)]).toEqual(['approved', 'denied']);
  });

  it('works its order examples out the way the reference does', () => {
    expect(policy).toContain(
      'Example: a customer placed two orders in October. On 2026-10-02: 2 mugs at 29.95 (kitchen), shipping 7.95. On 2026-10-30: a stove at 79.95 (kitchen) and a headlamp at 59.95 (electronics), free shipping. Since 2026-10-30 they have spent 7995 in the kitchen category, and since 2026-10-01, 2 × 2995 + 7995 = 13985. Their October total is 2 × 2995 + 795 + 7995 + 5995 = 20775.',
    );
    expect(policy).toContain(
      "Example: if that second order hasn't shipped, it is one of the customer's unshipped orders placed on or before 2026-10-30, and the stove's sales in October include its 1 unit for 7995.",
    );
    const email = 'a.b@example.com';
    const ledger = {
      customers: [{ customer_id: 'C-0000', email, region: 'Valley' as const }],
      orders: [
        {
          order_id: 'ORD-1',
          customer_id: 'C-0000',
          order_date: '2026-10-02',
          shipped_on: '2026-10-03',
          shipping_cents: 795,
        },
        {
          order_id: 'ORD-2',
          customer_id: 'C-0000',
          order_date: '2026-10-30',
          shipped_on: null,
          shipping_cents: 0,
        },
      ],
      lines: [
        { order_id: 'ORD-1', sku: 'MG-0001', qty: 2, unit_price_cents: 2995 },
        { order_id: 'ORD-2', sku: 'ST-0001', qty: 1, unit_price_cents: 7995 },
        { order_id: 'ORD-2', sku: 'HL-0001', qty: 1, unit_price_cents: 5995 },
      ],
      categoryOf: (sku: string): Category => (sku === 'HL-0001' ? 'electronics' : 'kitchen'),
    };
    const ask = (question: Parameters<typeof answerOrderQuestion>[0]) =>
      answerOrderQuestion(question, ledger);
    expect(ask({ kind: 'spend', email, category: 'kitchen', since: '2026-10-30' })).toEqual({
      spent_cents: 7995,
    });
    expect(ask({ kind: 'spend', email, category: 'kitchen', since: '2026-10-01' })).toEqual({
      spent_cents: 13985,
    });
    expect(ask({ kind: 'month_orders', email, month: '2026-10' })).toEqual({
      order_ids: ['ORD-1', 'ORD-2'],
      total_cents: 20775,
    });
    expect(ask({ kind: 'unshipped', region: 'Valley', through: '2026-10-30' })).toEqual({
      order_ids: ['ORD-2'],
    });
    expect(ask({ kind: 'sku_sales', sku: 'ST-0001', month: '2026-10' })).toEqual({
      units: 1,
      sales_cents: 7995,
    });
  });

  it('works its pickup example out the way the reference does', () => {
    expect(policy).toContain(
      "Example: at 15:10 today, a Valley customer's daypack (not bulky) goes with Cedarline, and its `pickup_from` is 2026-11-25. Booked after 14:00, the earliest day is Thursday 2026-11-26, but no carrier picks up on Thanksgiving. Friday 2026-11-27 is a Cedarline day; if pickups.csv already has 3 Cedarline pickups that day, the next one, Monday 2026-11-30, is the date to book.",
    );
    const pickup = (full: string[]) =>
      earliestPickup({
        carrier: 'Cedarline Parcel',
        today: '2026-11-24',
        bookedAt: '15:10',
        readyFrom: '2026-11-25',
        bookedOn: (date) => (full.includes(date) ? 3 : 2),
      });
    expect(pickup([])).toBe('2026-11-27');
    expect(pickup(['2026-11-27'])).toBe('2026-11-30');
  });
});

function plus(date: string, days: number): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}
