import type { Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { JobVersion } from '../src';
import type { CsvRow } from '../src/lib/csv';
import { BOTH_VERSIONS, BUSINESS_DATE, answerOf, latestVersion } from './helpers';
import {
  daysFromTo,
  invoicesDueBetween,
  isOverdueToday,
  membersOf,
  openBalance,
  overdueCentsOf,
  overdueOf,
  totalOpen,
} from './oracles';

/**
 * The built-in comparator checks overdue answers against the expected values as written, so each
 * one is recomputed here with the oracle and checked for the shape its prompt asks for.
 */

/** How many overdue tasks of each kind a version has. */
const KIND_COUNTS: Record<JobVersion, Record<string, number>> = {
  1: { balance: 20, oldest: 15, callList: 13, window: 12, group: 0 },
  2: { balance: 9, oldest: 7, callList: 7, window: 7, group: 30 },
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
    expect(overdueTasks.filter((task) => kindOf(task) === 'group')).toHaveLength(
      counts.group as number,
    );
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

interface GroupQuestion {
  kind: 'group_total' | 'group_top' | 'group_age' | 'group_owing';
  group: Record<string, string>;
  days?: number;
  over_cents?: number;
}

describe('group questions in version 2', () => {
  const job = latestVersion;
  const tasks = job.tasksOfType('overdue').filter((task) => kindOf(task) === 'group');
  const questionOf = (task: Task) => task.meta?.question as unknown as GroupQuestion;
  const ofKind = (kind: GroupQuestion['kind']) =>
    tasks.filter((task) => questionOf(task).kind === kind);

  /** Everyone in the group who owes something, largest balance first. */
  const owingIn = (group: Record<string, string>) =>
    membersOf(job, group)
      .map((row) => ({
        customer_id: String(row.customer_id),
        overdue_cents: overdueCentsOf(job, String(row.customer_id)),
      }))
      .filter((member) => member.overdue_cents > 0)
      .sort((a, b) => b.overdue_cents - a.overdue_cents);

  /** "$500", "$1,000" */
  const dollarsOf = (cents: number) =>
    `$${String(cents / 100).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;

  it('ask 8 totals, 7 top threes, 8 about age and 7 about amounts', () => {
    expect(ofKind('group_total')).toHaveLength(8);
    expect(ofKind('group_top')).toHaveLength(7);
    expect(ofKind('group_age')).toHaveLength(8);
    expect(ofKind('group_owing')).toHaveLength(7);
  });

  it('ask about each group once, naming it in the prompt the way customers.csv does', () => {
    expect(new Set(tasks.map((task) => task.family)).size).toBe(tasks.length);
    for (const task of tasks) {
      const { group } = questionOf(task);
      const key = Object.entries(group)
        .map(([column, value]) => `${column}=${value}`)
        .join(';');
      expect(task.family).toBe(`group:${key}`);
      expect(['zone', 'city', 'plan_member', 'terms_days']).toEqual(
        expect.arrayContaining(Object.keys(group)),
      );
      if (group.zone) expect(task.prompt).toContain(`the ${group.zone} zone`);
      if (group.city) expect(task.prompt).toContain(`the city of ${group.city}`);
      if (group.plan_member) expect(group.plan_member).toBe('yes');
      if (group.plan_member) expect(task.prompt).toContain('plan members');
      if (group.terms_days) expect(task.prompt).toContain(`on ${group.terms_days}-day terms`);
      const size = membersOf(job, group).length;
      expect(size, task.id).toBeGreaterThanOrEqual(5);
      expect(size, task.id).toBeLessThanOrEqual(60);
    }
  });

  it('total the overdue balances of everyone in the group', () => {
    for (const task of ofKind('group_total')) {
      const owing = owingIn(questionOf(task).group);
      const sum = owing.reduce((total, member) => total + member.overdue_cents, 0);
      expect(sum, task.id).toBeGreaterThan(0);
      expect(answerOf(task), task.id).toEqual({ overdue_cents: sum });
      expect(compareOf(task)).toEqual({ mode: 'exact' });
    }
  });

  it('rank the three largest balances, with a gap before the fourth', () => {
    for (const task of ofKind('group_top')) {
      const owing = owingIn(questionOf(task).group);
      const topFour = owing.slice(0, 4).map((member) => member.overdue_cents);
      expect(topFour, task.id).toHaveLength(4);
      expect(new Set(topFour).size, `${task.id} has a tie`).toBe(4);
      expect(answerOf(task), task.id).toEqual({ customers: owing.slice(0, 3) });
      expect(compareOf(task)).toEqual({ mode: 'exact' });
      expect(task.prompt).toMatch(/three .*largest first/is);
    }
  });

  it('count and list the customers more than N days overdue, not counting exactly N', () => {
    for (const task of ofKind('group_age')) {
      const { group, days } = questionOf(task);
      if (days === undefined) throw new Error(`${task.id} names no number of days`);
      const late = membersOf(job, group)
        .map((row) => String(row.customer_id))
        .filter((id) =>
          overdueOf(job, id).some(
            (invoice) => daysFromTo(String(invoice.due_date), BUSINESS_DATE) > days,
          ),
        )
        .sort();
      expect(late.length, task.id).toBeGreaterThan(0);
      const answer = answerOf(task);
      expect(answer.count, task.id).toBe(late.length);
      expect([...(answer.customer_ids as string[])].sort(), task.id).toEqual(late);
      expect(compareOf(task)).toEqual({ mode: 'exact', setKeys: ['customer_ids'] });
      expect(task.prompt).toContain(`more than ${days} days overdue`);
    }
  });

  it('list the customers who owe more than the amount, largest first', () => {
    for (const task of ofKind('group_owing')) {
      const { group, over_cents } = questionOf(task);
      if (over_cents === undefined) throw new Error(`${task.id} names no amount`);
      const listed = owingIn(group).filter((member) => member.overdue_cents > over_cents);
      expect(listed.length, task.id).toBeGreaterThan(0);
      expect(new Set(listed.map((m) => m.overdue_cents)).size, `${task.id} has a tie`).toBe(
        listed.length,
      );
      expect(answerOf(task), task.id).toEqual({ customers: listed });
      expect(compareOf(task)).toEqual({ mode: 'exact' });
      expect(task.prompt).toMatch(new RegExp(`(more than|above) \\${dollarsOf(over_cents)}\\b`));
      expect(task.prompt).toContain('largest first');
    }
  });
});
