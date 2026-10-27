import type { Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { CsvRow } from '../src/lib/csv';
import { BUSINESS_DATE, loadTasks, rowWhere } from './helpers';
import { daysFromTo, invoicesDueBetween, isOverdueToday, openBalance, overdueOf } from './oracles';

/**
 * The built-in comparator checks overdue answers against the expected values as written, so each
 * one is recomputed here with the oracle and checked for the shape its prompt asks for.
 */

const overdueTasks = loadTasks().filter((task) => task.type === 'overdue');

function answerOf(task: Task): Record<string, unknown> {
  if (task.expected.kind !== 'answer') throw new Error(`${task.id} is not an answer task`);
  return task.expected.value as Record<string, unknown>;
}

function compareOf(task: Task) {
  if (task.expected.kind !== 'answer') throw new Error(`${task.id} is not an answer task`);
  return task.expected.compare;
}

const kindOf = (task: Task) => task.family.split(':')[0];
const subjectOf = (task: Task) => task.family.split(':')[1] ?? '';
const total = (invoices: CsvRow[]) => invoices.reduce((sum, row) => sum + openBalance(row), 0);

/** An answer whose invoice_ids are compared as a set, with the ids sorted. */
function asSet(answer: Record<string, unknown>) {
  return { ...answer, invoice_ids: [...(answer.invoice_ids as string[])].sort() };
}

describe('overdue answers', () => {
  it('come in four kinds, with every customer in at most one customer question', () => {
    expect(new Set(overdueTasks.map(kindOf))).toEqual(
      new Set(['customer', 'call-list', 'due-window']),
    );
    const customers = overdueTasks.flatMap((task) =>
      kindOf(task) === 'due-window' ? [] : subjectOf(task).split('+'),
    );
    expect(new Set(customers).size).toBe(customers.length);
  });

  it("list exactly a customer's overdue invoices, and their total", () => {
    const tasks = overdueTasks.filter(
      (t) => kindOf(t) === 'customer' && 'invoice_ids' in answerOf(t),
    );
    expect(tasks).toHaveLength(20);
    for (const task of tasks) {
      const customer = rowWhere('customers.csv', 'customer_id', subjectOf(task));
      expect(task.prompt).toContain(String(customer.name));
      expect(task.prompt).toContain(String(customer.customer_id));
      const overdue = overdueOf(subjectOf(task));
      expect(asSet(answerOf(task)), task.id).toEqual({
        invoice_ids: overdue.map((invoice) => invoice.invoice_id).sort(),
        overdue_cents: total(overdue),
      });
      expect(compareOf(task)).toEqual({ mode: 'exact', setKeys: ['invoice_ids'] });
    }
  });

  it('name the overdue invoice with the earliest due date, its balance and its age', () => {
    const tasks = overdueTasks.filter((task) => 'days_overdue' in answerOf(task));
    expect(tasks).toHaveLength(15);
    for (const task of tasks) {
      const overdue = overdueOf(subjectOf(task)).sort((a, b) =>
        String(a.due_date) < String(b.due_date) ? -1 : 1,
      );
      const [oldest, next] = overdue;
      if (!oldest || !next) throw new Error(`${task.id} needs two overdue invoices`);
      expect(String(oldest.due_date) < String(next.due_date), `${task.id} has one oldest`).toBe(
        true,
      );
      expect(answerOf(task), task.id).toEqual({
        invoice_id: oldest.invoice_id,
        balance_cents: openBalance(oldest),
        days_overdue: daysFromTo(String(oldest.due_date), BUSINESS_DATE),
      });
      expect(compareOf(task)).toEqual({ mode: 'exact' });
    }
  });

  it('order a call list largest balance first, leaving out customers with nothing overdue', () => {
    const tasks = overdueTasks.filter((task) => kindOf(task) === 'call-list');
    expect(tasks).toHaveLength(13);
    for (const task of tasks) {
      const members = subjectOf(task).split('+');
      expect(members).toHaveLength(4);
      for (const member of members) expect(task.prompt).toContain(member);
      const owing = members
        .map((customer_id) => ({ customer_id, overdue_cents: total(overdueOf(customer_id)) }))
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
    expect(tasks).toHaveLength(12);
    for (const task of tasks) {
      const [from, to] = task.prompt.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
      if (!from || !to) throw new Error(`${task.id} names no window`);
      expect(from).toBe(subjectOf(task));
      expect(daysFromTo(from, to)).toBe(2);
      const overdue = invoicesDueBetween(from, to).filter(isOverdueToday);
      expect(asSet(answerOf(task)), task.id).toEqual({
        invoice_ids: overdue.map((invoice) => invoice.invoice_id).sort(),
        overdue_cents: total(overdue),
      });
      expect(compareOf(task)).toEqual({ mode: 'exact', setKeys: ['invoice_ids'] });
    }
  });
});
