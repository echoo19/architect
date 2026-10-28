import { compareText } from '../lib/compare';
import type { Random } from '../lib/random';
import { LEGACY_CODES, PRODUCTS, VENDOR_CODES } from './catalog';
import { buildCustomers } from './customers';
import { buildOrders } from './orders';
import { buildReturns } from './returns';
import type { Product, Shop } from './types';

export interface ShopRecords {
  shop: Shop;
  /** Approved returns that still need a carrier pickup: what the pickup tasks book. */
  awaitingPickup: readonly string[];
}

/**
 * Larchwood Outfitters' records as of the business date. Each part draws from its own random
 * stream, so the same seed always gives the same shop.
 */
export function buildShop(random: Random): ShopRecords {
  const base = buildCustomers(random.fork('customers'));
  const { products, weights } = buildProducts(random.fork('products'));
  const { orders, lines } = buildOrders(random.fork('orders'), base, products, weights);
  const history = buildReturns(random.fork('returns'), base.customers, products, orders, lines);
  return {
    shop: {
      customers: base.customers,
      products,
      legacyCodes: LEGACY_CODES,
      orders,
      lines,
      returns: history.returns,
      pickups: history.pickups,
    },
    awaitingPickup: history.awaitingPickup,
  };
}

/** The catalog with a SKU for each product (a vendor code and four digits), sorted by SKU. */
function buildProducts(random: Random): { products: Product[]; weights: Map<string, number> } {
  const taken = new Set<string>();
  const weights = new Map<string, number>();
  const products = PRODUCTS.map((template) => {
    let sku: string;
    do sku = `${random.pick(VENDOR_CODES)}-${random.int(1000, 9999)}`;
    while (taken.has(sku));
    taken.add(sku);
    weights.set(sku, template.weight);
    return {
      sku,
      name: template.name,
      category: template.category,
      list_price_cents: template.list_price_cents,
      final_sale: template.final_sale ?? false,
      bulky: template.bulky ?? false,
    };
  });
  products.sort((a, b) => compareText(a.sku, b.sku));
  return { products, weights };
}
