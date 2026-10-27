// End-state checks for the Ferncliff Home Services sample job.
//
// The runner loads this file in a sandbox and calls the validator a task names, passing the
// task's params and a context:
//   ctx.readTable(name)          the table after the attempt: one object per row, each value a
//                                string, empty cells null
//   ctx.readOriginalTable(name)  the same table before the attempt
// A validator returns { pass, reason, details }; the reason is one sentence for a person.
// Nothing here reads a clock or draws a random number, so the same attempt always gets the same
// verdict.

var validators = {};

// invoice_created: invoices.csv gained exactly one row, for params.job_id. Its invoice_id is one
// past the highest id that was already there, and its dates and amounts match params.
validators.invoice_created = (params, ctx) => {
  const before = ctx.readOriginalTable('invoices.csv');
  const change = compareRows(before, ctx.readTable('invoices.csv'));
  const problem = oneNewRow(change, 'invoice', 'invoice_id');
  if (problem) return fail(problem);

  const row = change.added[0];
  if (text(row.job_id) !== params.job_id) {
    return fail(`The new invoice is for job ${show(row.job_id)} instead of ${params.job_id}.`);
  }

  const expected = {
    invoice_id: nextInvoiceId(before),
    job_id: params.job_id,
    customer_id: params.customer_id,
    issue_date: params.issue_date,
    due_date: params.due_date,
    labor_cents: params.labor_cents,
    parts_cents: params.parts_cents,
    fees_cents: params.fees_cents,
    discount_cents: params.discount_cents,
    tax_cents: params.tax_cents,
    total_cents: params.total_cents,
  };
  const wrong = Object.keys(expected).filter((column) => !sameValue(row[column], expected[column]));
  if (wrong.length > 0) {
    const [first, ...others] = wrong;
    const also = others.length > 0 ? `; also wrong: ${others.join(', ')}` : '';
    return fail(`${first} is ${show(row[first])} but should be ${expected[first]}${also}.`, {
      wrong,
      expected,
    });
  }
  return pass(
    `Invoice ${expected.invoice_id} for job ${params.job_id} is correct, ` +
      `${dollars(params.total_cents)} in total.`,
    { invoice_id: expected.invoice_id },
  );
};

// booking_created: bookings.csv gained exactly one row, for params.request_id. A qualified
// technician can work it (skill, license, working day and hours, the start-time grid, and the
// drive to and from their other bookings that day), and no qualified technician could start
// earlier. When several technicians can start at that earliest time, any of them passes.
validators.booking_created = (params, ctx) => {
  const change = compareRows(ctx.readOriginalTable('bookings.csv'), ctx.readTable('bookings.csv'));
  const problem = oneNewRow(change, 'booking', 'booking_id');
  if (problem) return fail(problem);

  const row = change.added[0];
  if (text(row.request_id) !== params.request_id) {
    return fail(
      `The new booking is for request ${show(row.request_id)} instead of ${params.request_id}.`,
    );
  }
  const request = findRow(ctx.readOriginalTable('requests.csv'), 'request_id', params.request_id);
  if (!request) return fail(`Request ${params.request_id} is not in requests.csv.`);
  const world = loadWorld(ctx, params, request);

  if (text(row.booking_id) !== params.booking_id) {
    return fail(`booking_id is ${show(row.booking_id)} but should be ${params.booking_id}.`);
  }
  if (text(row.zone) !== world.zone) {
    return fail(`zone is ${show(row.zone)} but should be ${world.zone}, the request's zone.`);
  }
  const date = text(row.date);
  if (!isDate(date)) return fail(`date is ${show(row.date)} but should be a YYYY-MM-DD date.`);
  const start = minutesOf(row.start_time);
  if (start === null) {
    return fail(`start_time is ${show(row.start_time)} but should be an HH:MM time.`);
  }
  const end = start + world.duration;
  if (minutesOf(row.end_time) !== end) {
    return fail(
      `end_time is ${show(row.end_time)} but should be ${clock(end)}, ` +
        `${world.duration} minutes after the start.`,
    );
  }

  const technicianId = text(row.technician_id);
  const reason = slotProblem(world, technicianId, date, start);
  if (reason) return fail(`This booking does not work: ${reason}.`);

  // The booked slot works, so the search below finds a slot on or before it.
  const earliest = earliestSlot(world, date);
  if (earliest.date !== date || earliest.start !== start) {
    const who = earliest.technicians.join(' or ');
    return fail(
      `Not the earliest slot: ${who} could start on ${earliest.date} at ${clock(earliest.start)}.`,
      {
        earliest: {
          date: earliest.date,
          start_time: clock(earliest.start),
          technician_ids: earliest.technicians,
        },
      },
    );
  }
  return pass(
    `Booked ${technicianId} on ${date} at ${clock(start)}, ` +
      'the earliest slot a qualified technician has.',
    { technician_ids: earliest.technicians },
  );
};

