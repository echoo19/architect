import type { JsonValue, Task } from '@architect/shared';
import { addDays, datesFrom, monthName, monthSpan } from '../lib/calendar';
import { compareText, groupBy } from '../lib/compare';
import { dollars } from '../lib/money';
import type { Random } from '../lib/random';
import { answerOrderQuestion } from '../reference/orders';
import type { OrderKind, OrderQuestion } from '../reference/orders';
import { answerOrder } from '../reference/solver';
import { AgentTools } from '../reference/tools';
import type { JobFiles } from '../reference/tools';
import { CATEGORIES, REGIONS } from '../shop/catalog';
import type { ShopIndex } from '../shop/records';
import type { Order } from '../shop/types';
import { TODAY, withAnswerLine } from './prompts';
import { difficultyOf, pickMix, taskId } from './select';
import type { Candidate, Quota } from './select';

/**
 * Questions about orders, fifteen of each kind: what a customer spent in a category since a
 * date, what a product sold in a month, which orders from a region are still waiting to ship,
 * and a customer's orders in a month with their total. Each needs rows from two or three
 * tables, filtered and joined. Customers asked about by email are asked about once, and so is
 * each product.
 */

const KINDS: readonly OrderKind[] = ['spend', 'sku_sales', 'unshipped', 'month_orders'];

const QUOTAS: Readonly<Record<OrderKind, Quota>> = {
  spend: { easy: 1, medium: 5, hard: 9 },
  sku_sales: { easy: 2, medium: 7, hard: 6 },
  unshipped: { easy: 3, medium: 7, hard: 5 },
  month_orders: { easy: 2, medium: 7, hard: 6 },
};

const SHAPES: Readonly<Record<OrderKind, string>> = {
  spend: '{"spent_cents": <integer>}',
  sku_sales: '{"units": <integer>, "sales_cents": <integer>}',
  unshipped: '{"order_ids": ["<id>", ...]}',
  month_orders: '{"order_ids": ["<id>", ...], "total_cents": <integer>}',
};

const MONTHS = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'];
/** Unshipped questions look back from these days. */
const UNSHIPPED_FROM = '2026-10-01';
const UNSHIPPED_TO = '2026-11-23';

interface OrderCase {
  question: OrderQuestion;
  answer: JsonValue;
  family: string;
}

export function buildOrderTasks(random: Random, index: ShopIndex, data: JobFiles): Task[] {
  const usedCustomers = new Set<string>();
  const drafts = KINDS.flatMap((kind) => {
    const candidates = candidatesOf(random, index, data, kind).filter(
      (c) => !usedCustomers.has(c.group),
    );
    const has = (trap: string) => (c: Candidate<OrderCase>) => c.traps.includes(trap);
    // Emails are looked up only by these questions, so the ones written another way are sought out.
    const picked = pickMix(random, candidates, QUOTAS[kind], kind, [
      ...Array.from({ length: 4 }, () => has('messy_email')),
      has('old_category'),
      has('old_category'),
    ]);
    for (const { group } of picked) usedCustomers.add(group);
    return picked.sort((a, b) => compareText(a.value.family, b.value.family));
  });
  return drafts.map(({ value, traps }, i) => ({
    id: taskId('order', i),
    type: 'order',
    family: value.family,
    prompt: withAnswerLine(promptFor(random, index, value.question), SHAPES[value.question.kind]),
    expected: {
      kind: 'end_state',
      validator: 'order_answer',
      params: { answer: value.answer },
    },
    meta: {
      summary: summaryOf(value.answer),
      difficulty: difficultyOf(traps),
      traps,
      question: { ...value.question },
    },
  }));
}

