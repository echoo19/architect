import { toCsv } from '../lib/csv';
import type { CsvCell } from '../lib/csv';
import type { JobVersion } from '../versions';
import type {
  Booking,
  Company,
  Customer,
  Invoice,
  Job,
  JobPart,
  Part,
  Payment,
  Rate,
  ServiceRequest,
  TaxRate,
  Technician,
  TravelTime,
} from './types';

/** How a record type is laid out as a CSV file: column order and cell conversion. */
interface TableLayout<Row> {
  columns: readonly string[];
  cells(row: Row): CsvCell[];
}

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');
const listCell = (values: readonly string[]): string | null =>
  values.length > 0 ? values.join(';') : null;

const CUSTOMERS: TableLayout<Customer> = {
  columns: ['customer_id', 'name', 'city', 'zone', 'plan_member', 'terms_days'],
  cells: (c) => [c.customer_id, c.name, c.city, c.zone, yesNo(c.plan_member), c.terms_days],
};

/** A customer's cells in customers.csv by column, as the agent reads them. */
export function customerCells(customer: Customer): Record<string, string | null> {
  const cells = CUSTOMERS.cells(customer);
  return Object.fromEntries(
    CUSTOMERS.columns.map((column, i) => {
      const cell = cells[i] ?? null;
      return [column, cell === null ? null : String(cell)];
    }),
  );
}

const TECHNICIANS: TableLayout<Technician> = {
  columns: [
    'technician_id',
    'name',
    'tier',
    'skills',
    'licenses',
    'work_days',
    'start_time',
    'end_time',
  ],
  cells: (t) => [
    t.technician_id,
    t.name,
    t.tier,
    listCell(t.skills),
    listCell(t.licenses),
    listCell(t.work_days),
    t.start_time,
    t.end_time,
  ],
};

const RATES: TableLayout<Rate> = {
  columns: ['tier', 'hourly_rate_cents'],
  cells: (r) => [r.tier, r.hourly_rate_cents],
};

const PARTS: TableLayout<Part> = {
  columns: ['part_id', 'name', 'unit_cost_cents', 'markup_pct', 'taxable'],
  cells: (p) => [p.part_id, p.name, p.unit_cost_cents, p.markup_pct, yesNo(p.taxable)],
};

const JOBS: TableLayout<Job> = {
  columns: [
    'job_id',
    'customer_id',
    'technician_id',
    'date',
    'work',
    'labor_minutes',
    'after_hours',
  ],
  cells: (j) => [
    j.job_id,
    j.customer_id,
    j.technician_id,
    j.date,
    j.work,
    j.labor_minutes,
    yesNo(j.after_hours),
  ],
};

const JOB_PARTS: TableLayout<JobPart> = {
  columns: ['job_id', 'part_id', 'qty'],
  cells: (l) => [l.job_id, l.part_id, l.qty],
};

const INVOICE_COLUMNS = [
  'invoice_id',
  'job_id',
  'customer_id',
  'issue_date',
  'due_date',
  'labor_cents',
  'parts_cents',
  'fees_cents',
  'discount_cents',
  'tax_cents',
  'total_cents',
] as const;

const INVOICES: TableLayout<Invoice> = {
  columns: INVOICE_COLUMNS,
  cells: (i) => INVOICE_COLUMNS.map((column) => i[column]),
};

const PAYMENTS: TableLayout<Payment> = {
  columns: ['payment_id', 'invoice_id', 'date', 'amount_cents'],
  cells: (p) => [p.payment_id, p.invoice_id, p.date, p.amount_cents],
};

/** Version 2 adds each request's time window; version 1 had none. */
const REQUESTS: Readonly<Record<JobVersion, TableLayout<ServiceRequest>>> = {
  1: {
    columns: [
      'request_id',
      'customer_id',
      'zone',
      'skill',
      'license_needed',
      'duration_minutes',
      'earliest_date',
      'problem',
    ],
    cells: (r) => [
      r.request_id,
      r.customer_id,
      r.zone,
      r.skill,
      r.license_needed,
      r.duration_minutes,
      r.earliest_date,
      r.problem,
    ],
  },
  2: {
    columns: [
      'request_id',
      'customer_id',
      'zone',
      'skill',
      'license_needed',
      'duration_minutes',
      'earliest_date',
      'window',
      'problem',
    ],
    cells: (r) => [
      r.request_id,
      r.customer_id,
      r.zone,
      r.skill,
      r.license_needed,
      r.duration_minutes,
      r.earliest_date,
      r.window,
      r.problem,
    ],
  },
};

const BOOKING_COLUMNS = [
  'booking_id',
  'request_id',
  'technician_id',
  'date',
  'start_time',
  'end_time',
  'zone',
] as const;

const BOOKINGS: TableLayout<Booking> = {
  columns: BOOKING_COLUMNS,
  cells: (b) => BOOKING_COLUMNS.map((column) => b[column]),
};

const TRAVEL: TableLayout<TravelTime> = {
  columns: ['from_zone', 'to_zone', 'minutes'],
  cells: (t) => [t.from_zone, t.to_zone, t.minutes],
};

const TAX: TableLayout<TaxRate> = {
  columns: ['city', 'rate_bp'],
  cells: (t) => [t.city, t.rate_bp],
};

function csvOf<Row>(table: TableLayout<Row>, rows: readonly Row[]): string {
  return toCsv(
    table.columns,
    rows.map((row) => table.cells(row)),
  );
}

/** Every table as CSV text, keyed by file name, in the order the job lists them. */
export function renderTables(company: Company, version: JobVersion): Record<string, string> {
  return {
    'customers.csv': csvOf(CUSTOMERS, company.customers),
    'technicians.csv': csvOf(TECHNICIANS, company.technicians),
    'rates.csv': csvOf(RATES, company.rates),
    'parts.csv': csvOf(PARTS, company.parts),
    'jobs.csv': csvOf(JOBS, company.jobs),
    'job_parts.csv': csvOf(JOB_PARTS, company.jobParts),
    'invoices.csv': csvOf(INVOICES, company.invoices),
    'payments.csv': csvOf(PAYMENTS, company.payments),
    'requests.csv': csvOf(REQUESTS[version], company.requests),
    'bookings.csv': csvOf(BOOKINGS, company.bookings),
    'travel.csv': csvOf(TRAVEL, company.travel),
    'tax.csv': csvOf(TAX, company.taxRates),
  };
}
