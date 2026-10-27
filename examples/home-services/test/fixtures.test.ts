import { describe, expect, it } from 'vitest';
import type { CsvRow } from '../src/lib/csv';
import { BUSINESS_DATE, answerOf, expectedSlot, latestVersion, paramsOf } from './helpers';

/**
 * Version 2's new kinds of task, worked out by hand: invoices on either side of a quarter hour,
 * bookings with time windows and at the edges of a technician's day, overdue answers on either
 * side of today, and questions about groups of customers. Each test pins the input rows exactly as
 * they are in the data files, then recomputes the answer with the arithmetic in its comments. If
 * the data changes, the pins fail first and the fixture has to be audited again.
 */

const job = latestVersion;
const task = (id: string) => job.task(id);

function expectRow(
  file: string,
  column: string,
  id: string,
  fields: Record<string, string | null>,
) {
  expect(job.rowWhere(file, column, id), `${file} ${id}`).toMatchObject(fields);
}

/** [field, field, ...] for every row matching `column` = `value`, in file order. */
function rowsAs(file: string, column: string, value: string, fields: string[]) {
  return job.rowsWhere(file, column, value).map((row) => fields.map((field) => row[field]));
}

const paymentsOf = (invoiceId: string) =>
  rowsAs('payments.csv', 'invoice_id', invoiceId, ['date', 'amount_cents']);

/** What has been received on an invoice by the business date. */
const receivedOn = (invoice: CsvRow) =>
  job
    .rowsWhere('payments.csv', 'invoice_id', String(invoice.invoice_id))
    .filter((payment) => String(payment.date) <= BUSINESS_DATE)
    .reduce((paid, payment) => paid + Number(payment.amount_cents), 0);

const membersOf = (group: Record<string, string>) =>
  job
    .table('customers.csv')
    .filter((row) => Object.entries(group).every(([column, value]) => row[column] === value))
    .map((row) => String(row.customer_id));

/** Invoices of these customers, in file order. */
const invoicesOf = (customers: string[]) =>
  job.table('invoices.csv').filter((invoice) => customers.includes(String(invoice.customer_id)));

/** The invoices among `invoices` other than `listed` must be paid in full by the business date. */
function expectPaidInFull(invoices: CsvRow[], listed: string[]) {
  for (const invoice of invoices.filter((i) => !listed.includes(String(i.invoice_id)))) {
    expect(receivedOn(invoice), String(invoice.invoice_id)).toBe(Number(invoice.total_cents));
  }
}

