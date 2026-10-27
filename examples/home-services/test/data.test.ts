import { describe, expect, it } from 'vitest';
import type { CsvRow } from '../src/lib/csv';
import { BUSINESS_DATE, loadTasks, paramsOf, rowWhere, table } from './helpers';
import { priceFromCsv } from './oracles';

const minutes = (time: unknown) => {
  const [h, m] = String(time).split(':').map(Number) as [number, number];
  return h * 60 + m;
};
const weekday = (date: string) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${date}T12:00:00Z`).getUTCDay()];

function idsOf(name: string, column: string): Set<string> {
  return new Set(table(name).map((row) => String(row[column])));
}

describe('records', () => {
  it('have unique ids', () => {
    for (const [name, column] of [
      ['customers.csv', 'customer_id'],
      ['technicians.csv', 'technician_id'],
      ['parts.csv', 'part_id'],
      ['jobs.csv', 'job_id'],
      ['invoices.csv', 'invoice_id'],
      ['payments.csv', 'payment_id'],
      ['requests.csv', 'request_id'],
      ['bookings.csv', 'booking_id'],
    ] as const) {
      expect(idsOf(name, column).size, name).toBe(table(name).length);
    }
  });

  it('only refer to records that exist', () => {
    const customers = idsOf('customers.csv', 'customer_id');
    const technicians = idsOf('technicians.csv', 'technician_id');
    const refs: [string, string, Set<string>][] = [
      ['jobs.csv', 'customer_id', customers],
      ['jobs.csv', 'technician_id', technicians],
      ['job_parts.csv', 'job_id', idsOf('jobs.csv', 'job_id')],
      ['job_parts.csv', 'part_id', idsOf('parts.csv', 'part_id')],
      ['invoices.csv', 'job_id', idsOf('jobs.csv', 'job_id')],
      ['invoices.csv', 'customer_id', customers],
      ['payments.csv', 'invoice_id', idsOf('invoices.csv', 'invoice_id')],
      ['requests.csv', 'customer_id', customers],
      ['bookings.csv', 'technician_id', technicians],
    ];
    for (const [name, column, known] of refs) {
      const missing = table(name).filter((row) => !known.has(String(row[column])));
      expect(missing, `${name}.${column}`).toEqual([]);
    }
  });

  it('are about 1,500 jobs, 400 customers and 12 technicians, under 1 MB', () => {
    expect(table('jobs.csv').length).toBeGreaterThan(1400);
    expect(table('jobs.csv').length).toBeLessThan(1600);
    expect(table('customers.csv')).toHaveLength(400);
    expect(table('technicians.csv')).toHaveLength(12);
  });
});

describe('invoices and payments', () => {
  it('price every past invoice by the policy', () => {
    for (const invoice of table('invoices.csv')) {
      const { labor_cents, parts_cents, fees_cents, discount_cents, tax_cents, total_cents } =
        priceFromCsv(String(invoice.job_id));
      expect(
        [labor_cents, parts_cents, fees_cents, discount_cents, tax_cents, total_cents].map(String),
        String(invoice.invoice_id),
      ).toEqual([
        invoice.labor_cents,
        invoice.parts_cents,
        invoice.fees_cents,
        invoice.discount_cents,
        invoice.tax_cents,
        invoice.total_cents,
      ]);
    }
  });

  it('number invoices in issue order and never in the future', () => {
    const invoices = table('invoices.csv');
    for (let i = 1; i < invoices.length; i++) {
      const [before, after] = [invoices[i - 1] as CsvRow, invoices[i] as CsvRow];
      expect(String(before.issue_date) <= String(after.issue_date)).toBe(true);
      expect(String(before.invoice_id) < String(after.invoice_id)).toBe(true);
    }
    expect(invoices.at(-1)?.issue_date).toBe(BUSINESS_DATE);
  });

  it('never pay more than an invoice is for, or before it was issued', () => {
    const paid = new Map<string, number>();
    for (const payment of table('payments.csv')) {
      const invoice = rowWhere('invoices.csv', 'invoice_id', String(payment.invoice_id));
      expect(Number(payment.amount_cents)).toBeGreaterThan(0);
      expect(String(payment.date) >= String(invoice.issue_date)).toBe(true);
      const total = (paid.get(String(payment.invoice_id)) ?? 0) + Number(payment.amount_cents);
      paid.set(String(payment.invoice_id), total);
      expect(total).toBeLessThanOrEqual(Number(invoice.total_cents));
    }
  });

  it('price every invoice task the same way the oracle does', () => {
    for (const task of loadTasks().filter((t) => t.type === 'invoice')) {
      const params = paramsOf(task);
      expect(priceFromCsv(String(params.job_id)), task.id).toEqual({
        labor_cents: params.labor_cents,
        parts_cents: params.parts_cents,
        fees_cents: params.fees_cents,
        discount_cents: params.discount_cents,
        tax_cents: params.tax_cents,
        total_cents: params.total_cents,
      });
      const customer = rowWhere('customers.csv', 'customer_id', String(params.customer_id));
      expect(params.issue_date).toBe(BUSINESS_DATE);
      const due = new Date(`${BUSINESS_DATE}T12:00:00Z`);
      due.setUTCDate(due.getUTCDate() + Number(customer.terms_days));
      expect(params.due_date, task.id).toBe(due.toISOString().slice(0, 10));
    }
  });

  it('only ask for invoices of jobs that have none yet', () => {
    const invoiced = idsOf('invoices.csv', 'job_id');
    for (const task of loadTasks().filter((t) => t.type === 'invoice')) {
      expect(invoiced.has(String(paramsOf(task).job_id)), task.id).toBe(false);
    }
  });
});

describe('scheduling data', () => {
  const zones = [...new Set(table('travel.csv').map((row) => String(row.from_zone)))];
  const travel = (from: unknown, to: unknown) =>
    Number(
      table('travel.csv').find((row) => row.from_zone === from && row.to_zone === to)?.minutes,
    );

  it('lists travel for every pair of zones, symmetric and obeying the triangle rule', () => {
    expect(zones).toHaveLength(5);
    expect(table('travel.csv')).toHaveLength(25);
    for (const a of zones) {
      for (const b of zones) {
        expect(travel(a, b)).toBe(travel(b, a));
        for (const c of zones)
          expect(travel(a, c)).toBeLessThanOrEqual(travel(a, b) + travel(b, c));
      }
    }
  });

  it('has existing bookings that already follow every scheduling rule', () => {
    const byDay = new Map<string, CsvRow[]>();
    for (const booking of table('bookings.csv')) {
      const technician = rowWhere(
        'technicians.csv',
        'technician_id',
        String(booking.technician_id),
      );
      const date = String(booking.date);
      expect(String(technician.work_days).split(';')).toContain(weekday(date));
      expect(date).not.toBe('2026-11-11');
      expect(minutes(booking.start_time) % 30).toBe(0);
      expect(minutes(booking.start_time)).toBeGreaterThanOrEqual(minutes(technician.start_time));
      expect(minutes(booking.end_time)).toBeLessThanOrEqual(minutes(technician.end_time));
      expect(String(booking.booking_id).slice(2)).toBe(String(booking.request_id).slice(2));
      const key = `${booking.technician_id} ${date}`;
      byDay.set(key, [...(byDay.get(key) ?? []), booking]);
    }
    for (const day of byDay.values()) {
      const sorted = [...day].sort((a, b) => minutes(a.start_time) - minutes(b.start_time));
      for (let i = 1; i < sorted.length; i++) {
        const [before, after] = [sorted[i - 1] as CsvRow, sorted[i] as CsvRow];
        const gap = minutes(after.start_time) - minutes(before.end_time);
        expect(gap).toBeGreaterThanOrEqual(travel(before.zone, after.zone));
      }
    }
  });

  it('has one open request per task, each in its customer zone', () => {
    const requests = table('requests.csv');
    expect(requests).toHaveLength(60);
    expect(new Set(requests.map((row) => row.customer_id)).size).toBe(60);
    for (const request of requests) {
      const customer = rowWhere('customers.csv', 'customer_id', String(request.customer_id));
      expect(request.zone).toBe(customer.zone);
      expect(String(request.earliest_date) >= BUSINESS_DATE).toBe(true);
    }
  });
});
