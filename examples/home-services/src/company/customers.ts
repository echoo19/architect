import type { Random } from '../lib/random';
import { BUSINESS_KINDS, BUSINESS_PREFIXES, CITIES, FIRST_NAMES, LAST_NAMES } from './catalog';
import type { Customer } from './types';

const CUSTOMER_COUNT = 400;

export interface CustomerBase {
  customers: Customer[];
  /** Ids of the customers that are businesses; they call more often than households. */
  businesses: ReadonlySet<string>;
}

/**
 * About one customer in six is a business, on net 30 or net 45. Plan members get net 30; other
 * households pay within 15 days, or on the spot for a quarter of them.
 */
export function buildCustomers(random: Random): CustomerBase {
  const takenNames = new Set<string>();
  const customers: Customer[] = [];
  const businesses = new Set<string>();
  for (let n = 1; n <= CUSTOMER_COUNT; n++) {
    const customer_id = `C-${String(n).padStart(4, '0')}`;
    const business = random.chance(0.17);
    const city = random.weighted(CITIES.map((c) => [c, c.weight] as const));
    const plan_member = random.chance(business ? 0.08 : 0.3);
    const terms_days = business
      ? random.pick([30, 45])
      : plan_member
        ? 30
        : random.weighted([
            [15, 3],
            [0, 1],
          ]);
    customers.push({
      customer_id,
      name: uniqueName(random, takenNames, business),
      city: city.name,
      zone: random.pick(city.zones),
      plan_member,
      terms_days,
    });
    if (business) businesses.add(customer_id);
  }
  return { customers, businesses };
}

function uniqueName(random: Random, taken: Set<string>, business: boolean): string {
  for (;;) {
    const name = business
      ? `${random.pick(BUSINESS_PREFIXES)} ${random.pick(BUSINESS_KINDS)}`
      : `${random.pick(FIRST_NAMES)} ${random.pick(LAST_NAMES)}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
}