describe('hand-audited invoices on either side of a quarter hour', () => {
  it('rates are as the fixtures assume', () => {
    expectRow('rates.csv', 'tier', 'apprentice', { hourly_rate_cents: '8400' });
    expectRow('rates.csv', 'tier', 'journeyman', { hourly_rate_cents: '11400' });
    expectRow('rates.csv', 'tier', 'lead', { hourly_rate_cents: '13800' });
  });

  it('invoice-054: 60 minutes is on the hour, so it bills 60', () => {
    expectRow('jobs.csv', 'job_id', 'W-2489', {
      customer_id: 'C-0228',
      technician_id: 'T-01',
      labor_minutes: '60',
      after_hours: 'no',
    });
    expectRow('customers.csv', 'customer_id', 'C-0228', {
      city: 'Marlow',
      zone: 'Millbrook',
      plan_member: 'yes',
      terms_days: '30',
    });
    expectRow('technicians.csv', 'technician_id', 'T-01', { tier: 'lead' });
    expect(job.rowsWhere('job_parts.csv', 'job_id', 'W-2489')).toEqual([]);

    // Labor: 60 minutes stays 60, 1 h × 13800 = 13800. No parts, so no tax.
    // Trip fee: Millbrook, 5500. Discount: 10% of 13800 = 1380.
    // Total: 13800 + 5500 − 1380 = 17920. Due 2026-11-05 + 30 days = 2026-12-05.
    const labor = 1 * 13800;
    const discount = labor / 10;
    expect(paramsOf(task('invoice-054'))).toEqual({
      invoice_id: 'INV-2489',
      job_id: 'W-2489',
      customer_id: 'C-0228',
      issue_date: '2026-11-05',
      due_date: '2026-12-05',
      labor_cents: labor,
      parts_cents: 0,
      fees_cents: 5500,
      discount_cents: discount,
      tax_cents: 0,
      total_cents: labor + 5500 - discount,
    });
    expect(labor + 5500 - discount).toBe(17920);
  });

  it('invoice-008: 61 minutes is a minute past the hour, so it bills 75', () => {
    expectRow('jobs.csv', 'job_id', 'W-2381', {
      customer_id: 'C-0153',
      technician_id: 'T-12',
      labor_minutes: '61',
      after_hours: 'no',
    });
    expectRow('customers.csv', 'customer_id', 'C-0153', {
      city: 'Alder Bay',
      zone: 'Lakeside',
      plan_member: 'no',
      terms_days: '15',
    });
    expectRow('technicians.csv', 'technician_id', 'T-12', { tier: 'journeyman' });
    expectRow('tax.csv', 'city', 'Alder Bay', { rate_bp: '775' });
    expect(rowsAs('job_parts.csv', 'job_id', 'W-2381', ['part_id', 'qty'])).toEqual([
      ['P-106', '1'],
    ]);
    expectRow('parts.csv', 'part_id', 'P-106', {
      unit_cost_cents: '645',
      markup_pct: '50',
      taxable: 'yes',
    });

    // Labor: 61 minutes rounds up to 75, 1.25 h × 11400 = 14250.
    // Parts: 645 × 1.50 = 967.5, half up to 968. Trip fee: Lakeside, 6900. No discount.
    // Tax: 968 × 7.75% = 75.02, so 75. Total: 14250 + 968 + 6900 + 75 = 22193, due 2026-11-20.
    const labor = 1.25 * 11400;
    const parts = 968;
    const tax = 75;
    expect([645 * 1.5, 968 * 0.0775]).toEqual([967.5, 75.02]);
    expect(paramsOf(task('invoice-008'))).toEqual({
      invoice_id: 'INV-2381',
      job_id: 'W-2381',
      customer_id: 'C-0153',
      issue_date: '2026-11-05',
      due_date: '2026-11-20',
      labor_cents: labor,
      parts_cents: parts,
      fees_cents: 6900,
      discount_cents: 0,
      tax_cents: tax,
      total_cents: labor + parts + 6900 + tax,
    });
    expect(labor + parts + 6900 + tax).toBe(22193);
  });

  it('invoice-007: 75 minutes is on a quarter hour, so it bills 75', () => {
    expectRow('jobs.csv', 'job_id', 'W-2380', {
      customer_id: 'C-0224',
      technician_id: 'T-07',
      labor_minutes: '75',
      after_hours: 'no',
    });
    expectRow('customers.csv', 'customer_id', 'C-0224', {
      city: 'Ferncliff',
      zone: 'Old Town',
      plan_member: 'yes',
      terms_days: '30',
    });
    expectRow('technicians.csv', 'technician_id', 'T-07', { tier: 'journeyman' });
    expect(job.rowsWhere('job_parts.csv', 'job_id', 'W-2380')).toEqual([]);

    // Labor: 75 minutes stays 75, 1.25 h × 11400 = 14250. Trip fee: Old Town, 3900.
    // Discount: 10% of 14250 = 1425. Total: 14250 + 3900 − 1425 = 16725, due 2026-12-05.
    const labor = 1.25 * 11400;
    expect(paramsOf(task('invoice-007'))).toMatchObject({
      invoice_id: 'INV-2380',
      due_date: '2026-12-05',
      labor_cents: labor,
      parts_cents: 0,
      fees_cents: 3900,
      discount_cents: labor / 10,
      tax_cents: 0,
      total_cents: labor + 3900 - labor / 10,
    });
    expect(labor + 3900 - labor / 10).toBe(16725);
  });

  it('invoice-033: 76 minutes after hours is a minute past, so it bills 90 at 1.5 times', () => {
    expectRow('jobs.csv', 'job_id', 'W-2433', {
      customer_id: 'C-0290',
      technician_id: 'T-05',
      labor_minutes: '76',
      after_hours: 'yes',
    });
    expectRow('customers.csv', 'customer_id', 'C-0290', {
      city: 'Marlow',
      zone: 'Millbrook',
      plan_member: 'no',
      terms_days: '45',
    });
    expectRow('technicians.csv', 'technician_id', 'T-05', { tier: 'apprentice' });
    expectRow('tax.csv', 'city', 'Marlow', { rate_bp: '850' });
    expect(rowsAs('job_parts.csv', 'job_id', 'W-2433', ['part_id', 'qty'])).toEqual([
      ['P-101', '1'],
    ]);
    expectRow('parts.csv', 'part_id', 'P-101', {
      unit_cost_cents: '1235',
      markup_pct: '35',
      taxable: 'yes',
    });

    // Labor: 76 minutes rounds up to 90, 1.5 h × 8400 = 12600, × 1.5 after hours = 18900.
    // Parts: 1235 × 1.35 = 1667.25, so 1667. Trip fee: Millbrook, 5500. No discount.
    // Tax: 1667 × 8.5% = 141.695, so 142. Total: 18900 + 1667 + 5500 + 142 = 26209.
    // Due 2026-11-05 + 45 days = 2026-12-20.
    const labor = 1.5 * 8400 * 1.5;
    expect(paramsOf(task('invoice-033'))).toMatchObject({
      invoice_id: 'INV-2433',
      due_date: '2026-12-20',
      labor_cents: labor,
      parts_cents: 1667,
      fees_cents: 5500,
      discount_cents: 0,
      tax_cents: 142,
      total_cents: labor + 1667 + 5500 + 142,
    });
    expect(labor + 1667 + 5500 + 142).toBe(26209);
  });
});

