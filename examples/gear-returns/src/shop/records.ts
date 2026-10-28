import { groupBy } from '../lib/compare';
import type { Ledger } from '../reference/orders';
import type { ReturnFacts } from '../reference/refunds';
import type { Condition, Customer, Order, OrderLine, Product, ReturnRecord, Shop } from './types';

/** The shop's records looked up by id, for building tasks from the ground truth. */
export class ShopIndex {
  private readonly orders: Map<string, Order>;
  private readonly products: Map<string, Product>;
  private readonly customers: Map<string, Customer>;
  private readonly returnsByOrder: Map<string, ReturnRecord[]>;
  private readonly linesByOrder: Map<string, OrderLine[]>;

  constructor(readonly shop: Shop) {
    this.orders = new Map(shop.orders.map((order) => [order.order_id, order]));
    this.products = new Map(shop.products.map((product) => [product.sku, product]));
    this.customers = new Map(shop.customers.map((customer) => [customer.customer_id, customer]));
    this.returnsByOrder = groupBy(shop.returns, (record) => record.order_id);
    this.linesByOrder = groupBy(shop.lines, (line) => line.order_id);
  }

  order(id: string): Order {
    return found(this.orders.get(id), id);
  }

  product(sku: string): Product {
    return found(this.products.get(sku), sku);
  }

  customer(id: string): Customer {
    return found(this.customers.get(id), id);
  }

  customerOfOrder(orderId: string): Customer {
    return this.customer(this.order(orderId).customer_id);
  }

  linesOf(orderId: string): readonly OrderLine[] {
    return this.linesByOrder.get(orderId) ?? [];
  }

  /** Approved returns already in returns.csv for an order. */
  approvedReturns(orderId: string): readonly ReturnRecord[] {
    return (this.returnsByOrder.get(orderId) ?? []).filter((r) => r.decision === 'approved');
  }

  /** The facts a return request at the desk is decided on, from the true records. */
  returnFacts(line: OrderLine, qty: number, condition: Condition, decidedOn: string): ReturnFacts {
    const order = this.order(line.order_id);
    const product = this.product(line.sku);
    const earlier = this.approvedReturns(line.order_id);
    if (order.delivered_on === null) throw new Error(`${order.order_id} hasn't arrived`);
    return {
      qty,
      condition,
      decided_on: decidedOn,
      line_qty: line.qty,
      unit_price_cents: line.unit_price_cents,
      category: product.category,
      final_sale: product.final_sale,
      order_date: order.order_date,
      delivered_on: order.delivered_on,
      shipping_cents: order.shipping_cents,
      payment: order.payment,
      member_since: this.customer(order.customer_id).member_since,
      approved_before: earlier
        .filter((record) => record.sku === line.sku)
        .reduce((total, record) => total + record.qty, 0),
      shipping_refunded_before: earlier.some((record) => record.shipping_refund_cents > 0),
    };
  }

  /** Every customer, order and line, for answering order questions from the true records. */
  ledger(): Ledger {
    return {
      customers: this.shop.customers,
      orders: this.shop.orders,
      lines: this.shop.lines,
      categoryOf: (sku) => this.product(sku).category,
    };
  }
}

function found<T>(value: T | undefined, id: string): T {
  if (value === undefined) throw new Error(`Not found: ${id}`);
  return value;
}
