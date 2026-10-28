import { daysBetween } from '../lib/calendar';
import { roundHalfUp } from '../lib/money';
import {
  DEFECTIVE_RETURN_DAYS,
  MEMBER_RETURN_DAYS,
  RESTOCKING_CATEGORIES,
  RESTOCKING_PCT,
  RETURN_DAYS,
  RETURN_LABEL_CENTS,
} from '../policy/rules';
import type { Category, Condition, Payment, ReturnAmounts } from '../shop/types';

/**
 * Ground truth for returns, written straight from the "Returns and refunds" section of
 * policy.md. It takes the facts as a careful reader finds them, already read back from whatever
 * way a file wrote them, so the same rules serve the generator (from the true records) and the
 * reference solutions (from what they read).
 */

export interface ReturnFacts {
  qty: number;
  condition: Condition;
  /** The day the return is decided: the business date for a request at the desk. */
  decided_on: string;
  /** The order line: what was bought and the price paid per unit. */
  line_qty: number;
  unit_price_cents: number;
  /** The product, its category already translated from any old code. */
  category: Category;
  final_sale: boolean;
  /** The order. */
  order_date: string;
  delivered_on: string;
  shipping_cents: number;
  payment: Payment;
  /** The customer's members' program start, or null. */
  member_since: string | null;
  /** Units of this SKU on this order already approved in earlier returns. */
  approved_before: number;
  /** Whether an earlier approved return on this order already refunded its shipping. */
  shipping_refunded_before: boolean;
}

/** Member perks count on an order placed on or after the day the customer joined. */
export function hasPerks(facts: Pick<ReturnFacts, 'member_since' | 'order_date'>): boolean {
  return facts.member_since !== null && facts.member_since <= facts.order_date;
}

export function daysSinceDelivery(facts: Pick<ReturnFacts, 'delivered_on' | 'decided_on'>): number {
  return daysBetween(facts.delivered_on, facts.decided_on);
}

/** The last day count that is still on time for this return. */
function returnWindow(facts: ReturnFacts): number {
  if (facts.condition === 'defective') return DEFECTIVE_RETURN_DAYS;
  return hasPerks(facts) ? MEMBER_RETURN_DAYS : RETURN_DAYS;
}

/** Why a return is denied, in the order the policy checks: on time, not final sale, enough left. */
export type DenialReason = 'late' | 'final_sale' | 'too_many';

export function denialReason(facts: ReturnFacts): DenialReason | null {
  if (daysSinceDelivery(facts) > returnWindow(facts)) return 'late';
  if (facts.final_sale && facts.condition !== 'defective') return 'final_sale';
  if (facts.qty > facts.line_qty - facts.approved_before) return 'too_many';
  return null;
}

export function decideReturn(facts: ReturnFacts): ReturnAmounts {
  const item_cents = facts.qty * facts.unit_price_cents;
  if (denialReason(facts) !== null) {
    return {
      decision: 'denied',
      item_cents,
      restocking_fee_cents: 0,
      return_shipping_cents: 0,
      shipping_refund_cents: 0,
      refund_cents: 0,
      refund_to: 'none',
    };
  }
  const defective = facts.condition === 'defective';
  const restocking_fee_cents =
    facts.condition === 'opened' && RESTOCKING_CATEGORIES.includes(facts.category)
      ? roundHalfUp(item_cents * RESTOCKING_PCT, 100)
      : 0;
  const return_shipping_cents = hasPerks(facts) || defective ? 0 : RETURN_LABEL_CENTS;
  const shipping_refund_cents =
    defective && !facts.shipping_refunded_before ? facts.shipping_cents : 0;
  const refund_cents =
    item_cents - restocking_fee_cents - return_shipping_cents + shipping_refund_cents;
  if (refund_cents < 0) throw new Error(`A refund came out below zero: ${refund_cents}`);
  const toCard = facts.payment === 'card' && daysSinceDelivery(facts) <= RETURN_DAYS;
  return {
    decision: 'approved',
    item_cents,
    restocking_fee_cents,
    return_shipping_cents,
    shipping_refund_cents,
    refund_cents,
    refund_to: toCard ? 'card' : 'store_credit',
  };
}
