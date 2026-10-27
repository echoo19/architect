import { addDays, daysBetween } from '../lib/calendar';
import { compareText } from '../lib/compare';
import type { Random } from '../lib/random';
import { BUSINESS_DATE } from '../policy/rules';
import type { JobVersion } from '../versions';
import type { Customer, Invoice, Payment } from './types';

type Habit = 'prompt' | 'slow' | 'poor';

type PlannedPayment = Omit<Payment, 'payment_id'>;

/** Customers sometimes set up a payment ahead; the office records those up to three weeks out. */
const SCHEDULED_WINDOW_DAYS = 21;

const FIRST_PAYMENT_NUMBER = 10001;

const YESTERDAY = addDays(BUSINESS_DATE, -1);
const TOMORROW = addDays(BUSINESS_DATE, 1);

/**
 * The chance that an invoice falling due on a date is still unpaid this morning. Most invoices due
 * today are; in version 2 so are most of yesterday's, whose mailed payments haven't arrived.
 */
const STILL_OPEN: Readonly<Record<JobVersion, ReadonlyMap<string, number>>> = {
  1: new Map([[BUSINESS_DATE, 0.85]]),
  2: new Map([
    [BUSINESS_DATE, 0.85],
    [YESTERDAY, 0.6],
  ]),
};

/** In version 2, the chances that an overdue invoice was paid today, or promised for tomorrow. */
const PAID_TODAY = 0.05;
const PROMISED_TOMORROW = 0.05;

/**
 * Payments as of the business date. Most customers pay on time; slow payers pay late, sometimes
 * in two parts; poor payers pay part or nothing. A payment planned for after the business date is
 * either recorded as scheduled (dated in the future) or not recorded yet.
 */
export function buildPayments(
  random: Random,
  customers: readonly Customer[],
  invoices: readonly Invoice[],
  version: JobVersion,
): Payment[] {
  const habits = new Map<string, Habit>(
    customers.map((customer) => [
      customer.customer_id,
      random.weighted<Habit>([
        ['prompt', 6],
        ['slow', 2.5],
        ['poor', 1.5],
      ]),
    ]),
  );

  const recorded: PlannedPayment[] = [];
  for (const invoice of invoices) {
    const habit = habits.get(invoice.customer_id);
    if (!habit) throw new Error(`No payment habit for ${invoice.customer_id}`);
    for (const payment of plannedPayments(random, invoice, habit, STILL_OPEN[version])) {
      const daysAhead = daysBetween(BUSINESS_DATE, payment.date);
      if (daysAhead <= 0 || (daysAhead <= SCHEDULED_WINDOW_DAYS && random.chance(0.4))) {
        recorded.push(payment);
      }
    }
  }
  if (version !== 1) {
    recorded.push(...paymentsAroundToday(random.fork('around today'), invoices, recorded));
  }

  recorded.sort((a, b) => compareText(a.date, b.date) || compareText(a.invoice_id, b.invoice_id));
  return recorded.map((payment, index) => ({
    payment_id: `PAY-${FIRST_PAYMENT_NUMBER + index}`,
    ...payment,
  }));
}

/**
 * On the business date some customers with an overdue invoice paid part or all of it, and others
 * promised to pay what is left tomorrow: payments right on the line between received and
 * scheduled. Nothing here takes an invoice past its total.
 */
function paymentsAroundToday(
  random: Random,
  invoices: readonly Invoice[],
  recorded: readonly PlannedPayment[],
): PlannedPayment[] {
  const paid = new Map<string, number>();
  for (const payment of recorded) {
    paid.set(payment.invoice_id, (paid.get(payment.invoice_id) ?? 0) + payment.amount_cents);
  }
  const added: PlannedPayment[] = [];
  for (const invoice of invoices) {
    const open = invoice.total_cents - (paid.get(invoice.invoice_id) ?? 0);
    if (invoice.due_date >= BUSINESS_DATE || open <= 0) continue;
    const roll = random.next();
    if (roll < PAID_TODAY) {
      const all = open < 200 || random.chance(0.5);
      const amount_cents = all ? open : shareOf(random, open, 0.3, 0.7);
      added.push({ invoice_id: invoice.invoice_id, date: BUSINESS_DATE, amount_cents });
    } else if (roll < PAID_TODAY + PROMISED_TOMORROW) {
      added.push({ invoice_id: invoice.invoice_id, date: TOMORROW, amount_cents: open });
    }
  }
  return added;
}

function plannedPayments(
  random: Random,
  invoice: Invoice,
  habit: Habit,
  stillOpen: ReadonlyMap<string, number>,
): PlannedPayment[] {
  const total = invoice.total_cents;
  const terms = daysBetween(invoice.issue_date, invoice.due_date);
  /** A date relative to the due date, never before the invoice was issued. */
  const fromDue = (days: number): string => {
    const date = addDays(invoice.due_date, days);
    return date > invoice.issue_date ? date : invoice.issue_date;
  };
  const pay = (date: string, amount_cents: number): PlannedPayment => ({
    invoice_id: invoice.invoice_id,
    date,
    amount_cents,
  });

  const openChance = stillOpen.get(invoice.due_date);
  if (openChance !== undefined && random.chance(openChance)) return [];

  if (habit === 'prompt') {
    return random.chance(0.93)
      ? [pay(addDays(invoice.issue_date, random.int(0, Math.max(terms, 3))), total)]
      : [pay(fromDue(random.int(1, 20)), total)];
  }

  if (habit === 'slow') {
    if (random.chance(0.25)) {
      const first = shareOf(random, total, 0.3, 0.6);
      return [
        pay(fromDue(random.int(-5, 10)), first),
        pay(fromDue(random.int(15, 45)), total - first),
      ];
    }
    return [pay(fromDue(random.int(3, 50)), total)];
  }

  const roll = random.next();
  if (roll < 0.3) return [];
  if (roll >= 0.75) return [pay(fromDue(random.int(20, 80)), total)];

  const first = shareOf(random, total, 0.2, 0.45);
  const payments = [pay(fromDue(random.int(0, 30)), first)];
  let paid = first;
  if (random.chance(0.5)) {
    const second = shareOf(random, total - paid, 0.2, 0.5);
    payments.push(pay(fromDue(random.int(20, 50)), second));
    paid += second;
  }
  if (random.chance(0.35)) payments.push(pay(fromDue(random.int(40, 100)), total - paid));
  return payments;
}

/** Whole dollars between the two shares of `cents`, always leaving at least a dollar unpaid. */
function shareOf(random: Random, cents: number, low: number, high: number): number {
  const dollars = random.int(Math.ceil((cents * low) / 100), Math.floor((cents * high) / 100));
  return Math.max(100, Math.min(dollars * 100, cents - 100));
}
