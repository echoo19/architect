// End-state and answer checks for the Larchwood Outfitters sample job.
//
// The runner loads this file in a sandbox and calls the validator a task names, passing the
// task's params and a context:
//   ctx.readTable(name)          the table after the attempt: one object per row, each value a
//                                string, empty cells null
//   ctx.readOriginalTable(name)  the same table before the attempt
//   ctx.answer                   the JSON after the reply's last ANSWER: line, or null
// A validator returns { pass, reason, details }. The reason is one sentence for a person, and it
// starts with the field or table that is wrong, so a locked-test result can name it and nothing
// else. Nothing here reads a clock or draws a random number, so the same attempt always gets the
// same verdict.
//
// Money in an ANSWER line passes when it is within half a cent of the expected cents: a value
// like 1998.9999999999998 left by floating-point arithmetic reads as 1999, and a cent off fails.
// Money written into a table must be whole cents. Lists of ids compare as sets.

var validators = {};

const RETURN_FIELDS = [
  'order_id',
  'sku',
  'qty',
  'condition',
  'decided_on',
  'decision',
  'item_cents',
  'restocking_fee_cents',
  'return_shipping_cents',
  'shipping_refund_cents',
  'refund_cents',
  'refund_to',
  'pickup_from',
];

// The tables an attempt may write to. A task changes at most one of them, so a change to any
// other is a mistake even when the asked-for change is right.
const WRITABLE_TABLES = ['returns.csv', 'pickups.csv'];

// return_recorded: returns.csv gained exactly one row, for params.return_id, with the decision
// and every amount in params, and no pickup_from (the item is at the desk); and the ANSWER line
// gives the same decision, refund and refund_to.
validators.return_recorded = (params, ctx) => {
  const other = otherTableChanged(ctx, 'returns.csv');
  if (other) return fail(`${other} changed, but this task only records the return in returns.csv.`);
  const change = compareRows(ctx.readOriginalTable('returns.csv'), ctx.readTable('returns.csv'));
  const problem = oneNewRow(change, 'return', 'return_id');
  if (problem) return fail(problem);

  const row = change.added[0];
  if (text(row.return_id) !== params.return_id) {
    return fail(`return_id is ${show(row.return_id)} but should be ${params.return_id}.`);
  }
  const wrong = RETURN_FIELDS.filter((field) => !sameCell(row[field], params[field]));
  if (wrong.length > 0) return wrongFields(row, params, wrong);

  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  for (const field of ['decision', 'refund_cents', 'refund_to']) {
    if (!hasOwn(answer, field)) return fail(`${field} is missing from the ANSWER line.`);
  }
  if (!sameWord(answer.decision, params.decision)) {
    return fail(
      `decision in the ANSWER line is ${show(answer.decision)} but should be ${params.decision}.`,
    );
  }
  if (!sameMoney(answer.refund_cents, params.refund_cents)) {
    return fail(
      `refund_cents in the ANSWER line is ${show(answer.refund_cents)} but should be ${params.refund_cents}.`,
    );
  }
  if (!sameWord(answer.refund_to, params.refund_to)) {
    return fail(
      `refund_to in the ANSWER line is ${show(answer.refund_to)} but should be ${params.refund_to}.`,
    );
  }
  return pass(
    `Return ${params.return_id} is ${params.decision} and recorded correctly, ` +
      `with ${dollars(params.refund_cents)} refunded.`,
    { return_id: params.return_id },
  );
};

// pickup_booked: pickups.csv gained exactly one row, for params.return_id, with the carrier for
// the customer's region (or the freight carrier for a bulky product) on the earliest date that
// passes every pickup rule. A wrong date comes back with the rule it breaks.
validators.pickup_booked = (params, ctx) => {
  const other = otherTableChanged(ctx, 'pickups.csv');
  if (other) return fail(`${other} changed, but this task only books a pickup in pickups.csv.`);
  const change = compareRows(ctx.readOriginalTable('pickups.csv'), ctx.readTable('pickups.csv'));
  const problem = oneNewRow(change, 'pickup', 'pickup_id');
  if (problem) return fail(problem);

  const row = change.added[0];
  if (text(row.return_id) !== params.return_id) {
    return fail(
      `The new pickup is for return ${show(row.return_id)} instead of ${params.return_id}.`,
    );
  }
  if (text(row.pickup_id) !== params.pickup_id) {
    return fail(`pickup_id is ${show(row.pickup_id)} but should be ${params.pickup_id}.`);
  }
  if (text(row.carrier) !== params.carrier) {
    const why = params.bulky
      ? 'which takes bulky products'
      : `which serves the ${params.region} region`;
    return fail(`carrier is ${show(row.carrier)} but should be ${params.carrier}, ${why}.`);
  }
  const date = text(row.pickup_date);
  if (!isDate(date)) {
    return fail(`pickup_date is ${show(row.pickup_date)} but should be a YYYY-MM-DD date.`);
  }
  if (date !== params.pickup_date) {
    return fail(
      `pickup_date is ${date} but should be ${params.pickup_date}: ${dateProblem(params, date)}.`,
    );
  }
  if (text(row.booked_on) !== params.booked_on) {
    return fail(`booked_on is ${show(row.booked_on)} but should be ${params.booked_on}.`);
  }
  return pass(`Booked ${params.carrier} on ${params.pickup_date}, the earliest day that works.`, {
    pickup_id: params.pickup_id,
  });
};

