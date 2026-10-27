import type { Random } from '../lib/random';
import type { JobVersion } from '../versions';
import { buildBookings } from './bookings';
import { PARTS, RATES, TAX_RATES, TECHNICIANS, TRAVEL_TIMES } from './catalog';
import { buildCustomers } from './customers';
import { buildInvoices } from './invoices';
import { buildJobs, roundLoggedTimes } from './jobs';
import { buildPayments } from './payments';
import type { CompanyRecords } from './types';

/**
 * Ferncliff's records as of the business date. Each part draws from its own random stream, so
 * the same seed always gives the same company. Version 2 rounds some logged times and has more
 * payments fall around today; its customers, jobs, bookings and billing follow version 1's draws.
 */
export function buildCompany(random: Random, version: JobVersion): CompanyRecords {
  const base = buildCustomers(random.fork('customers'));
  const history = buildJobs(random.fork('jobs'), base);
  const jobs =
    version === 1 ? history.jobs : roundLoggedTimes(random.fork('logged times'), history.jobs);
  const pricing = {
    customers: base.customers,
    technicians: TECHNICIANS,
    rates: RATES,
    parts: PARTS,
    jobParts: history.jobParts,
    taxRates: TAX_RATES,
  };
  const invoices = buildInvoices(random.fork('invoices'), pricing, jobs);
  return {
    ...pricing,
    jobs,
    invoices,
    payments: buildPayments(random.fork('payments'), base.customers, invoices, version),
    bookings: buildBookings(random.fork('bookings')),
    travel: TRAVEL_TIMES,
  };
}
