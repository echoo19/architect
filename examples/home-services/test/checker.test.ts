import vm from 'node:vm';
import type { Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { Booking, ServiceRequest, Technician, TravelTime } from '../src/company/types';
import type { CsvRow } from '../src/lib/csv';
import { buildSchedule, earliestSlot } from '../src/reference/scheduling';
import {
  BOTH_VERSIONS,
  BUSINESS_DATE,
  expectedInvoiceRow,
  expectedSlot,
  latestVersion,
  paramsOf,
} from './helpers';
import type { JobFolder } from './helpers';
import { nearestHalfUp, priceFromCsv } from './oracles';

const hasTrap = (task: Task, trap: string) => (task.meta?.traps as string[]).includes(trap);
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clock = (total: number) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
const nextDay = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
};
const weekday = (date: string) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${date}T12:00:00Z`).getUTCDay()];

describe.each(BOTH_VERSIONS)('the checker sandbox of version $version', (job) => {
  it('has no clock and no randomness, and still defines the validators', () => {
    const sandbox = job.checkerSandbox();
    expect(vm.runInContext('typeof Date', sandbox)).toBe('undefined');
    expect(vm.runInContext('typeof Math.random', sandbox)).toBe('undefined');
    expect(vm.runInContext('Object.keys(validators).sort().join()', sandbox)).toBe(
      'booking_created,invoice_created',
    );
  });
});

describe.each(BOTH_VERSIONS)('invoice_created in version $version', (job) => {
  const invoiceTasks = job.tasksOfType('invoice');

  it('passes the ground-truth invoice for every invoice task', () => {
    for (const task of invoiceTasks) {
      const result = job.check(task, job.withAppended('invoices.csv', expectedInvoiceRow(task)));
      expect(result, task.id).toMatchObject({ pass: true });
    }
  });

  it('expects every invoice to take its own job number, so no id is right for two tasks', () => {
    for (const task of invoiceTasks) {
      const { invoice_id, job_id } = paramsOf(task);
      expect(invoice_id, task.id).toBe(String(job_id).replace(/^W-/, 'INV-'));
    }
    const ids = new Set(invoiceTasks.map((task) => paramsOf(task).invoice_id));
    expect(ids.size).toBe(invoiceTasks.length);
  });

  const task = invoiceTasks[0] as Task;
  const right = expectedInvoiceRow(task);
  const wrong = (changes: Record<string, string>) =>
    job.check(task, job.withAppended('invoices.csv', { ...right, ...changes }));

  it('fails an invoice numbered one past the highest id, or with a reused id', () => {
    const highest = Math.max(
      ...job.table('invoices.csv').map((row) => Number(String(row.invoice_id).slice(4))),
    );
    const last = String(job.table('invoices.csv').at(-1)?.invoice_id);
    for (const id of [`INV-${highest + 1}`, last]) {
      expect(id).not.toBe(right.invoice_id);
      expect(wrong({ invoice_id: id })).toEqual({
        pass: false,
        reason: `invoice_id is "${id}" but should be ${right.invoice_id}.`,
        details: expect.any(Object),
      });
    }
  });

  it('fails an issue date taken from the job instead of today', () => {
    const late = invoiceTasks.find((t) => {
      const work = job.rowWhere('jobs.csv', 'job_id', String(paramsOf(t).job_id));
      return work.date !== BUSINESS_DATE;
    }) as Task;
    const work = job.rowWhere('jobs.csv', 'job_id', String(paramsOf(late).job_id));
    const result = job.check(
      late,
      job.withAppended('invoices.csv', {
        ...expectedInvoiceRow(late),
        issue_date: String(work.date),
      }),
    );
    expect(result.reason).toBe(`issue_date is "${work.date}" but should be ${BUSINESS_DATE}.`);
  });

  it('fails amounts written in dollars', () => {
    const dollars = (Number(right.total_cents) / 100).toFixed(2);
    expect(wrong({ total_cents: dollars }).reason).toBe(
      `total_cents is "${dollars}" but should be ${right.total_cents}.`,
    );
  });

  it('fails parts rounded per unit instead of per line', () => {
    const rounded = invoiceTasks.find((t) => hasTrap(t, 'per_line_rounding')) as Task;
    const jobId = String(paramsOf(rounded).job_id);
    const perUnit = job.rowsWhere('job_parts.csv', 'job_id', jobId).reduce((sum, line) => {
      const part = job.rowWhere('parts.csv', 'part_id', String(line.part_id));
      const unit = nearestHalfUp(
        Number(part.unit_cost_cents) * (100 + Number(part.markup_pct)),
        100,
      );
      return sum + Number(line.qty) * unit;
    }, 0);
    const expected = expectedInvoiceRow(rounded);
    expect(String(perUnit)).not.toBe(expected.parts_cents);
    const result = job.check(
      rounded,
      job.withAppended('invoices.csv', { ...expected, parts_cents: String(perUnit) }),
    );
    expect(result.reason).toBe(
      `parts_cents is "${perUnit}" but should be ${expected.parts_cents}.`,
    );
  });

  it('fails tax charged on parts that are not taxable', () => {
    const untaxed = invoiceTasks.find((t) => {
      const priced = priceFromCsv(job, String(paramsOf(t).job_id));
      return hasTrap(t, 'untaxed_part') && priced.parts_cents > 0;
    }) as Task;
    const params = paramsOf(untaxed);
    const customer = job.rowWhere('customers.csv', 'customer_id', String(params.customer_id));
    const rate = Number(job.rowWhere('tax.csv', 'city', String(customer.city)).rate_bp);
    const taxOnAll = nearestHalfUp(Number(params.parts_cents) * rate, 10_000);
    const expected = expectedInvoiceRow(untaxed);
    const total = Number(expected.total_cents) - Number(expected.tax_cents) + taxOnAll;
    const result = job.check(
      untaxed,
      job.withAppended('invoices.csv', {
        ...expected,
        tax_cents: String(taxOnAll),
        total_cents: String(total),
      }),
    );
    expect(result.reason).toBe(
      `tax_cents is "${taxOnAll}" but should be ${expected.tax_cents}; also wrong: total_cents.`,
    );
  });

  it('fails a plan discount taken off parts as well as labor', () => {
    const member = invoiceTasks.find(
      (t) => hasTrap(t, 'plan_discount') && Number(paramsOf(t).parts_cents) > 0,
    ) as Task;
    const expected = expectedInvoiceRow(member);
    const discount = nearestHalfUp(Number(expected.labor_cents) + Number(expected.parts_cents), 10);
    const total = Number(expected.total_cents) + Number(expected.discount_cents) - discount;
    const result = job.check(
      member,
      job.withAppended('invoices.csv', {
        ...expected,
        discount_cents: String(discount),
        total_cents: String(total),
      }),
    );
    expect(result.reason).toBe(
      `discount_cents is "${discount}" but should be ${expected.discount_cents}; also wrong: total_cents.`,
    );
  });

  it('fails two new rows, no new row, and a changed existing row', () => {
    const second = { ...right, invoice_id: 'INV-99999', job_id: 'W-0000' };
    expect(job.check(task, job.withAppended('invoices.csv', right, second)).reason).toBe(
      'Expected one new invoice row, found 2.',
    );
    expect(job.check(task, job.contextWith({})).reason).toBe('No new invoice row was added.');
    const [first, ...rest] = job.table('invoices.csv') as [CsvRow, ...CsvRow[]];
    const edited = [{ ...first, total_cents: '1' }, ...rest, right];
    expect(job.check(task, job.contextWith({ 'invoices.csv': edited })).reason).toBe(
      `An existing invoice row was changed or deleted (${first.invoice_id}).`,
    );
  });

  it('fails an invoice for a different job', () => {
    const other = String(paramsOf(invoiceTasks[1] as Task).job_id);
    expect(wrong({ job_id: other }).reason).toBe(
      `The new invoice is for job "${other}" instead of ${right.job_id}.`,
    );
  });
});

/** The scheduling tables as typed records, for the reference search. */
function referenceSchedule(job: JobFolder) {
  const list = (cell: string | null | undefined) => (cell ? cell.split(';') : []);
  return buildSchedule(
    job.table('technicians.csv').map(
      (row) =>
        ({
          ...row,
          skills: list(row.skills),
          licenses: list(row.licenses),
          work_days: list(row.work_days),
        }) as unknown as Technician,
    ),
    job.table('bookings.csv') as unknown as Booking[],
    job
      .table('travel.csv')
      .map((row) => ({ ...row, minutes: Number(row.minutes) }) as unknown as TravelTime),
  );
}

function requestOf(job: JobFolder, task: Task): ServiceRequest {
  const row = job.rowWhere('requests.csv', 'request_id', String(paramsOf(task).request_id));
  return { ...row, duration_minutes: Number(row.duration_minutes) } as unknown as ServiceRequest;
}

function qualified(job: JobFolder, task: Task) {
  const request = requestOf(job, task);
  return job
    .table('technicians.csv')
    .filter(
      (t) =>
        String(t.skills).split(';').includes(request.skill) &&
        (request.license_needed === null ||
          String(t.licenses).split(';').includes(request.license_needed)),
    );
}

describe.each(BOTH_VERSIONS)('booking_created in version $version', (job) => {
  const scheduleTasks = job.tasksOfType('schedule');

  function slotRow(task: Task, technicianId: string, date: string, start: number): CsvRow {
    return job.bookingRow(task, {
      technician_id: technicianId,
      date,
      start_time: clock(start),
      end_time: clock(start + requestOf(job, task).duration_minutes),
    });
  }

  it('passes the earliest slot with every technician free at that time', () => {
    for (const task of scheduleTasks) {
      const slot = expectedSlot(task);
      for (const technician_id of slot.technician_ids) {
        const result = job.check(
          task,
          job.withAppended('bookings.csv', job.bookingRow(task, { ...slot, technician_id })),
        );
        expect(result, `${task.id} ${technician_id}`).toMatchObject({
          pass: true,
          details: { technician_ids: slot.technician_ids },
        });
      }
    }
  });

  it('turns away every other technician at that time as unable to do it', () => {
    for (const task of scheduleTasks) {
      const slot = expectedSlot(task);
      for (const technician of job.table('technicians.csv')) {
        const id = String(technician.technician_id);
        if (slot.technician_ids.includes(id)) continue;
        const result = job.check(
          task,
          job.withAppended('bookings.csv', job.bookingRow(task, { ...slot, technician_id: id })),
        );
        expect(result.pass, `${task.id} ${id}`).toBe(false);
        expect(result.reason, `${task.id} ${id}`).toMatch(/^This booking does not work: /);
      }
    }
  });

  const task = scheduleTasks[0] as Task;
  const slot = expectedSlot(task);
  const right = job.bookingRow(task, { ...slot, technician_id: slot.technician_ids[0] as string });

  it('fails a booking for a different request, and two new rows', () => {
    const otherRequest = String(paramsOf(scheduleTasks[1] as Task).request_id);
    expect(
      job.check(task, job.withAppended('bookings.csv', { ...right, request_id: otherRequest }))
        .reason,
    ).toBe(`The new booking is for request "${otherRequest}" instead of ${right.request_id}.`);
    expect(
      job.check(task, job.withAppended('bookings.csv', right, { ...right, booking_id: 'B-9999' }))
        .reason,
    ).toBe('Expected one new booking row, found 2.');
  });

  it('fails a wrong booking id, zone or end time', () => {
    expect(
      job.check(task, job.withAppended('bookings.csv', { ...right, booking_id: 'B-9999' })).reason,
    ).toBe(`booking_id is "B-9999" but should be ${right.booking_id}.`);
    const otherZone = right.zone === 'Ridge' ? 'Harbor' : 'Ridge';
    expect(
      job.check(task, job.withAppended('bookings.csv', { ...right, zone: otherZone })).reason,
    ).toBe(`zone is "${otherZone}" but should be ${right.zone}, the request's zone.`);
    const late = clock(minutes(slot.end_time) + 30);
    const duration = requestOf(job, task).duration_minutes;
    expect(
      job.check(task, job.withAppended('bookings.csv', { ...right, end_time: late })).reason,
    ).toBe(
      `end_time is "${late}" but should be ${slot.end_time}, ${duration} minutes after the start.`,
    );
  });

  it('fails a slot that overlaps a booking, or leaves no time to drive', () => {
    let overlapChecked = false;
    let travelChecked = false;
    for (const candidate of scheduleTasks) {
      const duration = requestOf(job, candidate).duration_minutes;
      const first = expectedSlot(candidate).date;
      for (const technician of qualified(job, candidate)) {
        const id = String(technician.technician_id);
        const day = job
          .rowsWhere('bookings.csv', 'technician_id', id)
          .filter((b) => b.date === first);
        const opening = day[0];
        if (!opening) continue;
        const start = minutes(String(opening.start_time));
        const after = minutes(String(opening.end_time));
        if (!overlapChecked && start + duration <= minutes(String(technician.end_time))) {
          const result = job.check(
            candidate,
            job.withAppended('bookings.csv', slotRow(candidate, id, first, start)),
          );
          expect(result.reason).toBe(
            `This booking does not work: it overlaps ${opening.booking_id} (${opening.start_time} to ${opening.end_time}).`,
          );
          overlapChecked = true;
        }
        const next = day[1];
        const roomAfter = next ? minutes(String(next.start_time)) - after : Infinity;
        if (
          !travelChecked &&
          roomAfter >= duration &&
          after + duration <= minutes(String(technician.end_time))
        ) {
          const result = job.check(
            candidate,
            job.withAppended('bookings.csv', slotRow(candidate, id, first, after)),
          );
          expect(result.reason).toMatch(
            new RegExp(
              `^This booking does not work: ${id} needs \\d+ minutes to drive from ${opening.zone} after ${opening.booking_id} ends at ${opening.end_time}\\.$`,
            ),
          );
          travelChecked = true;
        }
      }
    }
    expect(overlapChecked && travelChecked).toBe(true);
  });

  it('fails a technician without the license, on a day off, or outside their hours', () => {
    const licensed = scheduleTasks.find((t) => requestOf(job, t).license_needed !== null) as Task;
    const request = requestOf(job, licensed);
    const unlicensed = job
      .table('technicians.csv')
      .find(
        (t) =>
          String(t.skills).split(';').includes(request.skill) &&
          !String(t.licenses).split(';').includes(String(request.license_needed)),
      );
    const at = expectedSlot(licensed);
    const id = String(unlicensed?.technician_id);
    expect(
      job.check(
        licensed,
        job.withAppended('bookings.csv', job.bookingRow(licensed, { ...at, technician_id: id })),
      ).reason,
    ).toBe(
      `This booking does not work: ${id} does not hold the ${request.license_needed} license.`,
    );

    const offDay = scheduleTasks
      .flatMap((t) => qualified(job, t).map((technician) => ({ t, technician })))
      .find(
        ({ t, technician }) =>
          !String(technician.work_days)
            .split(';')
            .includes(String(weekday(expectedSlot(t).date))),
      );
    if (!offDay) throw new Error('No qualified technician has a day off on an earliest date');
    const offSlot = expectedSlot(offDay.t);
    const offId = String(offDay.technician.technician_id);
    expect(
      job.check(
        offDay.t,
        job.withAppended(
          'bookings.csv',
          job.bookingRow(offDay.t, { ...offSlot, technician_id: offId }),
        ),
      ).reason,
    ).toBe(`This booking does not work: ${offId} does not work on ${weekday(offSlot.date)}.`);

    const technicianId = slot.technician_ids[0] as string;
    const technician = job.rowWhere('technicians.csv', 'technician_id', technicianId);
    const early = minutes(String(technician.start_time)) - 30;
    expect(
      job.check(
        task,
        job.withAppended('bookings.csv', slotRow(task, technicianId, slot.date, early)),
      ).reason,
    ).toBe(
      `This booking does not work: it falls outside ${technicianId}'s hours, ${technician.start_time} to ${technician.end_time}.`,
    );
  });

  it('fails a start off the half-hour grid, today, or the closed day', () => {
    const technicianId = slot.technician_ids[0] as string;
    const offGrid = minutes(slot.start_time) + 15;
    expect(
      job.check(
        task,
        job.withAppended('bookings.csv', slotRow(task, technicianId, slot.date, offGrid)),
      ).reason,
    ).toBe(
      'This booking does not work: bookings start on a 30-minute grid (on the hour or half hour).',
    );

    const fromTomorrow = scheduleTasks.find(
      (t) => requestOf(job, t).earliest_date <= BUSINESS_DATE,
    ) as Task;
    const tomorrowSlot = expectedSlot(fromTomorrow);
    const today = {
      ...tomorrowSlot,
      date: BUSINESS_DATE,
      technician_id: tomorrowSlot.technician_ids[0] as string,
    };
    expect(
      job.check(fromTomorrow, job.withAppended('bookings.csv', job.bookingRow(fromTomorrow, today)))
        .reason,
    ).toBe('This booking does not work: the first day it can be booked is 2026-11-06.');

    const beforeClosure = scheduleTasks.find(
      (t) => requestOf(job, t).earliest_date <= '2026-11-11',
    ) as Task;
    const wednesday = qualified(job, beforeClosure).find((t) =>
      String(t.work_days).includes('Wed'),
    );
    const closedSlot = {
      ...expectedSlot(beforeClosure),
      date: '2026-11-11',
      technician_id: String(wednesday?.technician_id),
    };
    expect(
      job.check(
        beforeClosure,
        job.withAppended('bookings.csv', job.bookingRow(beforeClosure, closedSlot)),
      ).reason,
    ).toBe('This booking does not work: the office is closed on 2026-11-11.');
  });

  it('fails a feasible slot that is not the earliest', () => {
    const schedule = referenceSchedule(job);
    const rules = {
      businessDate: BUSINESS_DATE,
      closedDates: ['2026-11-11'],
      slotMinutes: 30,
      noon: 12 * 60,
    };
    for (const candidate of scheduleTasks.slice(0, 10)) {
      const earliest = expectedSlot(candidate);
      const later = earliestSlot(schedule, rules, {
        ...requestOf(job, candidate),
        earliest_date: nextDay(earliest.date),
      });
      const row = job.bookingRow(candidate, {
        ...later,
        technician_id: later.technician_ids[0] as string,
      });
      const result = job.check(candidate, job.withAppended('bookings.csv', row));
      expect(result.reason, candidate.id).toBe(
        `Not the earliest slot: ${earliest.technician_ids.join(' or ')} could start on ${earliest.date} at ${earliest.start_time}.`,
      );
    }
  });

  it('fails a changed existing booking and a missing booking', () => {
    const [first, ...rest] = job.table('bookings.csv') as [CsvRow, ...CsvRow[]];
    const edited = [{ ...first, end_time: '23:00' }, ...rest, right];
    expect(job.check(task, job.contextWith({ 'bookings.csv': edited })).reason).toBe(
      `An existing booking row was changed or deleted (${first.booking_id}).`,
    );
    expect(job.check(task, job.contextWith({})).reason).toBe('No new booking row was added.');
  });
});