function candidatesOf(
  random: Random,
  index: ShopIndex,
  data: JobFiles,
  kind: OrderKind,
): Candidate<OrderCase>[] {
  const ordersOf = groupBy(index.shop.orders, (order) => order.customer_id);
  switch (kind) {
    case 'spend':
      return index.shop.customers.flatMap((customer) => {
        const orders = ordersOf.get(customer.customer_id) ?? [];
        if (orders.length < 3) return [];
        const bought = orders.flatMap((order) => index.linesOf(order.order_id));
        return CATEGORIES.flatMap((category) => {
          const lines = bought.filter((line) => index.product(line.sku).category === category);
          const dates = [...new Set(lines.map((line) => index.order(line.order_id).order_date))];
          // Since one of their later orders in the category, or the day after it.
          if (dates.length < 2) return [];
          const on = random.pick(dates.slice(1));
          const since = random.chance(0.5) ? on : addDays(on, 1);
          const question: OrderQuestion = { kind, email: customer.email, category, since };
          const answer = answerOrderQuestion(question, index.ledger()) as { spent_cents: number };
          if (answer.spent_cents === 0) return [];
          return candidate(
            index,
            data,
            question,
            customer.customer_id,
            `customer:${customer.customer_id}`,
          );
        });
      });
    case 'sku_sales':
      return index.shop.products.flatMap((product) =>
        MONTHS.flatMap((month) => {
          const question: OrderQuestion = { kind, sku: product.sku, month };
          const answer = answerOrderQuestion(question, index.ledger()) as { units: number };
          if (answer.units < 2) return [];
          return candidate(index, data, question, product.sku, `sku:${product.sku}`);
        }),
      );
    case 'unshipped':
      return REGIONS.flatMap(([region]) => {
        const byAnswer = groupBy(datesFrom(UNSHIPPED_FROM, UNSHIPPED_TO), (through) =>
          JSON.stringify(answerOrderQuestion({ kind, region, through }, index.ledger())),
        );
        return [...byAnswer].flatMap(([answer, dates]) => {
          if ((JSON.parse(answer) as { order_ids: string[] }).order_ids.length === 0) return [];
          const question: OrderQuestion = { kind, region, through: random.pick(dates) };
          return candidate(index, data, question, `${region} ${answer}`, `unshipped:${region}`);
        });
      });
    case 'month_orders':
      return index.shop.customers.flatMap((customer) =>
        MONTHS.flatMap((month) => {
          const { first, last } = monthSpan(month);
          const placed = (ordersOf.get(customer.customer_id) ?? []).filter(
            (order) => order.order_date >= first && order.order_date <= last,
          );
          if (placed.length < 2) return [];
          const question: OrderQuestion = { kind, email: customer.email, month };
          return candidate(
            index,
            data,
            question,
            customer.customer_id,
            `customer:${customer.customer_id}`,
          );
        }),
      );
  }
}

/** The question as a candidate, after the reference solution agrees with the records. */
function candidate(
  index: ShopIndex,
  data: JobFiles,
  question: OrderQuestion,
  group: string,
  family: string,
): Candidate<OrderCase>[] {
  const answer = answerOrderQuestion(question, index.ledger());
  const solved = answerOrder(new AgentTools(data), question);
  if (JSON.stringify(solved.result) !== JSON.stringify(answer)) {
    throw new Error(`The reference answers ${JSON.stringify(question)} differently`);
  }
  const messy = [...solved.variants].map((kind) =>
    kind === 'category' ? 'old_category' : `messy_${kind}`,
  );
  return [
    {
      value: { question, answer, family },
      traps: [...ruleTraps(index, question), ...messy].sort(compareText),
      kind: question.kind === 'unshipped' ? question.region : question.kind,
      answer: JSON.stringify(answer),
      group,
    },
  ];
}

