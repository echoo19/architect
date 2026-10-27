import type { Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { CsvRow } from '../src/lib/csv';
import { earliestSlot } from '../src/reference/scheduling';
import {
  BUSINESS_DATE,
  SCHEDULING_RULES,
  expectedSlot,
  latestVersion,
  paramsOf,
  referenceSchedule,
  requestOf,
  trapsOf,
} from './helpers';
import { invoicesDueBetween, membersOf, openBalance, priceFromCsv } from './oracles';

/**
 * Version 2 puts cases on both sides of a rule's boundary into the same job, so an attempt that
 * gets one side right by luck still fails the other. Each pair is checked here on the data itself.
 */

const job = latestVersion;
const YESTERDAY = '2026-11-04';
const TOMORROW = '2026-11-06';

describe('paired boundary cases in version 2', () => {
  it('bill jobs logged right on a quarter hour and a minute past one', () => {
    // Rounded up to the next quarter hour: on a quarter it stays, a minute past adds one.
    const QUARTERS: Record<number, number> = { 60: 4, 61: 5, 75: 5, 76: 6 };
    const seen = new Set<number>();
    for (const task of job.tasksOfType('invoice')) {
      const params = paramsOf(task);
      const work = job.rowWhere('jobs.csv', 'job_id', String(params.job_id));
      const logged = Number(work.labor_minutes);
      const quarters = QUARTERS[logged];
      if (quarters === undefined) continue;
      seen.add(logged);
      const technician = job.rowWhere(
        'technicians.csv',
        'technician_id',
        String(work.technician_id),
      );
      const hourly = Number(
        job.rowWhere('rates.csv', 'tier', String(technician.tier)).hourly_rate_cents,
      );
      const perQuarter = work.after_hours === 'yes' ? (hourly * 3) / 8 : hourly / 4;
      expect(Number(params.labor_cents), task.id).toBe(quarters * perQuarter);
      expect(priceFromCsv(job, String(params.job_id)).labor_cents, task.id).toBe(
        Number(params.labor_cents),
      );
    }
    expect([...seen].sort()).toEqual([60, 61, 75, 76]);
  });

  it('ask about invoices due today and yesterday, and payments dated today and tomorrow, together', () => {
    const tasks = job.tasksOfType('overdue');
    const both = (a: string, b: string) =>
      tasks.filter((task) => trapsOf(task).includes(a) && trapsOf(task).includes(b));

    const dueEdges = both('due_today', 'due_yesterday');
    expect(dueEdges.length).toBeGreaterThanOrEqual(1);
    for (const task of dueEdges) {
      const open = coveredBy(task).filter((invoice) => openBalance(job, invoice) > 0);
      expect(
        open.some((invoice) => invoice.due_date === BUSINESS_DATE),
        task.id,
      ).toBe(true);
      expect(
        open.some((invoice) => invoice.due_date === YESTERDAY),
        task.id,
      ).toBe(true);
    }

    const paymentEdges = both('paid_today', 'paid_tomorrow');
    expect(paymentEdges.length).toBeGreaterThanOrEqual(1);
    for (const task of paymentEdges) {
      const dates = coveredBy(task).flatMap((invoice) =>
        job.rowsWhere('payments.csv', 'invoice_id', String(invoice.invoice_id)).map((p) => p.date),
      );
      expect(dates, task.id).toContain(BUSINESS_DATE);
      expect(dates, task.id).toContain(TOMORROW);
    }
  });

  it('book requests whose earlier, free-looking gap leaves no time to drive on', () => {
    const schedule = referenceSchedule(job);
    const tasks = job.tasksOfType('schedule').filter((t) => trapsOf(t).includes('travel_to_next'));
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    for (const task of tasks) {
      const careless = earliestSlot(
        schedule,
        SCHEDULING_RULES,
        requestOf(job, task),
        'drive_to_next',
      );
      const technician_id = careless.technician_ids[0] as string;
      const row = job.bookingRow(task, { ...careless, technician_id });
      expect(job.check(task, job.withAppended('bookings.csv', row)).reason, task.id).toMatch(
        new RegExp(
          `^This booking does not work: ${technician_id} needs \\d+ minutes to drive on to B-\\d+ in [A-Za-z ]+, which starts at \\d\\d:\\d\\d\\.$`,
        ),
      );
    }
  });

  it("book slots that end exactly when a technician's day does", () => {
    const tasks = job.tasksOfType('schedule').filter((t) => trapsOf(t).includes('ends_at_day_end'));
    expect(tasks.length).toBeGreaterThanOrEqual(2);
    for (const task of tasks) {
      const slot = expectedSlot(task);
      const enders = slot.technician_ids.filter(
        (id) => job.rowWhere('technicians.csv', 'technician_id', id).end_time === slot.end_time,
      );
      expect(enders.length, task.id).toBeGreaterThan(0);
      const row = job.bookingRow(task, { ...slot, technician_id: enders[0] as string });
      expect(job.check(task, job.withAppended('bookings.csv', row)).pass, task.id).toBe(true);
    }
  });
});

/** The invoices an overdue task's question covers, read from the data with the oracle. */
function coveredBy(task: Task): CsvRow[] {
  const question = task.meta?.question as Record<string, unknown>;
  const invoicesOf = (ids: readonly string[]) =>
    job.table('invoices.csv').filter((invoice) => ids.includes(String(invoice.customer_id)));
  switch (question.kind) {
    case 'customer_balance':
    case 'oldest_invoice':
      return invoicesOf([String(question.customer_id)]);
    case 'call_list':
      return invoicesOf(question.customer_ids as string[]);
    case 'due_window':
      return invoicesDueBetween(job, String(question.from), String(question.to));
    default: {
      const members = membersOf(job, question.group as Record<string, string>);
      return invoicesOf(members.map((row) => String(row.customer_id)));
    }
  }
}
