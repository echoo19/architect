import type { Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { JobVersion } from '../src';
import type { CsvRow } from '../src/lib/csv';
import { BOTH_VERSIONS, BUSINESS_DATE, answerOf } from './helpers';
import {
  daysFromTo,
  invoicesDueBetween,
  isOverdueToday,
  openBalance,
  overdueOf,
  totalOpen,
} from './oracles';

/**
 * The built-in comparator checks overdue answers against the expected values as written, so each
 * one is recomputed here with the oracle and checked for the shape its prompt asks for.
 */

/** How many overdue tasks of each single-customer kind a version has. */
const KIND_COUNTS: Record<JobVersion, Record<string, number>> = {
  1: { balance: 20, oldest: 15, callList: 13, window: 12 },
  2: { balance: 20, oldest: 15, callList: 13, window: 12 },
};

function compareOf(task: Task) {
  if (task.expected.kind !== 'answer') throw new Error(`${task.id} is not an answer task`);
  return task.expected.compare;
}

const kindOf = (task: Task) => task.family.split(':')[0];
const subjectOf = (task: Task) => task.family.split(':')[1] ?? '';

/** An answer whose invoice_ids are compared as a set, with the ids sorted. */
function asSet(answer: Record<string, unknown>) {
  return { ...answer, invoice_ids: [...(answer.invoice_ids as string[])].sort() };
}

describe.each(BOTH_VERSIONS)('overdue answers in version $version', (job) => {
  const overdueTasks = job.tasksOfType('overdue');
  const counts = KIND_COUNTS[job.version];
  const total = (invoices: CsvRow[]) => totalOpen(job, invoices);

  it('come only in the kinds counted here', () => {
    const counted = Object.values(counts).reduce((sum, count) => sum + count, 0);
    expect(counted).toBe(overdueTasks.length);
  });

  it('ask about every customer in at most one customer question', () => {
    const customers = overdueTasks.flatMap((task) =>
      kindOf(task) === 'customer' || kindOf(task) === 'call-list' ? subjectOf(task).split('+') : [],
    );
    expect(new Set(customers).size).toBe(customers.length);
  });

  it("list exactly a customer's overdue invoices, and their total", () => {
    const tasks = overdueTasks.filter(
      (t) => kindOf(t) === 'customer' && 'invoice_ids' in answerOf(t),
    );
    expect(tasks).toHaveLength(counts.balance as number);
    for (const task of tasks) {
      const customer = job.rowWhere('customers.csv', 'customer_id', subjectOf(task));
      expect(task.prompt).toContain(String(customer.name));
      expect(task.prompt).toContain(String(customer.customer_id));
      const overdue = overdueOf(job, subjectOf(task));
      expect(asSet(answerOf(task)), task.id).toEqual({
        invoice_ids: overdue.map((invoice) => invoice.invoice_id).sort(),
        overdue_cents: total(overdue),
      });
      expect(compareOf(task)).toEqual({ mode: 'exact', setKeys: ['invoice_ids'] });
    }
  });

  it('name the overdue invoice with the earliest due date, its balance and its age', () => {
    const tasks = overdueTasks.filter(
      (task) => kindOf(task) === 'customer' && 'days_overdue' in answerOf(task),
    );
    expect(tasks).toHaveLength(counts.oldest as number);
    for (const task of tasks) {
      const overdue = overdueOf(job, subjectOf(task)).sort((a, b) =>
        String(a.due_date) < String(b.due_date) ? -1 : 1,
      );
      const [oldest, next] = overdue;
      if (!oldest || !next) throw new Error(`${task.id} needs two overdue invoices`);
      expect(String(oldest.due_date) < String(next.due_date), `${task.id} has one oldest`).toBe(
        true,
      );
      expect(answerOf(task), task.id).toEqual({
        invoice_id: oldest.invoice_id,
        balance_cents: openBalance(job, oldest),
        days_overdue: daysFromTo(String(oldest.due_date), BUSINESS_DATE),
      });
      expect(compareOf(task)).toEqual({ mode: 'exact' });
    }
  });

  it('order a call list largest balance first, leaving out customers with nothing overdue', () => {
    const tasks = overdueTasks.filter((task) => kindOf(task) === 'call-list');
    expect(tasks).toHaveLength(counts.callList as number);
    for (const task of tasks) {
      const members = subjectOf(task).split('+');
      expect(members).toHaveLength(4);
      for (const member of members) expect(task.prompt).toContain(member);
      const owing = members
        .map((customer_id) => ({ customer_id, overdue_cents: total(overdueOf(job, customer_id)) }))
        .filter((member) => member.overdue_cents > 0)
        .sort((a, b) => b.overdue_cents - a.overdue_cents);
      expect(owing.length).toBeGreaterThan(0);
      expect(new Set(owing.map((m) => m.overdue_cents)).size, `${task.id} has a tie`).toBe(
        owing.length,
      );
      expect(answerOf(task), task.id).toEqual({ customers: owing });
      expect(compareOf(task)).toEqual({ mode: 'exact' });
      expect(task.prompt).toContain('largest balance first');
    }
  });

  it('list the overdue invoices due in a three-day window, and their total', () => {
    const tasks = overdueTasks.filter((task) => kindOf(task) === 'due-window');
    expect(tasks).toHaveLength(counts.window as number);
    for (const task of tasks) {
      const [from, to] = task.prompt.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
      if (!from || !to) throw new Error(`${task.id} names no window`);
      expect(from).toBe(subjectOf(task));
      expect(daysFromTo(from, to)).toBe(2);
      const overdue = invoicesDueBetween(job, from, to).filter((i) => isOverdueToday(job, i));
      expect(asSet(answerOf(task)), task.id).toEqual({
        invoice_ids: overdue.map((invoice) => invoice.invoice_id).sort(),
        overdue_cents: total(overdue),
      });
      expect(compareOf(task)).toEqual({ mode: 'exact', setKeys: ['invoice_ids'] });
    }
  });
});
