import { describe, expect, it } from 'vitest';
import {
  bookingRow,
  check,
  expectedSlot,
  paramsOf,
  rowWhere,
  rowsWhere,
  table,
  taskById,
  withAppended,
} from './helpers';

/**
 * Thirteen tasks worked out by hand. Each test first pins the input rows exactly as they are in
 * the data files, then asserts the answer that was calculated on paper, step by step in the
 * comments. If the data changes, the pins fail first and the fixture has to be audited again.
 */

function expectRow(
  file: string,
  column: string,
  id: string,
  fields: Record<string, string | null>,
) {
  expect(rowWhere(file, column, id), `${file} ${id}`).toMatchObject(fields);
}

/** [id, field, field, ...] for every row matching `column` = `value`, in file order. */
function rowsAs(file: string, column: string, value: string, fields: string[]) {
  return rowsWhere(file, column, value).map((row) => fields.map((field) => row[field]));
}

function bookingsOn(technicianId: string, date: string) {
  return table('bookings.csv')
    .filter((row) => row.technician_id === technicianId && row.date === date)
    .map((row) => [row.booking_id, row.start_time, row.end_time, row.zone]);
}

function answerOf(id: string) {
  const task = taskById(id);
  if (task.expected.kind !== 'answer') throw new Error(`${id} is not an answer task`);
  return task.expected.value;
}

const RATES = { apprentice: '8400', journeyman: '11400', lead: '13800' };