describe('hand-audited bookings with time windows and at the edges of a day', () => {
  const TRAVEL: Record<string, string> = {
    'Lakeside>Harbor': '25',
    'Ridge>Harbor': '45',
    'Lakeside>Old Town': '35',
    'Lakeside>Lakeside': '10',
    'Old Town>Lakeside': '35',
    'Millbrook>Lakeside': '45',
    'Ridge>Lakeside': '55',
    'Harbor>Lakeside': '25',
    'Lakeside>Millbrook': '45',
    'Harbor>Old Town': '20',
  };

  it('travel times are as the fixtures assume', () => {
    for (const [pair, minutes] of Object.entries(TRAVEL)) {
      const [from, to] = pair.split('>');
      const row = job.table('travel.csv').find((r) => r.from_zone === from && r.to_zone === to);
      expect(row?.minutes, pair).toBe(minutes);
    }
  });

  function bookingsOn(technicianId: string, date: string) {
    return job
      .table('bookings.csv')
      .filter((row) => row.technician_id === technicianId && row.date === date)
      .map((row) => [row.booking_id, row.start_time, row.end_time, row.zone]);
  }

  function check(id: string, technicianId: string, date: string, start: string, end: string) {
    const booked = task(id);
    const row = job.bookingRow(booked, {
      technician_id: technicianId,
      date,
      start_time: start,
      end_time: end,
    });
    return job.check(booked, job.withAppended('bookings.csv', row));
  }

  it('schedule-016: a morning visit asked for on a Saturday waits for Monday at 07:30', () => {
    expectRow('requests.csv', 'request_id', 'R-3016', {
      zone: 'Harbor',
      skill: 'heating',
      license_needed: null,
      duration_minutes: '90',
      earliest_date: '2026-11-07',
      window: 'morning',
    });
    expect(bookingsOn('T-03', '2026-11-07')).toEqual([
      ['B-2038', '08:00', '10:30', 'Lakeside'],
      ['B-2039', '11:00', '12:30', 'Lakeside'],
      ['B-2040', '13:00', '14:00', 'Lakeside'],
    ]);
    expect(bookingsOn('T-01', '2026-11-09')).toEqual([
      ['B-2047', '09:30', '11:30', 'Old Town'],
      ['B-2055', '14:00', '15:30', 'Lakeside'],
    ]);
    expect(bookingsOn('T-09', '2026-11-09')).toEqual([
      ['B-2044', '07:30', '09:00', 'Ridge'],
      ['B-2050', '10:00', '11:00', 'Lakeside'],
    ]);

    // Heating: T-01, T-03, T-07, T-09, T-11. Saturday Nov 7 only T-03 works, and a 90-minute
    // morning visit must end by 12:00: 08:00 overlaps B-2038, and after it 10:30 + 25 minutes from
    // Lakeside is 10:55, so 11:00, which overlaps B-2039 and would end at 12:30. Nobody works
    // Sunday. Monday: T-01 starts at 07:30 and ends at 09:00, with 20 minutes to Old Town for
    // B-2047 at 09:30. T-09's 07:00 overlaps B-2044; T-11 and T-07 start at 08:30 and 09:00.
    // Without the window, T-03 could take Saturday 14:30 (14:00 + 25 = 14:25), ending at 16:00.
    expect(expectedSlot(task('schedule-016'))).toEqual({
      date: '2026-11-09',
      start_time: '07:30',
      end_time: '09:00',
      technician_ids: ['T-01'],
    });
    expect(check('schedule-016', 'T-01', '2026-11-09', '07:30', '09:00').pass).toBe(true);
    expect(check('schedule-016', 'T-03', '2026-11-07', '14:30', '16:00').reason).toBe(
      'This booking does not work: the customer asked for a morning visit, which must end by 12:00.',
    );
  });

  it('schedule-008: an afternoon visit starts at noon with the one technician free then', () => {
    expectRow('requests.csv', 'request_id', 'R-3008', {
      zone: 'Ridge',
      skill: 'heating',
      duration_minutes: '60',
      earliest_date: '2026-11-06',
      window: 'afternoon',
    });
    expect(bookingsOn('T-01', '2026-11-06')).toEqual([]);
    expect(bookingsOn('T-03', '2026-11-06')).toEqual([['B-2031', '12:00', '14:00', 'Harbor']]);
    expect(bookingsOn('T-07', '2026-11-06')).toEqual([
      ['B-2032', '12:00', '14:00', 'Lakeside'],
      ['B-2036', '15:30', '17:30', 'Millbrook'],
    ]);
    expect(bookingsOn('T-11', '2026-11-06')).toEqual([['B-2030', '11:30', '14:00', 'Lakeside']]);

    // Friday Nov 6; T-09 doesn't work Fridays. An afternoon visit starts at 12:00 or later:
    // T-03 and T-07 are busy from 12:00 and T-11 from 11:30, while T-01 is free all day, so
    // 12:00 to 13:00 with T-01, right on the window's edge. Ignoring the window, T-01 at 07:30.
    expect(expectedSlot(task('schedule-008'))).toEqual({
      date: '2026-11-06',
      start_time: '12:00',
      end_time: '13:00',
      technician_ids: ['T-01'],
    });
    expect(check('schedule-008', 'T-01', '2026-11-06', '12:00', '13:00').pass).toBe(true);
    expect(check('schedule-008', 'T-01', '2026-11-06', '07:30', '08:30').reason).toBe(
      'This booking does not work: the customer asked for an afternoon visit, which must start at 12:00 or later.',
    );
  });

  it('schedule-028: the free-looking 07:30 gap leaves no time to drive on, so 09:00', () => {
    expectRow('requests.csv', 'request_id', 'R-3028', {
      zone: 'Lakeside',
      skill: 'plumbing',
      license_needed: null,
      duration_minutes: '90',
      earliest_date: '2026-11-09',
      window: 'any',
    });
    expect(bookingsOn('T-02', '2026-11-09')).toEqual([
      ['B-2045', '08:00', '10:30', 'Millbrook'],
      ['B-2051', '11:30', '14:30', 'Lakeside'],
    ]);
    expect(bookingsOn('T-05', '2026-11-09')).toEqual([
      ['B-2046', '08:00', '11:00', 'Lakeside'],
      ['B-2052', '11:30', '13:00', 'Harbor'],
    ]);
    expect(bookingsOn('T-07', '2026-11-09')).toEqual([]);
    expect(bookingsOn('T-12', '2026-11-09')).toEqual([['B-2041', '07:00', '10:00', 'Lakeside']]);

    // Monday Nov 9, plumbers T-01, T-02, T-05, T-07, T-09, T-12 (bookings of T-01 and T-09 are
    // pinned above). T-01 at 07:30 would end at 09:00, but B-2047 starts at 09:30 in Old Town,
    // 35 minutes away. T-12 is booked until 10:00 (+10 = 10:30); T-09 until 09:00 then needs 55
    // minutes to Lakeside, past B-2050 at 10:00, so 11:30; T-02 and T-05 later still. T-07 has
    // no bookings and starts at 09:00: 09:00 to 10:30 is the earliest.
    expect(expectedSlot(task('schedule-028'))).toEqual({
      date: '2026-11-09',
      start_time: '09:00',
      end_time: '10:30',
      technician_ids: ['T-07'],
    });
    expect(check('schedule-028', 'T-07', '2026-11-09', '09:00', '10:30').pass).toBe(true);
    expect(check('schedule-028', 'T-01', '2026-11-09', '07:30', '09:00').reason).toBe(
      'This booking does not work: T-01 needs 35 minutes to drive on to B-2047 in Old Town, which starts at 09:30.',
    );
  });

  it('schedule-014: on a Saturday the only gap long enough ends at 16:30, with the day', () => {
    expectRow('requests.csv', 'request_id', 'R-3014', {
      zone: 'Millbrook',
      skill: 'heating',
      license_needed: null,
      duration_minutes: '90',
      earliest_date: '2026-11-07',
      window: 'any',
    });
    expectRow('technicians.csv', 'technician_id', 'T-03', {
      work_days: 'Tue;Wed;Thu;Fri;Sat',
      start_time: '08:00',
      end_time: '16:30',
    });

    // Saturday Nov 7: only T-03 does heating on Saturdays (bookings pinned above). Every drive from
    // Lakeside to Millbrook takes 45 minutes: after B-2038 (10:30) the first start is 11:30,
    // inside B-2039; after B-2039 (12:30) it is 13:30, inside B-2040; after B-2040 (14:00) it is
    // 14:45, so 15:00, and 15:00 + 90 minutes = 16:30, exactly when T-03's day ends.
    expect(expectedSlot(task('schedule-014'))).toEqual({
      date: '2026-11-07',
      start_time: '15:00',
      end_time: '16:30',
      technician_ids: ['T-03'],
    });
    expect(check('schedule-014', 'T-03', '2026-11-07', '15:00', '16:30').pass).toBe(true);
    expect(check('schedule-014', 'T-03', '2026-11-07', '15:30', '17:00').reason).toBe(
      "This booking does not work: it falls outside T-03's hours, 08:00 to 16:30.",
    );
  });
});