// Everything the scheduling rules look at, read from the tables as they were before the attempt.
function loadWorld(ctx, params, request) {
  const technicians = ctx.readOriginalTable('technicians.csv').map((row) => ({
    id: row.technician_id,
    skills: listOf(row.skills),
    licenses: listOf(row.licenses),
    workDays: listOf(row.work_days),
    start: minutesOf(row.start_time),
    end: minutesOf(row.end_time),
  }));
  const travel = {};
  for (const row of ctx.readOriginalTable('travel.csv')) {
    travel[`${row.from_zone} > ${row.to_zone}`] = Number(row.minutes);
  }
  const bookings = {};
  for (const row of ctx.readOriginalTable('bookings.csv')) {
    const key = `${row.technician_id} ${row.date}`;
    bookings[key] = (bookings[key] || []).concat({
      id: row.booking_id,
      zone: row.zone,
      start: minutesOf(row.start_time),
      end: minutesOf(row.end_time),
    });
  }
  // Nothing is booked on the business date, nor before the request's earliest_date.
  const tomorrow = nextDay(params.business_date);
  return {
    technicians,
    travel,
    bookings,
    closedDates: params.closed_dates,
    slotMinutes: params.slot_minutes,
    skill: request.skill,
    license: request.license_needed,
    zone: request.zone,
    duration: Number(request.duration_minutes),
    firstDate: request.earliest_date > tomorrow ? request.earliest_date : tomorrow,
  };
}

// Why the technician can't take the request at this date and start, or null when they can.
function slotProblem(world, technicianId, date, start) {
  const technician = findRow(world.technicians, 'id', technicianId);
  if (!technician) return `there is no technician ${show(technicianId)}`;
  if (date < world.firstDate) return `the first day it can be booked is ${world.firstDate}`;
  if (world.closedDates.includes(date)) return `the office is closed on ${date}`;
  if (!technician.skills.includes(world.skill)) {
    return `${technicianId} does not do ${world.skill} work`;
  }
  if (world.license && !technician.licenses.includes(world.license)) {
    return `${technicianId} does not hold the ${world.license} license`;
  }
  const weekday = weekdayOf(date);
  if (!technician.workDays.includes(weekday)) return `${technicianId} does not work on ${weekday}`;
  if (start % world.slotMinutes !== 0) {
    return `bookings start on a ${world.slotMinutes}-minute grid (on the hour or half hour)`;
  }
  const end = start + world.duration;
  if (start < technician.start || end > technician.end) {
    const hours = `${clock(technician.start)} to ${clock(technician.end)}`;
    return `it falls outside ${technicianId}'s hours, ${hours}`;
  }
  for (const other of world.bookings[`${technicianId} ${date}`] || []) {
    if (start < other.end && other.start < end) {
      return `it overlaps ${other.id} (${clock(other.start)} to ${clock(other.end)})`;
    }
    const driveHere = travelMinutes(world, other.zone, world.zone);
    if (other.end <= start && other.end + driveHere > start) {
      return (
        `${technicianId} needs ${driveHere} minutes to drive from ${other.zone} ` +
        `after ${other.id} ends at ${clock(other.end)}`
      );
    }
    const driveOn = travelMinutes(world, world.zone, other.zone);
    if (end <= other.start && end + driveOn > other.start) {
      return (
        `${technicianId} needs ${driveOn} minutes to drive on to ${other.id} in ${other.zone}, ` +
        `which starts at ${clock(other.start)}`
      );
    }
  }
  return null;
}

