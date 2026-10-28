import { addDays, daysBetween } from '../lib/calendar';
import type { Random } from '../lib/random';
import { EMAIL_DOMAINS, FIRST_NAMES, LAST_NAMES, REGIONS } from './catalog';
import type { Customer } from './types';

const CUSTOMER_COUNT = 160;

/**
 * The members' program started here; the latest members joined a few days ago. Almost half the
 * members joined since the records began, often after some of their orders.
 */
const PROGRAM_START = '2024-03-01';
const RECENT_JOINS = '2026-05-04';
const LAST_JOIN = '2026-11-20';

export interface CustomerBase {
  customers: Customer[];
  /** How often each customer orders, relative to the rest, by customer id. */
  activity: ReadonlyMap<string, number>;
}

/**
 * About two customers in five are members. A few customers order often; most order a few times.
 * No email is part of another one, so searching for an address finds only its owner.
 */
export function buildCustomers(random: Random): CustomerBase {
  const customers: Customer[] = [];
  const activity = new Map<string, number>();
  const emails: string[] = [];
  const programDays = daysBetween(PROGRAM_START, RECENT_JOINS) - 1;
  const recentDays = daysBetween(RECENT_JOINS, LAST_JOIN);
  while (customers.length < CUSTOMER_COUNT) {
    const first = random.pick(FIRST_NAMES);
    const last = random.pick(LAST_NAMES);
    const email = `${first}.${last}@${random.pick(EMAIL_DOMAINS)}`.toLowerCase();
    const clash = emails.some((other) => other.includes(email) || email.includes(other));
    const nameTaken = customers.some((customer) => customer.name === `${first} ${last}`);
    if (clash || nameTaken) continue;
    emails.push(email);
    const customer_id = `C-${1001 + customers.length}`;
    customers.push({
      customer_id,
      name: `${first} ${last}`,
      email,
      region: random.weighted(REGIONS),
      member_since: random.chance(0.4)
        ? random.chance(0.45)
          ? addDays(RECENT_JOINS, random.int(0, recentDays))
          : addDays(PROGRAM_START, random.int(0, programDays))
        : null,
    });
    activity.set(
      customer_id,
      random.weighted([
        [6, 0.12],
        [2, 0.38],
        [1, 0.5],
      ]),
    );
  }
  return { customers, activity };
}
