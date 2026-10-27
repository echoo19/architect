import type { Random } from '../lib/random';
import { buildBookings } from './bookings';
import { PARTS, RATES, TAX_RATES, TECHNICIANS, TRAVEL_TIMES } from './catalog';
import { buildCustomers } from './customers';
import { buildInvoices } from './invoices';
import { buildJobs } from './jobs';
import { buildPayments } from './payments';
import type { CompanyRecords } from './types';

/**
 * Ferncliff's records as of the business date. Each part draws from its own random stream, so
 * the same seed always gives the same company.
 */
export function buildCompany(random: Random): CompanyRecords {
  const base = buildCustomers(random.fork('customers'));
  const history = buildJobs(random.fork('jobs'), base);
  const pricing = {
    customers: base.customers,
    technicians: TECHNICIANS,
    rates: RATES,
    parts: PARTS,
    jobParts: history.jobParts,
    taxRates: TAX_RATES,
  };
  const invoices = buildInvoices(random.fork('invoices'), pricing, history.jobs);
  return {
    ...pricing,
    jobs: history.jobs,
    invoices,
    payments: buildPayments(random.fork('payments'), base.customers, invoices),
    bookings: buildBookings(random.fork('bookings')),
    travel: TRAVEL_TIMES,
  };
}