/** What a careless answer to this question gets wrong, beyond values written another way. */
function ruleTraps(index: ShopIndex, question: OrderQuestion): string[] {
  const ledger = index.ledger();
  const traps: string[] = [];
  switch (question.kind) {
    case 'spend': {
      const customer = index.shop.customers.find((c) => c.email === question.email);
      const orders = index.shop.orders.filter((o) => o.customer_id === customer?.customer_id);
      const counted = orders.filter((o) => o.order_date >= question.since);
      const lines = counted.flatMap((o) => index.linesOf(o.order_id));
      const inCategory = lines.filter((l) => index.product(l.sku).category === question.category);
      if (counted.some((o) => o.order_date === question.since)) traps.push('since_edge');
      if (lines.length > inCategory.length) traps.push('other_categories');
      if (inCategory.some((l) => index.product(l.sku).list_price_cents !== l.unit_price_cents)) {
        traps.push('sale_price');
      }
      if (inCategory.some((l) => index.approvedReturns(l.order_id).some((r) => r.sku === l.sku))) {
        traps.push('returned');
      }
      break;
    }
    case 'sku_sales': {
      const { first, last } = monthSpan(question.month);
      const near = [addDays(first, -1), first, last, addDays(last, 1)];
      const lines = ledger.lines.filter((l) => l.sku === question.sku);
      const dates = lines.map((l) => index.order(l.order_id).order_date);
      if (dates.some((date) => near.includes(date))) traps.push('month_edge');
      if (lines.some((l) => l.qty > 1)) traps.push('several_units');
      if (lines.some((l) => index.product(l.sku).list_price_cents !== l.unit_price_cents)) {
        traps.push('sale_price');
      }
      break;
    }
    case 'unshipped': {
      const members = new Set(
        index.shop.customers.filter((c) => c.region === question.region).map((c) => c.customer_id),
      );
      const theirs = index.shop.orders.filter((o) => members.has(o.customer_id));
      const waiting = theirs.filter((o) => o.shipped_on === null);
      if (waiting.some((o) => o.order_date === question.through)) traps.push('through_edge');
      if (waiting.some((o) => o.order_date > question.through)) traps.push('placed_later');
      if (theirs.some((o) => inTransit(o) && o.order_date <= question.through)) {
        traps.push('in_transit');
      }
      break;
    }
    case 'month_orders': {
      const { first, last } = monthSpan(question.month);
      const customer = index.shop.customers.find((c) => c.email === question.email);
      const orders = index.shop.orders.filter((o) => o.customer_id === customer?.customer_id);
      const near = [addDays(first, -1), first, last, addDays(last, 1)];
      if (orders.some((o) => near.includes(o.order_date))) traps.push('month_edge');
      const placed = orders.filter((o) => o.order_date >= first && o.order_date <= last);
      if (placed.some((o) => o.shipping_cents > 0)) traps.push('shipping');
      break;
    }
  }
  return traps;
}

function inTransit(order: Order): boolean {
  return order.shipped_on !== null && order.delivered_on === null;
}

function promptFor(random: Random, index: ShopIndex, question: OrderQuestion): string {
  switch (question.kind) {
    case 'spend':
      return random.pick([
        `Today is ${TODAY}. How much has ${question.email} spent in the ${question.category} category since ${question.since}?`,
        `It's ${TODAY}. A customer, ${question.email}, asked what they have spent in the ${question.category} category since ${question.since}. What is it?`,
      ]);
    case 'sku_sales': {
      const product = index.product(question.sku);
      const month = monthName(question.month);
      return random.pick([
        `Today is ${TODAY}. How many units of ${product.name} (${question.sku}) did we sell in ${month}, and for how much in total?`,
        `It's ${TODAY}. For ${question.sku} (${product.name}), give the units sold in ${month} and what they sold for.`,
      ]);
    }
    case 'unshipped':
      return random.pick([
        `Today is ${TODAY}. Which orders from customers in the ${question.region} region, placed on or before ${question.through}, have not shipped yet?`,
        `It's ${TODAY}. List the unshipped orders placed on or before ${question.through} by customers in the ${question.region} region.`,
      ]);
    case 'month_orders': {
      const month = monthName(question.month);
      return random.pick([
        `Today is ${TODAY}. Which orders did ${question.email} place in ${month}, and what did they come to in total, shipping included?`,
        `It's ${TODAY}. List the orders ${question.email} placed in ${month} and their total with shipping.`,
      ]);
    }
  }
}

function summaryOf(answer: JsonValue): string {
  const { spent_cents, units, sales_cents, order_ids, total_cents } = answer as {
    spent_cents?: number;
    units?: number;
    sales_cents?: number;
    order_ids?: string[];
    total_cents?: number;
  };
  if (spent_cents !== undefined) return `${dollars(spent_cents)} spent`;
  if (units !== undefined && sales_cents !== undefined) {
    return `${units} units for ${dollars(sales_cents)}`;
  }
  const ids = (order_ids ?? []).join(', ');
  return total_cents === undefined ? ids : `${ids}: ${dollars(total_cents)}`;
}