// Why a pickup can't be on `date`, or why an earlier date was open, from the facts in params.
function dateProblem(params, date) {
  if (date < params.first_date) {
    return date <= params.booked_on
      ? 'a pickup is never booked for today or earlier'
      : `booked at ${params.booked_at}, the first possible pickup is ${params.first_date}`;
  }
  if (params.pickup_from !== null && date < params.pickup_from) {
    return `the customer can hand the parcel over from ${params.pickup_from}`;
  }
  const weekday = weekdayOf(date);
  if (!params.carrier_days.includes(weekday)) {
    return `${params.carrier} doesn't pick up on a ${WEEKDAY_NAMES[weekday]}`;
  }
  if (params.closed_dates.includes(date)) return `no carrier picks up on ${date}`;
  if (params.full_dates.includes(date)) {
    return `${params.carrier} is already full on ${date}`;
  }
  return `${params.carrier} can pick up earlier, on ${params.pickup_date}`;
}

// order_answer: no table changed, and the ANSWER line holds exactly the keys of params.answer,
// each with its value. Keys ending in _cents are money; lists of ids compare as sets, ignoring
// case and order.
validators.order_answer = (params, ctx) => {
  const other = otherTableChanged(ctx, null);
  if (other) return fail(`${other} changed, but this task only asks a question.`);
  const expected = params.answer;
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  for (const key of Object.keys(expected)) {
    if (!hasOwn(answer, key)) return fail(`${key} is missing from the ANSWER line.`);
    const problem = valueProblem(key, answer[key], expected[key]);
    if (problem) return fail(problem);
  }
  const extra = Object.keys(answer).find((key) => !hasOwn(expected, key));
  if (extra !== undefined) {
    return fail(`The ANSWER line has ${extra}, which the question doesn't ask for.`);
  }
  return pass('Every value in the ANSWER line matches the records.');
};

function valueProblem(key, value, wanted) {
  if (Array.isArray(wanted)) {
    if (!Array.isArray(value)) return `${key} should be a list but is ${show(value)}.`;
    const have = value.map(idOf);
    const want = wanted.map(idOf);
    const missing = wanted.find((id) => !have.includes(idOf(id)));
    if (missing !== undefined) return `${key} is missing ${missing}.`;
    const extra = value.find((id) => !want.includes(idOf(id)));
    if (extra !== undefined) return `${key} includes ${show(extra)}, which it should not.`;
    return null;
  }
  const same = /_cents$/.test(key) ? sameMoney(value, wanted) : numberOf(value) === wanted;
  return same ? null : `${key} is ${show(value)} but should be ${wanted}.`;
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

// The first writable table other than `allowed` whose rows the attempt changed, or null.
function otherTableChanged(ctx, allowed) {
  for (const table of WRITABLE_TABLES) {
    if (table === allowed) continue;
    const change = compareRows(ctx.readOriginalTable(table), ctx.readTable(table));
    if (change.added.length > 0 || change.removed.length > 0) return table;
  }
  return null;
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

function wrongFields(row, params, wrong) {
  const [first, ...others] = wrong;
  const also = others.length > 0 ? `; also wrong: ${others.join(', ')}` : '';
  const should = params[first] === null ? 'empty' : params[first];
  return fail(`${first} is ${show(row[first])} but should be ${should}${also}.`, { wrong });
}

// A table cell: whole cents for a number, empty for null, the same text (spaces at the ends
// aside) otherwise.
function sameCell(cell, expected) {
  const value = text(cell);
  if (expected === null) return value === '';
  if (typeof expected === 'number') return /^-?\d+$/.test(value) && Number(value) === expected;
  return value === expected;
}

// An ANSWER value: the same word whatever its capitals.
function sameWord(value, expected) {
  return typeof value === 'string' && value.trim().toLowerCase() === expected;
}

function sameMoney(value, cents) {
  const number = numberOf(value);
  return number !== null && Math.abs(number - cents) < 0.5;
}

// A number, or text that is plainly one, as a number; anything else is null.
function numberOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^\s*-?\d+(\.\d+)?\s*$/.test(value)) return null;
  return Number(value);
}

function idOf(value) {
  return String(value).trim().toUpperCase();
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function text(cell) {
  return cell === null || cell === undefined ? '' : String(cell).trim();
}

function show(value) {
  if (value === null || value === undefined || value === '') return 'empty';
  return typeof value === 'string' ? `"${value.trim()}"` : JSON.stringify(value);
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

function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const WEEKDAY_NAMES = {
  Sun: 'Sunday',
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
};

// The day of the week of a YYYY-MM-DD date (Sakamoto's method), as pickup days name it.
function weekdayOf(date) {
  const offsets = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const year = Number(date.slice(0, 4)) - (month < 3 ? 1 : 0);
  const leapDays = Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400);
  return Object.keys(WEEKDAY_NAMES)[(year + leapDays + offsets[month - 1] + day) % 7];
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
