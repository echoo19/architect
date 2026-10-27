import type { CheckResult, Expected, Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { lockedCheck } from '../src/loop/attempts';

function taskExpecting(expected: Expected): Task {
  return { id: 'invoice-007', type: 'invoice', family: 'f', prompt: 'Bill job W-2367.', expected };
}

const invoice = taskExpecting({
  kind: 'end_state',
  validator: 'invoice_created',
  params: { invoice_id: 'INV-2367', total_cents: 88901, tax_cents: 2337 },
});

const overdue = taskExpecting({
  kind: 'answer',
  value: { invoice_id: 'INV-1713', balance_cents: 25994 },
  compare: { mode: 'exact' },
});

const failed = (reason: string, details?: CheckResult['details']): CheckResult => ({
  pass: false,
  reason,
  ...(details ? { details } : {}),
});

describe('lockedCheck', () => {
  it('names the field a validator says is wrong, and drops its values and details', () => {
    const check = failed('total_cents is 88900 but should be 88901; also wrong: tax_cents.', {
      wrong: ['total_cents', 'tax_cents'],
      expected: { total_cents: 88901 },
    });
    expect(lockedCheck(invoice, check)).toEqual({
      pass: false,
      reason: 'Failed: total_cents is wrong.',
    });
  });

  it('names the field of a built-in comparison, never the expected value', () => {
    const wrong = lockedCheck(overdue, failed('Expected balance_cents to be 25994, but it is 1.'));
    expect(wrong.reason).toBe('Failed: balance_cents is wrong.');
    const missing = lockedCheck(
      overdue,
      failed('The answer has no invoice_id; expected "INV-1713".'),
    );
    expect(missing.reason).toBe('Failed: invoice_id is wrong.');
  });

  it('says only that it failed when the reason names none of the task’s fields', () => {
    const check = failed('Not the earliest slot: T-01 could start on 2026-11-06 at 07:30.');
    expect(lockedCheck(invoice, check)).toEqual({ pass: false, reason: 'Failed.' });
  });

  it('never names a key that is itself a value, such as an id', () => {
    const byCustomer = taskExpecting({
      kind: 'answer',
      value: { 'C-0412': 23150 },
      compare: { mode: 'exact' },
    });
    const check = failed('Expected C-0412 to be 23150, but it is 0.');
    expect(lockedCheck(byCustomer, check)).toEqual({ pass: false, reason: 'Failed.' });
  });

  it('matches whole field names only', () => {
    const scheduled = taskExpecting({
      kind: 'end_state',
      validator: 'booking_created',
      params: { business_date: '2026-11-05', date: '2026-11-06' },
    });
    const check = failed('business_date was ignored, so date is 2026-11-12.');
    expect(lockedCheck(scheduled, check).reason).toBe('Failed: business_date is wrong.');
  });

  it('keeps a pass a pass, without the reason that says why', () => {
    const check = { pass: true, reason: 'Invoice INV-2367 is correct, $889.01 in total.' };
    expect(lockedCheck(invoice, check)).toEqual({ pass: true, reason: 'Passed.' });
  });
});
