import type { Task } from '@architect/shared';
import { addDays } from '../lib/calendar';
import { compareText } from '../lib/compare';
import { dollars } from '../lib/money';
import type { Random } from '../lib/random';
import {
  BUSINESS_DATE,
  DEFECTIVE_RETURN_DAYS,
  MEMBER_RETURN_DAYS,
  RESTOCKING_PCT,
  RETURN_DAYS,
  returnIdFor,
} from '../policy/rules';
import { decideReturn, daysSinceDelivery, denialReason, hasPerks } from '../reference/refunds';
import type { ReturnFacts } from '../reference/refunds';
import { solveReturn } from '../reference/solver';
import type { ReturnRequest } from '../reference/solver';
import { AgentTools } from '../reference/tools';
import type { JobFiles } from '../reference/tools';
import type { ShopIndex } from '../shop/records';
import type { Condition, OrderLine, ReturnAmounts } from '../shop/types';
import { TODAY, withAnswerLine } from './prompts';
import { difficultyOf, pickMix, taskId } from './select';
import type { Candidate, Quota } from './select';

const QUOTA: Quota = { easy: 6, medium: 24, hard: 30 };

const ANSWER_SHAPE =
  '{"decision": "<approved or denied>", "refund_cents": <integer>, "refund_to": "<card, store_credit or none>"}';

/** Requests come in about lines delivered within the last few months. */
const OLDEST_DELIVERY = addDays(BUSINESS_DATE, -(DEFECTIVE_RETURN_DAYS + 12));

const FIRST_REQUEST_NUMBER = 5001;

const CONDITIONS: readonly Condition[] = ['unopened', 'opened', 'defective'];

interface RefundCase {
  line: OrderLine;
  request: Omit<ReturnRequest, 'request_id'>;
  facts: ReturnFacts;
  amounts: ReturnAmounts;
}

/**
 * Return requests at the desk, one per order, about lines delivered in the last few months.
 * About a quarter are denied (late, final sale or more units than are left); the rest exercise
 * the fees, the shipping refund and where the money goes. A request on the last day of a window
 * and on the day after it are always among them.
 */
export function buildRefundTasks(
  random: Random,
  index: ShopIndex,
  data: JobFiles,
  excludedOrders: ReadonlySet<string>,
): Task[] {
  const candidates = index.shop.lines
    .filter((line) => {
      const order = index.order(line.order_id);
      return (
        order.delivered_on !== null &&
        order.delivered_on >= OLDEST_DELIVERY &&
        !excludedOrders.has(order.order_id)
      );
    })
    .flatMap((line) =>
      CONDITIONS.map((condition) => candidateFor(random, index, data, line, condition)),
    );
  const has = (trap: string) => (c: Candidate<RefundCase>) => c.traps.includes(trap);
  // A request on the last day of each window, and one on the day after it.
  const onDay =
    (count: number, approved: boolean, defective: boolean) => (c: Candidate<RefundCase>) =>
      daysSinceDelivery(c.value.facts) === count &&
      (c.value.facts.condition === 'defective') === defective &&
      (c.value.amounts.decision === 'approved') === approved;
  const picked = pickMix(random, candidates, QUOTA, 'refund', [
    onDay(RETURN_DAYS, true, false),
    onDay(RETURN_DAYS + 1, false, false),
    onDay(MEMBER_RETURN_DAYS, true, false),
    onDay(MEMBER_RETURN_DAYS + 1, false, false),
    onDay(DEFECTIVE_RETURN_DAYS, true, true),
    onDay(DEFECTIVE_RETURN_DAYS + 1, false, true),
    has('perks_after_order'),
    has('perks_after_order'),
    has('too_many'),
    has('shipping_once'),
    has('restocking'),
    has('restocking'),
    has('restocking'),
    has('half_cent'),
    has('old_category'),
    has('old_category'),
    has('final_sale_defective'),
    has('gift_card'),
  ]).sort((a, b) => compareText(a.value.line.order_id, b.value.line.order_id));

  return picked.map(({ value: c, traps }, i) => {
    const request_id = `RQ-${FIRST_REQUEST_NUMBER + i}`;
    const request: ReturnRequest = { request_id, ...c.request };
    return {
      id: taskId('refund', i),
      type: 'refund',
      family: `order:${c.line.order_id}`,
      prompt: withAnswerLine(promptFor(random, index, request), ANSWER_SHAPE),
      expected: {
        kind: 'end_state',
        validator: 'return_recorded',
        params: {
          return_id: returnIdFor(request_id),
          order_id: request.order_id,
          sku: request.sku,
          qty: request.qty,
          condition: request.condition,
          decided_on: BUSINESS_DATE,
          ...c.amounts,
          pickup_from: null,
        },
      },
      meta: {
        summary: summaryOf(c.amounts),
        difficulty: difficultyOf(traps),
        traps,
        request: { ...request },
      },
    };
  });
}

/**
 * A request about the line in this condition: usually one unit, sometimes all of them or one
 * more than are left.
 */