describe('hand-audited overdue answers on either side of today', () => {
  it('overdue-024: due today is not overdue, due yesterday is, and a payment today counts', () => {
    const due = job
      .table('invoices.csv')
      .filter((row) => String(row.due_date) >= '2026-11-03' && String(row.due_date) <= '2026-11-05')
      .map((row) => [row.invoice_id, row.due_date, row.total_cents]);
    expect(due).toEqual([
      ['INV-2104', '2026-11-03', '59735'],
      ['INV-2120', '2026-11-04', '29550'],
      ['INV-2134', '2026-11-04', '46100'],
      ['INV-2145', '2026-11-05', '17100'],
      ['INV-2242', '2026-11-03', '20854'],
      ['INV-2251', '2026-11-04', '26020'],
      ['INV-2253', '2026-11-04', '19290'],
      ['INV-2252', '2026-11-05', '20803'],
      ['INV-2257', '2026-11-05', '55610'],
      ['INV-2266', '2026-11-05', '25043'],
      ['INV-2268', '2026-11-05', '38220'],
      ['INV-2365', '2026-11-04', '28407'],
      ['INV-2490', '2026-11-03', '30873'],
      ['INV-2499', '2026-11-05', '23360'],
      ['INV-2504', '2026-11-05', '32400'],
    ]);
    expect(paymentsOf('INV-2120')).toEqual([['2026-11-05', '10600']]);
    expect(paymentsOf('INV-2490')).toEqual([['2026-11-05', '30873']]);
    expect(paymentsOf('INV-2242')).toEqual([['2026-10-16', '20854']]);
    expect(paymentsOf('INV-2365')).toEqual([['2026-10-27', '28407']]);
    for (const id of ['INV-2104', 'INV-2134', 'INV-2251', 'INV-2253']) {
      expect(paymentsOf(id), id).toEqual([]);
    }

    // The seven due Nov 5 are due today, so not overdue yet. Due Nov 4, a day ago: INV-2120 has
    // 29550 − 10600 received today = 18950 open; INV-2134, INV-2251 and INV-2253 are unpaid;
    // INV-2365 was paid in full. Due Nov 3: INV-2104 unpaid, INV-2242 paid in full, and
    // INV-2490 paid in full today, which counts. Overdue: 59735 + 18950 + 46100 + 26020 + 19290.
    const answer = answerOf(task('overdue-024'));
    expect([...(answer.invoice_ids as string[])].sort()).toEqual([
      'INV-2104',
      'INV-2120',
      'INV-2134',
      'INV-2251',
      'INV-2253',
    ]);
    expect(answer.overdue_cents).toBe(59735 + (29550 - 10600) + 46100 + 26020 + 19290);
  });

  it('overdue-025: a payment dated today settles an invoice, one dated tomorrow does not', () => {
    const due = job
      .table('invoices.csv')
      .filter(
        (row) => String(row.due_date) >= '2026-07-14' && String(row.due_date) <= '2026-07-16',
      );
    expect(due).toHaveLength(21);
    const open = ['INV-1339', 'INV-1598', 'INV-1464', 'INV-1498'];
    expect(
      open.map((id) => {
        const row = job.rowWhere('invoices.csv', 'invoice_id', id);
        return [row.customer_id, row.due_date, row.total_cents];
      }),
    ).toEqual([
      ['C-0197', '2026-07-14', '46002'],
      ['C-0048', '2026-07-14', '29355'],
      ['C-0055', '2026-07-16', '23504'],
      ['C-0166', '2026-07-16', '23653'],
    ]);
    expect(paymentsOf('INV-1339')).toEqual([]);
    expect(paymentsOf('INV-1598')).toEqual([]);
    expect(paymentsOf('INV-1464')).toEqual([
      ['2026-07-29', '8000'],
      ['2026-11-06', '15504'],
    ]);
    expect(paymentsOf('INV-1498')).toEqual([
      ['2026-07-29', '8700'],
      ['2026-08-27', '7400'],
      ['2026-11-05', '7553'],
    ]);
    expectPaidInFull(due, open);

    // INV-1498: 8700 + 7400 + 7553 (today, received) = 23653, its total, so it is paid. INV-1464:
    // only 8000 has arrived; the 15504 dated Nov 6 is tomorrow's, so 23504 − 8000 = 15504 open.
    // The other seventeen were paid in full. Overdue: 46002 + 29355 + 15504.
    expect(8700 + 7400 + 7553).toBe(23653);
    const answer = answerOf(task('overdue-025'));
    expect([...(answer.invoice_ids as string[])].sort()).toEqual([
      'INV-1339',
      'INV-1464',
      'INV-1598',
    ]);
    expect(answer.overdue_cents).toBe(46002 + 29355 + (23504 - 8000));
  });
});

