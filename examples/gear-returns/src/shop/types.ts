/**
 * The shop's records as they really are, before any export wrote them down. Field names match
 * the CSV columns; money is whole cents, dates are YYYY-MM-DD, SKUs are in capitals and emails in
 * lower case. `exports.ts` writes them out, and that is where some rows get written differently.
 */

export type Region = 'Lakeshore' | 'Valley' | 'Foothills' | 'Uplands';

export type Category =
  'footwear' | 'clothing' | 'packs' | 'tents' | 'sleeping' | 'kitchen' | 'electronics' | 'climbing';

export type Condition = 'unopened' | 'opened' | 'defective';
export type Payment = 'card' | 'gift_card';
export type Decision = 'approved' | 'denied';
export type RefundTo = 'card' | 'store_credit' | 'none';
export type Carrier = 'Cedarline Parcel' | 'Kettlepoint Courier' | 'Basalt Freight';

export interface Customer {
  customer_id: string;
  name: string;
  email: string;
  region: Region;
  /** When they joined the members' program, or null for customers who never did. */
  member_since: string | null;
}

export interface Product {
  sku: string;
  name: string;
  category: Category;
  list_price_cents: number;
  final_sale: boolean;
  bulky: boolean;
}

/** An old category code still found on some products, and the category it stands for. */
export interface LegacyCode {
  legacy_code: string;
  category: Category;
}

export interface Order {
  order_id: string;
  customer_id: string;
  order_date: string;
  shipped_on: string | null;
  delivered_on: string | null;
  shipping_cents: number;
  payment: Payment;
}

export interface OrderLine {
  order_id: string;
  sku: string;
  qty: number;
  unit_price_cents: number;
}

/** The amounts a decided return records. */
export interface ReturnAmounts {
  decision: Decision;
  item_cents: number;
  restocking_fee_cents: number;
  return_shipping_cents: number;
  shipping_refund_cents: number;
  refund_cents: number;
  refund_to: RefundTo;
}

export interface ReturnRecord extends ReturnAmounts {
  return_id: string;
  order_id: string;
  sku: string;
  qty: number;
  condition: Condition;
  decided_on: string;
  /**
   * For a return the customer sends back by carrier, the first day they can hand the parcel
   * over; null for one brought to the desk.
   */
  pickup_from: string | null;
}

export interface Pickup {
  pickup_id: string;
  return_id: string;
  carrier: Carrier;
  pickup_date: string;
  booked_on: string;
}

export interface Shop {
  customers: readonly Customer[];
  products: readonly Product[];
  legacyCodes: readonly LegacyCode[];
  orders: readonly Order[];
  lines: readonly OrderLine[];
  returns: readonly ReturnRecord[];
  pickups: readonly Pickup[];
}
