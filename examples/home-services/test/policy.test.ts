import { describe, expect, it } from 'vitest';
import type { ServiceRequest, Technician, TimeWindow } from '../src/company/types';
import { daysBetween } from '../src/lib/calendar';
import { roundHalfUp } from '../src/lib/money';
import { answerQuestion } from '../src/reference/overdue-questions';
import { billedMinutes, laborCents, partLineCents } from '../src/reference/pricing';
import { buildSchedule, slotProblem } from '../src/reference/scheduling';
import { BOTH_VERSIONS, latestVersion } from './helpers';

/** The worked examples in policy.md are what the agent learns from, so they must be right. */

const job = (labor_minutes: number, after_hours: boolean) => ({
  job_id: 'W-0000',
  customer_id: 'C-0000',
  technician_id: 'T-00',
  date: '2026-11-05',
  work: 'Example',
  labor_minutes,
  after_hours,
});

const part = (unit_cost_cents: number, markup_pct: number, taxable: boolean) => ({
  part_id: 'P-000',
  name: 'Example',
  unit_cost_cents,
  markup_pct,
  taxable,
});

describe.each(BOTH_VERSIONS)('policy.md of version $version', (folder) => {
  const policy = folder.file('data/policy.md');

  it('states the business date and the closed day', () => {
    expect(policy).toContain('**Thursday, November 5, 2026** (2026-11-05)');
    expect(policy).toContain('closed on Wednesday, November 11, 2026');
  });

  it('bills minutes the way it says', () => {
    expect(policy).toContain('47 minutes bills 60, 61 bills 75, 95 bills 105');
    expect([47, 61, 95].map(billedMinutes)).toEqual([60, 75, 105]);
    expect(policy).toContain('1717.5 becomes 1718 and 1717.49 becomes 1717');
    expect(roundHalfUp(17175, 10)).toBe(1718);
    expect(roundHalfUp(171749, 100)).toBe(1717);
  });

  it('numbers invoices after their jobs, as the data does', () => {
    expect(policy).toContain(
      "`invoice_id` is INV- plus the job's number: job W-1234 gets INV-1234.",
    );
    expect(folder.rowWhere('invoices.csv', 'job_id', 'W-1234').invoice_id).toBe('INV-1234');
  });

  it('prices its invoice example the way the reference does', () => {
    const labor = laborCents(job(50, true), 11400);
    const line = partLineCents(2, part(1235, 35, true));
    const permit = partLineCents(1, part(7500, 0, false));
    const discount = roundHalfUp(labor * 10, 100);
    const tax = roundHalfUp(line * 850, 10_000);
    expect([labor, line, permit, discount, tax]).toEqual([17100, 3335, 7500, 1710, 283]);
    expect(labor + line + permit + 5500 - discount + tax).toBe(32008);
    expect(policy).toContain('17100 + 10835 + 5500 − 1710 + 283 = 32008');
  });

  it('counts days overdue the way it says', () => {
    expect(daysBetween('2026-10-31', '2026-11-05')).toBe(5);
    expect(daysBetween('2026-10-20', '2026-11-05')).toBe(16);
    expect(policy).toContain('Today it is 16 days overdue, with a balance of 20000.');
  });

  it('uses travel times from travel.csv in its scheduling example', () => {
    const minutes = (from: string, to: string) =>
      folder.table('travel.csv').find((row) => row.from_zone === from && row.to_zone === to)
        ?.minutes;
    expect(minutes('Harbor', 'Ridge')).toBe('45');
    expect(minutes('Ridge', 'Old Town')).toBe('30');
    expect(policy).toContain('The new job is in Ridge, 45 minutes from Harbor');
    expect(policy).toContain('with the 30-minute drive from Ridge to Old Town');
  });
});

