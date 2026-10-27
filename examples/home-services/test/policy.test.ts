import { describe, expect, it } from 'vitest';
import { daysBetween } from '../src/lib/calendar';
import { roundHalfUp } from '../src/lib/money';
import { billedMinutes, laborCents, partLineCents } from '../src/reference/pricing';
import { BOTH_VERSIONS } from './helpers';

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