describe('hand-audited questions about groups of customers', () => {
  it('overdue-058: the overdue total of the plan members in Kestrel Point', () => {
    const members = membersOf({ city: 'Kestrel Point', plan_member: 'yes' });
    expect(members).toEqual([
      'C-0008',
      'C-0025',
      'C-0049',
      'C-0123',
      'C-0136',
      'C-0158',
      'C-0167',
      'C-0205',
      'C-0259',
      'C-0317',
      'C-0321',
      'C-0385',
    ]);
    const invoices = invoicesOf(members);
    expect(invoices).toHaveLength(33);
    const listed = ['INV-2056', 'INV-2053', 'INV-2216', 'INV-2253', 'INV-2268', 'INV-2294'];
    expect(
      listed.map((id) => {
        const row = job.rowWhere('invoices.csv', 'invoice_id', id);
        return [row.customer_id, row.due_date, row.total_cents];
      }),
    ).toEqual([
      ['C-0317', '2026-10-10', '44829'],
      ['C-0008', '2026-10-11', '57444'],
      ['C-0123', '2026-10-31', '27420'],
      ['C-0385', '2026-11-04', '19290'],
      ['C-0205', '2026-11-05', '38220'],
      ['C-0008', '2026-11-08', '25974'],
    ]);
    expect(paymentsOf('INV-2056')).toEqual([
      ['2026-10-15', '25200'],
      ['2026-11-19', '19629'],
    ]);
    expect(paymentsOf('INV-2053')).toEqual([
      ['2026-10-20', '19700'],
      ['2026-11-23', '37744'],
    ]);
    for (const id of ['INV-2216', 'INV-2253', 'INV-2268', 'INV-2294']) {
      expect(paymentsOf(id), id).toEqual([]);
    }
    expectPaidInFull(invoices, listed);

    // Overdue: INV-2056 has received 25200 (the 19629 is scheduled for Nov 19), so 19629 open;
    // INV-2053 has received 19700 (37744 is scheduled for Nov 23), so 37744 open; INV-2216 and
    // INV-2253 (due yesterday, 1 day overdue) are unpaid. INV-2268 is due today and INV-2294 on
    // Nov 8, so neither is overdue. Total: 19629 + 37744 + 27420 + 19290 = 104083.
    expect(answerOf(task('overdue-058'))).toEqual({
      overdue_cents: 44829 - 25200 + (57444 - 19700) + 27420 + 19290,
    });
  });

  it('overdue-050: Marlow customers on 30-day terms more than 60 days overdue', () => {
    const members = membersOf({ city: 'Marlow', terms_days: '30' });
    expect(members).toHaveLength(19);
    const old = invoicesOf(members).filter((invoice) => String(invoice.due_date) <= '2026-09-06');
    const listed = [
      'INV-1008',
      'INV-1032',
      'INV-1095',
      'INV-1133',
      'INV-1172',
      'INV-1175',
      'INV-1196',
      'INV-1283',
      'INV-1398',
      'INV-1769',
    ];
    expect(
      listed.map((id) => {
        const row = job.rowWhere('invoices.csv', 'invoice_id', id);
        return [row.customer_id, row.due_date, row.total_cents, receivedOn(row)];
      }),
    ).toEqual([
      ['C-0170', '2026-06-06', '27189', 10500],
      ['C-0221', '2026-06-07', '28300', 7100],
      ['C-0221', '2026-06-13', '47018', 15500],
      ['C-0221', '2026-06-21', '19479', 6400 + 4100],
      ['C-0165', '2026-06-24', '31955', 11300 + 12400],
      ['C-0289', '2026-06-24', '36111', 10300 + 6800],
      ['C-0221', '2026-06-26', '30170', 9700 + 9500],
      ['C-0221', '2026-07-05', '24825', 0],
      ['C-0289', '2026-07-20', '28744', 0],
      ['C-0138', '2026-09-06', '22629', 5600 + 3500],
    ]);
    expect(paymentsOf('INV-1008')).toEqual([
      ['2026-06-11', '10500'],
      ['2026-11-06', '16689'],
    ]);
    expect(paymentsOf('INV-1172')).toEqual([
      ['2026-06-27', '11300'],
      ['2026-11-05', '12400'],
    ]);
    expectPaidInFull(old, listed);

    // More than 60 days overdue means due before Sep 6: Sep 6 to Oct 6 is 30 days and Oct 6 to
    // Nov 5 is 30 more, so INV-1769 (C-0138, due Sep 6) is exactly 60 days overdue and doesn't
    // count. C-0170 still owes 27189 − 10500 = 16689 on INV-1008, since the 16689 is dated
    // tomorrow. C-0165 owes 31955 − 11300 − 12400 = 8255 even after today's payment. C-0221 and
    // C-0289 have several unpaid June and July invoices. Every other old invoice is paid.
    expect([27189 - 10500, 31955 - 11300 - 12400]).toEqual([16689, 8255]);
    expect(answerOf(task('overdue-050'))).toEqual({
      count: 4,
      customer_ids: ['C-0165', 'C-0170', 'C-0221', 'C-0289'],
    });
  });

  it('overdue-031: a top three that a single 50-row read of invoices would miss', () => {
    const members = membersOf({ city: 'Kestrel Point', terms_days: '15' });
    expect(members).toHaveLength(25);
    const pastDue = invoicesOf(members).filter(
      (invoice) => String(invoice.due_date) < BUSINESS_DATE,
    );
    expect(pastDue).toHaveLength(65);
    const open: Record<string, [string, number][]> = {
      'C-0079': [
        ['INV-2362', 24502],
        ['INV-2353', 51999],
      ],
      'C-0109': [
        ['INV-1073', 37349],
        ['INV-1597', 35190],
      ],
      'C-0315': [['INV-2092', 54149]],
      'C-0298': [
        ['INV-1713', 25994],
        ['INV-1801', 23298],
      ],
      'C-0208': [['INV-2324', 43851]],
      'C-0211': [['INV-2305', 37531]],
      'C-0051': [['INV-2212', 33266]],
      'C-0257': [['INV-2328', 26254]],
      'C-0243': [
        ['INV-2107', 18600 - 6200 - 5300],
        ['INV-2310', 18561],
      ],
      'C-0223': [['INV-2291', 22998]],
    };
    const listed = Object.values(open).flatMap((invoices) => invoices.map(([id]) => id));
    for (const [customer, invoices] of Object.entries(open)) {
      for (const [id, balance] of invoices) {
        const row = job.rowWhere('invoices.csv', 'invoice_id', id);
        expect(row.customer_id, id).toBe(customer);
        expect(Number(row.total_cents) - receivedOn(row), id).toBe(balance);
      }
    }
    expect(paymentsOf('INV-2107')).toEqual([
      ['2026-10-14', '6200'],
      ['2026-11-02', '5300'],
    ]);
    expect(paymentsOf('INV-2328')).toEqual([['2026-11-10', '26254']]);
    expectPaidInFull(pastDue, listed);

    // Balances: C-0079 24502 + 51999 = 76501; C-0109 37349 + 35190 = 72539; C-0315 54149;
    // C-0298 25994 + 23298 = 49292, then C-0208 43851 and the rest lower. INV-2328 counts in
    // full because its payment is scheduled for Nov 10.
    expect(answerOf(task('overdue-031'))).toEqual({
      customers: [
        { customer_id: 'C-0079', overdue_cents: 24502 + 51999 },
        { customer_id: 'C-0109', overdue_cents: 37349 + 35190 },
        { customer_id: 'C-0315', overdue_cents: 54149 },
      ],
    });
    expect(25994 + 23298).toBeLessThan(54149);

    // The group has 65 past-due invoices, and C-0079's two are the newest: read 50 at a time
    // without paging, they never show up, and the top three comes out wrong.
    const position = (id: string) => pastDue.findIndex((invoice) => invoice.invoice_id === id);
    expect(position('INV-2353')).toBeGreaterThanOrEqual(50);
    expect(position('INV-2362')).toBeGreaterThanOrEqual(50);
  });
});