describe('policy.md of version 2', () => {
  const policy = latestVersion.file('data/policy.md');

  it('works its group example out the way the reference does', () => {
    expect(policy).toContain(
      "Example: in a group of three, A owes 12000 on one invoice that is 31 days overdue. B's only overdue invoice is for 20000 and exactly 30 days overdue, and B paid 5000 of it today, so B owes 15000. C has nothing overdue. The group's overdue total is 27000. Only A is more than 30 days overdue. Largest first, B owes 15000 and A 12000. Nobody owes more than $150 (15000).",
    );
    const today = '2026-11-05';
    const invoices = [
      { invoice_id: 'INV-1', customer_id: 'A', due_date: '2026-10-05', total_cents: 12000 },
      { invoice_id: 'INV-2', customer_id: 'B', due_date: '2026-10-06', total_cents: 20000 },
      { invoice_id: 'INV-3', customer_id: 'C', due_date: '2026-10-01', total_cents: 9000 },
    ];
    const payments = [
      { invoice_id: 'INV-2', date: today, amount_cents: 5000 },
      { invoice_id: 'INV-3', date: '2026-10-02', amount_cents: 9000 },
    ];
    expect([daysBetween('2026-10-05', today), daysBetween('2026-10-06', today)]).toEqual([31, 30]);
    const group = { zone: 'Harbor' };
    const answer = (question: Parameters<typeof answerQuestion>[0]) =>
      answerQuestion(question, invoices, payments, today);
    expect(answer({ kind: 'group_total', group })).toEqual({ overdue_cents: 27000 });
    expect(answer({ kind: 'group_age', group, days: 30 })).toEqual({
      count: 1,
      customer_ids: ['A'],
    });
    expect(answer({ kind: 'group_top', group, count: 2 })).toEqual({
      customers: [
        { customer_id: 'B', overdue_cents: 15000 },
        { customer_id: 'A', overdue_cents: 12000 },
      ],
    });
    expect(answer({ kind: 'group_owing', group, over_cents: 15000 })).toEqual({ customers: [] });
  });

  it('states the time window rule and gives an example the reference agrees with', () => {
    expect(policy).toContain(
      "- **Time window.** The request's `window` says when the customer can be visited: `morning` means the booking ends by 12:00, `afternoon` means it starts at 12:00 or later, and `any` adds no limit.",
    );
    expect(policy).toContain(
      'Example: a 120-minute `morning` request can start at 10:00 at the latest, ending exactly at 12:00. A 90-minute `afternoon` request can start at 12:00 at the earliest; with a technician who works until 16:00 it can start as late as 14:30, ending exactly at the end of their day.',
    );
    const technician: Technician = {
      technician_id: 'T-00',
      name: 'Example',
      tier: 'journeyman',
      skills: ['plumbing'],
      licenses: [],
      work_days: ['Thu'],
      start_time: '08:00',
      end_time: '16:00',
    };
    const schedule = buildSchedule([technician], [], []);
    const rules = { businessDate: '2026-11-05', closedDates: [], slotMinutes: 30, noon: 12 * 60 };
    const problemAt = (window: TimeWindow, duration_minutes: number, time: string) => {
      const request: ServiceRequest = {
        request_id: 'R-0000',
        customer_id: 'C-0000',
        zone: 'Harbor',
        skill: 'plumbing',
        license_needed: null,
        duration_minutes,
        earliest_date: '2026-11-12',
        window,
        problem: 'Example',
      };
      const [h, m] = time.split(':').map(Number) as [number, number];
      return slotProblem(schedule, rules, technician, request, '2026-11-12', h * 60 + m);
    };
    expect(problemAt('morning', 120, '10:00')).toBeNull();
    expect(problemAt('morning', 120, '10:30')).toBe('window');
    expect(problemAt('afternoon', 90, '11:30')).toBe('window');
    expect(problemAt('afternoon', 90, '12:00')).toBeNull();
    expect(problemAt('afternoon', 90, '14:30')).toBeNull();
    expect(problemAt('afternoon', 90, '15:00')).toBe('hours');
  });
});