describe('hand-audited invoices', () => {
  it('rates are as the fixtures assume', () => {
    for (const [tier, cents] of Object.entries(RATES)) {
      expectRow('rates.csv', 'tier', tier, { hourly_rate_cents: cents });
    }
  });

  it('invoice-053: 56 minutes after hours for a plan member, with a half-cent line', () => {
    expectRow('jobs.csv', 'job_id', 'W-2482', {
      customer_id: 'C-0094',
      technician_id: 'T-07',
      labor_minutes: '56',
      after_hours: 'yes',
    });
    expectRow('customers.csv', 'customer_id', 'C-0094', {
      city: 'Ferncliff',
      zone: 'Old Town',
      plan_member: 'yes',
      terms_days: '30',
    });
    expectRow('technicians.csv', 'technician_id', 'T-07', { tier: 'journeyman' });
    expectRow('tax.csv', 'city', 'Ferncliff', { rate_bp: '825' });
    expect(rowsAs('job_parts.csv', 'job_id', 'W-2482', ['part_id', 'qty'])).toEqual([
      ['P-102', '1'],
      ['P-103', '2'],
    ]);
    expectRow('parts.csv', 'part_id', 'P-102', {
      unit_cost_cents: '14850',
      markup_pct: '30',
      taxable: 'yes',
    });
    expectRow('parts.csv', 'part_id', 'P-103', {
      unit_cost_cents: '895',
      markup_pct: '45',
      taxable: 'yes',
    });

    // Labor: 56 minutes rounds up to 60, which is also the minimum: 1 h × 11400 × 1.5 = 17100.
    // Parts: 1 × 14850 × 1.30 = 19305; 2 × 895 × 1.45 = 2595.5, half up to 2596. Sum 21901.
    // Trip fee: Old Town, 3900. Discount: 10% of 17100 = 1710.
    // Tax: both lines taxable, 21901 × 8.25% = 1806.8325, rounds to 1807.
    // Total: 17100 + 21901 + 3900 − 1710 + 1807 = 42998. Due 2026-11-05 + 30 days = 2026-12-05.
    // The invoice takes the job's number: INV-2482.
    expect(paramsOf(taskById('invoice-053'))).toEqual({
      invoice_id: 'INV-2482',
      job_id: 'W-2482',
      customer_id: 'C-0094',
      issue_date: '2026-11-05',
      due_date: '2026-12-05',
      labor_cents: 17100,
      parts_cents: 21901,
      fees_cents: 3900,
      discount_cents: 1710,
      tax_cents: 1807,
      total_cents: 42998,
    });
  });

  it('invoice-018: four part lines, one untaxed, one where per-unit rounding differs', () => {
    expectRow('jobs.csv', 'job_id', 'W-2409', {
      customer_id: 'C-0245',
      technician_id: 'T-07',
      labor_minutes: '124',
      after_hours: 'no',
    });
    expectRow('customers.csv', 'customer_id', 'C-0245', {
      city: 'Alder Bay',
      zone: 'Lakeside',
      plan_member: 'yes',
      terms_days: '30',
    });
    expectRow('tax.csv', 'city', 'Alder Bay', { rate_bp: '775' });
    expect(rowsAs('job_parts.csv', 'job_id', 'W-2409', ['part_id', 'qty'])).toEqual([
      ['P-124', '1'],
      ['P-125', '1'],
      ['P-126', '4'],
      ['P-127', '1'],
    ]);
    expect(
      ['P-124', 'P-125', 'P-126', 'P-127'].map(
        (id) => rowsAs('parts.csv', 'part_id', id, ['unit_cost_cents', 'markup_pct', 'taxable'])[0],
      ),
    ).toEqual([
      ['2450', '45', 'yes'],
      ['2975', '40', 'yes'],
      ['2825', '35', 'yes'],
      ['2500', '0', 'no'],
    ]);

    // Labor: 124 minutes rounds up to 135 = 2.25 h × 11400 = 25650.
    // Parts: 2450 × 1.45 = 3552.5 → 3553; 2975 × 1.40 = 4165; 4 × 2825 × 1.35 = 15255
    //   (rounding the unit price first would give 4 × 3814 = 15256); recovery fee 2500.
    //   Sum 3553 + 4165 + 15255 + 2500 = 25473.
    // Trip fee: Lakeside, 6900. Discount: 10% of 25650 = 2565.
    // Tax: taxable 3553 + 4165 + 15255 = 22973 × 7.75% = 1780.4075 → 1780.
    // Total: 25650 + 25473 + 6900 − 2565 + 1780 = 57238. Due 2026-12-05.
    expect(paramsOf(taskById('invoice-018'))).toEqual({
      invoice_id: 'INV-2409',
      job_id: 'W-2409',
      customer_id: 'C-0245',
      issue_date: '2026-11-05',
      due_date: '2026-12-05',
      labor_cents: 25650,
      parts_cents: 25473,
      fees_cents: 6900,
      discount_cents: 2565,
      tax_cents: 1780,
      total_cents: 57238,
    });
  });

  it('invoice-047: a long after-hours job with an untaxed fee, net 45', () => {
    expectRow('jobs.csv', 'job_id', 'W-2471', {
      customer_id: 'C-0168',
      technician_id: 'T-07',
      labor_minutes: '200',
      after_hours: 'yes',
    });
    expectRow('customers.csv', 'customer_id', 'C-0168', {
      city: 'Ferncliff',
      zone: 'Old Town',
      plan_member: 'no',
      terms_days: '45',
    });
    expect(rowsAs('job_parts.csv', 'job_id', 'W-2471', ['part_id', 'qty'])).toEqual([
      ['P-124', '1'],
      ['P-127', '1'],
    ]);

    // Labor: 200 minutes rounds up to 210 = 3.5 h × 11400 = 39900 × 1.5 = 59850.
    // Parts: 2450 × 1.45 = 3552.5 → 3553; recovery fee 2500 (not taxable). Sum 6053.
    // Trip fee 3900, no discount. Tax: 3553 × 8.25% = 293.1225 → 293.
    // Total: 59850 + 6053 + 3900 + 293 = 70096. Due 2026-11-05 + 45 days = 2026-12-20.
    expect(paramsOf(taskById('invoice-047'))).toEqual({
      invoice_id: 'INV-2471',
      job_id: 'W-2471',
      customer_id: 'C-0168',
      issue_date: '2026-11-05',
      due_date: '2026-12-20',
      labor_cents: 59850,
      parts_cents: 6053,
      fees_cents: 3900,
      discount_cents: 0,
      tax_cents: 293,
      total_cents: 70096,
    });
  });

  it('invoice-042: labor only, by a lead, for a job finished a week ago', () => {
    expectRow('jobs.csv', 'job_id', 'W-2453', {
      customer_id: 'C-0262',
      technician_id: 'T-01',
      date: '2026-10-29',
      labor_minutes: '154',
      after_hours: 'no',
    });
    expectRow('customers.csv', 'customer_id', 'C-0262', {
      zone: 'Millbrook',
      plan_member: 'no',
      terms_days: '30',
    });
    expectRow('technicians.csv', 'technician_id', 'T-01', { tier: 'lead' });
    expect(rowsWhere('job_parts.csv', 'job_id', 'W-2453')).toEqual([]);

    // Labor: 154 minutes rounds up to 165 = 2.75 h × 13800 = 37950. No parts, so no tax.
    // Trip fee: Millbrook, 5500. Total 43450. Issued today, not on the job date.
    expect(paramsOf(taskById('invoice-042'))).toMatchObject({
      invoice_id: 'INV-2453',
      issue_date: '2026-11-05',
      due_date: '2026-12-05',
      labor_cents: 37950,
      parts_cents: 0,
      fees_cents: 5500,
      tax_cents: 0,
      total_cents: 43450,
    });
  });
});