// The earliest date and start that any qualified technician can take, and who can take it,
// scanning day by day from the first bookable date up to lastDate.
function earliestSlot(world, lastDate) {
  for (let date = world.firstDate; date <= lastDate; date = nextDay(date)) {
    let best = null;
    let who = [];
    for (const technician of world.technicians) {
      const start = firstOpenStart(world, technician, date);
      if (start === null) continue;
      if (best === null || start < best) {
        best = start;
        who = [technician.id];
      } else if (start === best) {
        who.push(technician.id);
      }
    }
    if (best !== null) return { date, start: best, technicians: who.sort() };
  }
  return null;
}

function firstOpenStart(world, technician, date) {
  const first = Math.ceil(technician.start / world.slotMinutes) * world.slotMinutes;
  for (let start = first; start + world.duration <= technician.end; start += world.slotMinutes) {
    if (slotProblem(world, technician.id, date, start) === null) return start;
  }
  return null;
}

function travelMinutes(world, from, to) {
  const minutes = world.travel[`${from} > ${to}`];
  if (minutes === undefined) throw new Error(`travel.csv has no row from ${from} to ${to}`);
  return minutes;
}

// Rows added to and removed from a table. A changed row counts as one of each. Rows are matched
// on every column, so identical rows are interchangeable.
function compareRows(before, after) {
  const columns = Object.keys(before[0] || after[0] || {});
  const key = (row) => JSON.stringify(columns.map((column) => row[column] ?? null));
  const unmatched = new Map();
  for (const row of before) unmatched.set(key(row), (unmatched.get(key(row)) || 0) + 1);
  const takeMatch = (row) => {
    const left = unmatched.get(key(row)) || 0;
    if (left > 0) unmatched.set(key(row), left - 1);
    return left > 0;
  };
  const added = after.filter((row) => !takeMatch(row));
  const removed = before.filter((row) => takeMatch(row));
  return { added, removed };
}

function oneNewRow(change, noun, idColumn) {
  if (change.removed.length > 0) {
    return `An existing ${noun} row was changed or deleted (${change.removed[0][idColumn]}).`;
  }
  if (change.added.length === 0) return `No new ${noun} row was added.`;
  if (change.added.length > 1) {
    return `Expected one new ${noun} row, found ${change.added.length}.`;
  }
  return null;
}

// One past the highest INV- number in the table, as INV- plus five digits.
function nextInvoiceId(rows) {
  let highest = 0;
  for (const row of rows) {
    const match = /^INV-(\d+)$/.exec(text(row.invoice_id));
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `INV-${String(highest + 1).padStart(5, '0')}`;
}

// Money columns must hold whole cents; everything else is compared as text.
function sameValue(cell, expected) {
  const value = text(cell);
  if (typeof expected === 'number') return /^-?\d+$/.test(value) && Number(value) === expected;
  return value === expected;
}

function findRow(rows, column, value) {
  return rows.find((row) => row[column] === value) || null;
}

function listOf(cell) {
  return text(cell) === '' ? [] : text(cell).split(';');
}

function text(cell) {
  return cell === null || cell === undefined ? '' : String(cell).trim();
}

function show(cell) {
  return text(cell) === '' ? 'empty' : `"${text(cell)}"`;
}

function dollars(cents) {
  const whole = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `$${whole}.${pad2(cents % 100)}`;
}

// Dates are YYYY-MM-DD strings, so comparing them as strings compares them as dates.
function isDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  const day = Number(match[3]);
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(Number(match[1]), month);
}

function nextDay(date) {
  let year = Number(date.slice(0, 4));
  let month = Number(date.slice(5, 7));
  let day = Number(date.slice(8, 10)) + 1;
  if (day > daysInMonth(year, month)) {
    day = 1;
    month += 1;
  }
  if (month > 12) {
    month = 1;
    year += 1;
  }
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

// The day of the week (Sakamoto's method), named the way work_days names it.
function weekdayOf(date) {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const year = Number(date.slice(0, 4)) - (month < 3 ? 1 : 0);
  const leapDays = Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400);
  const index = (year + leapDays + offsets[month - 1] + day) % 7;
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][index];
}

function minutesOf(cell) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text(cell));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function clock(minutes) {
  return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
}

function pad2(number) {
  return String(number).padStart(2, '0');
}

function pass(reason, details) {
  return { pass: true, reason, details: details || {} };
}

function fail(reason, details) {
  return { pass: false, reason, details: details || {} };
}