describe('booking_created with time windows in version 2', () => {
  const job = latestVersion;
  const windowed = job.tasksOfType('schedule').filter((t) => requestOf(job, t).window !== 'any');
  const rules = {
    businessDate: BUSINESS_DATE,
    closedDates: ['2026-11-11'],
    slotMinutes: 30,
    noon: 12 * 60,
  };
  const windowReason = (window: string) =>
    window === 'morning'
      ? 'This booking does not work: the customer asked for a morning visit, which must end by 12:00.'
      : 'This booking does not work: the customer asked for an afternoon visit, which must start at 12:00 or later.';

  it('books a third of the requests in a morning or an afternoon window', () => {
    expect(windowed).toHaveLength(20);
    const windows = windowed.map((t) => requestOf(job, t).window);
    expect(new Set(windows)).toEqual(new Set(['morning', 'afternoon']));
    for (const request of job.table('requests.csv')) {
      expect(['morning', 'afternoon', 'any']).toContain(request.window);
    }
  });

  it('fails the earlier slot a booker who ignores the window would choose', () => {
    const schedule = referenceSchedule(job);
    const moved = windowed.filter((t) => hasTrap(t, 'window'));
    expect(moved.length).toBeGreaterThanOrEqual(10);
    for (const task of moved) {
      const request = requestOf(job, task);
      const careless = earliestSlot(schedule, rules, request, 'window');
      const row = job.bookingRow(task, {
        ...careless,
        technician_id: careless.technician_ids[0] as string,
      });
      expect(job.check(task, job.withAppended('bookings.csv', row)).reason, task.id).toBe(
        windowReason(request.window),
      );
    }
  });

  it('fails a morning visit that runs past noon and an afternoon visit that starts before it', () => {
    let checked = 0;
    for (const task of windowed) {
      const { window, duration_minutes } = requestOf(job, task);
      const slot = expectedSlot(task);
      const technicianId = slot.technician_ids[0] as string;
      const technician = job.rowWhere('technicians.csv', 'technician_id', technicianId);
      // Half an hour across noon, inside the technician's hours.
      const start = window === 'morning' ? 12 * 60 + 30 - duration_minutes : 11 * 60 + 30;
      if (start < minutes(String(technician.start_time))) continue;
      if (start + duration_minutes > minutes(String(technician.end_time))) continue;
      const row = job.bookingRow(task, {
        technician_id: technicianId,
        date: slot.date,
        start_time: clock(start),
        end_time: clock(start + duration_minutes),
      });
      expect(job.check(task, job.withAppended('bookings.csv', row)).reason, task.id).toBe(
        windowReason(window),
      );
      checked += 1;
    }
    expect(checked).toBeGreaterThanOrEqual(15);
  });
});