function candidateFor(
  random: Random,
  index: ShopIndex,
  data: JobFiles,
  line: OrderLine,
  condition: Condition,
): Candidate<RefundCase> {
  const left = line.qty - index.returnFacts(line, 1, condition, BUSINESS_DATE).approved_before;
  const qty = random.weighted([
    [1, 75],
    [line.qty, 15],
    [left + 1, 10],
  ]);
  const facts = index.returnFacts(line, qty, condition, BUSINESS_DATE);
  const amounts = decideReturn(facts);
  const request = { order_id: line.order_id, sku: line.sku, qty, condition };
  const solved = solveReturn(
    new AgentTools(data),
    { request_id: 'RQ-0000', ...request },
    BUSINESS_DATE,
  );
  if (JSON.stringify(solved.result) !== JSON.stringify(amounts)) {
    throw new Error(
      `The reference reads ${line.order_id} ${line.sku} differently from the records`,
    );
  }
  const traps = [
    ...ruleTraps(index, line, facts, amounts),
    ...messyTraps(facts, amounts, solved.variants),
  ];
  const reason = denialReason(facts);
  return {
    value: { line, request, facts, amounts },
    traps,
    kind: reason === null ? `approved ${condition}` : 'denied',
    answer: JSON.stringify(amounts),
    group: line.order_id,
  };
}

/** The rules this request turns on, beyond the plain path. */
function ruleTraps(
  index: ShopIndex,
  line: OrderLine,
  facts: ReturnFacts,
  amounts: ReturnAmounts,
): string[] {
  const traps: string[] = [];
  const days = daysSinceDelivery(facts);
  const reason = denialReason(facts);
  const limits = [RETURN_DAYS, MEMBER_RETURN_DAYS, DEFECTIVE_RETURN_DAYS];
  if (reason === 'late') traps.push('late');
  if (limits.some((limit) => days === limit || days === limit + 1)) traps.push('window_edge');
  if (
    facts.member_since !== null &&
    !hasPerks(facts) &&
    JSON.stringify(decideReturn({ ...facts, member_since: facts.order_date })) !==
      JSON.stringify(amounts)
  ) {
    traps.push('perks_after_order');
  }
  if (hasPerks(facts) && reason === null && days > RETURN_DAYS && facts.condition !== 'defective') {
    traps.push('member_window');
  }
  if (facts.final_sale) traps.push(reason === null ? 'final_sale_defective' : 'final_sale');
  if (reason === 'too_many') traps.push('too_many');
  if (facts.approved_before > 0 && reason !== 'too_many') traps.push('returned_before');
  if (reason === null && facts.condition === 'defective' && facts.shipping_cents > 0) {
    traps.push(facts.shipping_refunded_before ? 'shipping_once' : 'shipping_refund');
  }
  if (amounts.restocking_fee_cents > 0) traps.push('restocking');
  if ((amounts.item_cents * RESTOCKING_PCT) % 100 === 50 && amounts.restocking_fee_cents > 0) {
    traps.push('half_cent');
  }
  if (index.product(line.sku).list_price_cents !== line.unit_price_cents) traps.push('sale_price');
  if (reason === null && amounts.refund_to === 'store_credit') {
    traps.push(facts.payment === 'gift_card' ? 'gift_card' : 'store_credit');
  }
  return traps;
}

/** Values written another way that the answer depends on. */
function messyTraps(
  facts: ReturnFacts,
  amounts: ReturnAmounts,
  variants: ReadonlySet<string>,
): string[] {
  const traps: string[] = [];
  if (variants.has('date')) traps.push('messy_date');
  if (variants.has('money')) traps.push('messy_money');
  if (variants.has('sku')) traps.push('messy_sku');
  if (variants.has('category') && facts.condition === 'opened' && amounts.decision === 'approved') {
    traps.push('old_category');
  }
  return traps;
}

function promptFor(random: Random, index: ShopIndex, request: ReturnRequest): string {
  const customer = index.customerOfOrder(request.order_id);
  const product = index.product(request.sku);
  const item = `${request.qty} × ${request.sku} (${product.name})`;
  const templates = [
    `Today is ${TODAY}. Return request ${request.request_id}: ${customer.name} sent back ${item} from order ${request.order_id}, ${request.condition}. Decide it and record it in returns.csv.`,
    `It's ${TODAY}. ${customer.name} brought back ${item} from order ${request.order_id} under request ${request.request_id}. The condition is ${request.condition}. Process the return and add its row to returns.csv.`,
    `Today is ${TODAY}. Please process return request ${request.request_id}: order ${request.order_id}, ${item}, condition ${request.condition}. Record the decision and the refund in returns.csv.`,
  ];
  return random.pick(templates);
}

function summaryOf(amounts: ReturnAmounts): string {
  if (amounts.decision === 'denied') return `Denied, item ${dollars(amounts.item_cents)}`;
  return `Approved, refund ${dollars(amounts.refund_cents)} to ${amounts.refund_to.replace('_', ' ')}`;
}