describe('hand-audited overdue answers', () => {
  it('overdue-014: the oldest open invoice has a payment received and one only scheduled', () => {
    expect(
      rowsAs('invoices.csv', 'customer_id', 'C-0371', ['invoice_id', 'due_date', 'total_cents']),
    ).toEqual([
      ['INV-1281', '2026-07-05', '20836'],
      ['INV-1355', '2026-07-17', '29339'],
      ['INV-1654', '2026-08-21', '32557'],
      ['INV-1826', '2026-09-14', '157477'],
      ['INV-2051', '2026-10-09', '20338'],
      ['INV-2190', '2026-10-27', '18504'],
      ['INV-2275', '2026-11-07', '24106'],
      ['INV-2337', '2026-11-13', '28929'],
      ['INV-2344', '2026-11-14', '23062'],
    ]);
    expect(rowsAs('payments.csv', 'invoice_id', 'INV-2051', ['date', 'amount_cents'])).toEqual([
      ['2026-10-08', '6300'],
      ['2026-11-23', '14038'],
    ]);
    expect(rowsWhere('payments.csv', 'invoice_id', 'INV-2190')).toEqual([]);

    // The four oldest invoices were paid in full (checked below), so the overdue ones are
    // INV-2051 (due Oct 9) and INV-2190 (due Oct 27); the rest fall due after today.
    // INV-2051 has received 6300; the 14038 on Nov 23 is scheduled, so 14038 is still open.
    // Days overdue: Oct 9 to Oct 31 is 22 days, plus 5 days of November = 27.
    for (const id of ['INV-1281', 'INV-1355', 'INV-1654', 'INV-1826']) {
      const paid = rowsAs('payments.csv', 'invoice_id', id, ['amount_cents']).flat();
      expect(paid).toEqual([rowWhere('invoices.csv', 'invoice_id', id).total_cents]);
    }
    expect(answerOf('overdue-014')).toEqual({
      invoice_id: 'INV-2051',
      balance_cents: 14038,
      days_overdue: 27,
    });
  });

  it('overdue-033: a partly paid invoice whose remainder is only scheduled', () => {
    expect(
      rowsAs('invoices.csv', 'customer_id', 'C-0008', ['invoice_id', 'due_date', 'total_cents']),
    ).toEqual([
      ['INV-1146', '2026-06-21', '21712'],
      ['INV-1191', '2026-06-28', '22530'],
      ['INV-1950', '2026-09-27', '164637'],
      ['INV-2053', '2026-10-11', '57444'],
      ['INV-2294', '2026-11-08', '25974'],
    ]);
    expect(rowsAs('payments.csv', 'invoice_id', 'INV-2053', ['date', 'amount_cents'])).toEqual([
      ['2026-10-20', '19700'],
      ['2026-11-23', '37744'],
    ]);
    for (const id of ['INV-1146', 'INV-1191', 'INV-1950']) {
      const paid = rowsAs('payments.csv', 'invoice_id', id, ['amount_cents']).flat();
      expect(paid).toEqual([rowWhere('invoices.csv', 'invoice_id', id).total_cents]);
    }

    // The first three are paid in full. INV-2053: 57444 − 19700 = 37744 open; the Nov 23
    // payment hasn't arrived. INV-2294 falls due on Nov 8, so it isn't overdue yet.
    expect(answerOf('overdue-033')).toEqual({ invoice_ids: ['INV-2053'], overdue_cents: 37744 });
  });

  it('overdue-032: an invoice due today is not overdue, so nothing is', () => {
    const open = rowsAs('invoices.csv', 'customer_id', 'C-0372', ['invoice_id', 'due_date']).filter(
      ([id]) => rowsWhere('payments.csv', 'invoice_id', String(id)).length === 0,
    );
    expect(open).toEqual([
      ['INV-2145', '2026-11-05'],
      ['INV-2271', '2026-11-22'],
    ]);
    // Every other invoice of C-0372 is paid in full; the two open ones are due today and later.
    expect(answerOf('overdue-032')).toEqual({ invoice_ids: [], overdue_cents: 0 });
  });

  it('overdue-053: the three days up to today, with a payment that arrived today', () => {
    const due = table('invoices.csv')
      .filter((row) => String(row.due_date) >= '2026-11-03' && String(row.due_date) <= '2026-11-05')
      .map((row) => [row.invoice_id, row.due_date, row.total_cents]);
    expect(due).toEqual([
      ['INV-2104', '2026-11-03', '56285'],
      ['INV-2120', '2026-11-04', '29550'],
      ['INV-2134', '2026-11-04', '46100'],
      ['INV-2145', '2026-11-05', '17100'],
      ['INV-2242', '2026-11-03', '20854'],
      ['INV-2251', '2026-11-04', '28585'],
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
    expect(rowsAs('payments.csv', 'invoice_id', 'INV-2490', ['date', 'amount_cents'])).toEqual([
      ['2026-11-05', '30873'],
    ]);
    for (const id of ['INV-2134', 'INV-2242', 'INV-2251', 'INV-2253', 'INV-2365']) {
      const paid = rowsAs('payments.csv', 'invoice_id', id, ['amount_cents']).flat();
      expect(paid, id).toEqual([rowWhere('invoices.csv', 'invoice_id', id).total_cents]);
    }
    expect(rowsWhere('payments.csv', 'invoice_id', 'INV-2104')).toEqual([]);
    expect(rowsWhere('payments.csv', 'invoice_id', 'INV-2120')).toEqual([]);

    // Due Nov 5 means not overdue yet. Of those due Nov 3 and 4, INV-2490 was paid today
    // (a payment dated on the business date counts), and five more were paid earlier. Left
    // overdue: INV-2104 (56285) and INV-2120 (29550), 85835 in all.
    const answer = answerOf('overdue-053') as { invoice_ids: string[]; overdue_cents: number };
    expect([...answer.invoice_ids].sort()).toEqual(['INV-2104', 'INV-2120']);
    expect(answer.overdue_cents).toBe(85835);
  });
});

describe('hand-audited bookings', () => {
  const TRAVEL = {
    'Millbrook>Ridge': '20',
    'Millbrook>Harbor': '35',
    'Lakeside>Harbor': '25',
    'Old Town>Harbor': '20',
    'Harbor>Harbor': '10',
    'Millbrook>Old Town': '20',
  };

  it('travel times are as the fixtures assume', () => {
    for (const [pair, minutes] of Object.entries(TRAVEL)) {
      const [from, to] = pair.split('>');
      const row = table('travel.csv').find((r) => r.from_zone === from && r.to_zone === to);
      expect(row?.minutes, pair).toBe(minutes);
    }
  });

  function passes(id: string, technicianId: string) {
    const task = taskById(id);
    const slot = { ...expectedSlot(task), technician_id: technicianId };
    return check(task, withAppended('bookings.csv', bookingRow(task, slot))).pass;
  }

  it('schedule-001: asked for today, so it starts tomorrow; Wes is booked first thing', () => {
    expectRow('requests.csv', 'request_id', 'R-3001', {
      zone: 'Ridge',
      skill: 'plumbing',
      license_needed: null,
      duration_minutes: '120',
      earliest_date: '2026-11-05',
    });
    expect(bookingsOn('T-01', '2026-11-06')).toEqual([]);
    expect(bookingsOn('T-12', '2026-11-06')).toEqual([['B-2021', '07:00', '09:00', 'Millbrook']]);

    // Never on the business date, so Friday Nov 6. Plumbers working Fridays start at 07:00
    // (T-12), 07:30 (T-01), 08:00 (T-02, T-05) and 09:00 (T-07); T-09 is off on Fridays.
    // T-12 is booked 07:00 to 09:00 and then needs 20 minutes from Millbrook, so 09:30 at best.
    // T-01 has a free day: 07:30 to 09:30. Nobody can start earlier than that.
    expect(expectedSlot(taskById('schedule-001'))).toEqual({
      date: '2026-11-06',
      start_time: '07:30',
      end_time: '09:30',
      technician_ids: ['T-01'],
    });
    expect(passes('schedule-001', 'T-01')).toBe(true);
  });

  it('schedule-027: travel and the half-hour grid push the first slot to 11:00', () => {
    expectRow('requests.csv', 'request_id', 'R-3027', {
      zone: 'Harbor',
      skill: 'electrical',
      duration_minutes: '60',
      earliest_date: '2026-11-09',
    });
    expect(bookingsOn('T-06', '2026-11-09')).toEqual([
      ['B-2043', '07:30', '10:00', 'Millbrook'],
      ['B-2054', '12:30', '14:00', 'Harbor'],
    ]);
    expect(bookingsOn('T-04', '2026-11-09')).toEqual([
      ['B-2042', '07:30', '09:00', 'Lakeside'],
      ['B-2049', '10:00', '11:00', 'Old Town'],
      ['B-2053', '12:00', '14:00', 'Lakeside'],
    ]);

    // Monday: only T-04 and T-06 do electrical work (T-08 and T-10 work Tuesday to Saturday).
    // T-06: 07:00 would run into B-2043. After it ends at 10:00 the drive from Millbrook takes
    // 35 minutes, so 10:35, and the grid makes it 11:00. 11:00 to 12:00, then 10 minutes to
    // reach B-2054 in Harbor at 12:30: fine.
    // T-04: blocked until 09:00, 09:25 rounds to 09:30 but 10:30 would overlap B-2049; after
    // 11:00 the drive gives 11:30, which overlaps B-2053 at 12:00; then nothing until 14:30.
    expect(expectedSlot(taskById('schedule-027'))).toEqual({
      date: '2026-11-09',
      start_time: '11:00',
      end_time: '12:00',
      technician_ids: ['T-06'],
    });
    expect(passes('schedule-027', 'T-06')).toBe(true);
    expect(passes('schedule-027', 'T-04')).toBe(false);
  });

  it('schedule-019: a Sunday request, and two technicians tied at the earliest start', () => {
    expectRow('requests.csv', 'request_id', 'R-3019', {
      zone: 'Harbor',
      skill: 'electrical',
      duration_minutes: '90',
      earliest_date: '2026-11-08',
    });

    // Nobody works Sundays, and T-08 and T-10 don't work Mondays, so Monday with T-04 or T-06
    // (their bookings are pinned in the schedule-027 fixture).
    // T-06: after B-2043 the first grid time is 11:00, but 11:00 + 90 = 12:30 leaves no time to
    // drive to B-2054 (10 minutes); after B-2054 ends at 14:00, 14:10 rounds to 14:30.
    // T-04: 09:30 to 11:00 overlaps B-2049, 11:30 to 13:00 overlaps B-2053; after it, 14:00 +
    // 25 minutes from Lakeside = 14:25, so 14:30, ending at 16:00, exactly the end of the day.
    expect(expectedSlot(taskById('schedule-019'))).toEqual({
      date: '2026-11-09',
      start_time: '14:30',
      end_time: '16:00',
      technician_ids: ['T-04', 'T-06'],
    });
    expect(passes('schedule-019', 'T-04')).toBe(true);
    expect(passes('schedule-019', 'T-06')).toBe(true);
  });

  it('schedule-045: asked for the closed Wednesday, so Thursday', () => {
    expectRow('requests.csv', 'request_id', 'R-3045', {
      zone: 'Old Town',
      skill: 'heating',
      license_needed: 'gas',
      duration_minutes: '120',
      earliest_date: '2026-11-11',
    });
    expect(bookingsOn('T-09', '2026-11-12')).toEqual([]);

    // Heating with a gas license: T-01 (07:30), T-03 (08:00), T-07 (09:00), T-09 (07:00).
    // Wednesday Nov 11 is the closed day. On Thursday T-09 has no bookings and starts at 07:00,
    // earlier than anyone else can.
    expect(expectedSlot(taskById('schedule-045'))).toEqual({
      date: '2026-11-12',
      start_time: '07:00',
      end_time: '09:00',
      technician_ids: ['T-09'],
    });
    expect(passes('schedule-045', 'T-09')).toBe(true);
  });

  it('schedule-014: a backflow test from Saturday waits until Monday', () => {
    expectRow('requests.csv', 'request_id', 'R-3014', {
      zone: 'Millbrook',
      skill: 'plumbing',
      license_needed: 'backflow',
      duration_minutes: '60',
      earliest_date: '2026-11-07',
    });
    expect(bookingsOn('T-01', '2026-11-09')).toEqual([
      ['B-2047', '09:30', '11:30', 'Old Town'],
      ['B-2055', '14:00', '15:30', 'Lakeside'],
    ]);

    // Only T-01 and T-02 hold the backflow license, and both work Monday to Friday, so the
    // first day is Monday Nov 9. T-01 at 07:30 ends at 08:30 and needs 20 minutes from
    // Millbrook to Old Town to make B-2047 at 09:30: fine. T-02 starts at 08:00 at the earliest.
    expect(expectedSlot(taskById('schedule-014'))).toEqual({
      date: '2026-11-09',
      start_time: '07:30',
      end_time: '08:30',
      technician_ids: ['T-01'],
    });
    expect(passes('schedule-014', 'T-01')).toBe(true);
  });
});
