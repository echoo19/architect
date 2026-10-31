// Answer and end-state checks for the inventory desk job.
//
// The runner loads this file in a sandbox and calls the validator a task names, passing the
// task's params and a context:
//   ctx.readTable(name)          a table of the task's lab after the attempt: one object per row,
//                                each value a string, empty cells null
//   ctx.readOriginalTable(name)  the same table before the attempt
//   ctx.answer                   the JSON after the reply's last ANSWER: line, or null
// A validator returns { pass, reason, details }. The reason is one sentence for a person, and it
// starts with the field or table that is wrong. Nothing here reads a clock or draws a random
// number, so the same attempt always gets the same verdict.
//
// Volumes pass within the task's tolerance, in microlitres; lists of lots and compounds compare
// as sets, rows in any order. Ids and locations pass however their case, spaces and punctuation
// are written. A new row is written as the lab's policy says: its amount a number and the lab's
// unit (µL may be typed uL), its date in the lab's form.

var validators = {};

// usable_volume: the ANSWER gives how much of the compound is usable and in which lots, and
// reservations.csv is unchanged.
validators.usable_volume = (params, ctx) => {
  const changed = holdsChanged(ctx);
  if (changed) return fail(changed);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  if (!sameId(answer.compound, params.compound)) {
    return fail(`compound is ${show(answer.compound)} but should be ${params.compound}.`);
  }
  if (!near(answer.usable_ul, params.usable_ul, params.tolerance)) {
    return fail(
      `usable_ul is ${show(answer.usable_ul)} but should be ${params.usable_ul} (within ${params.tolerance}).`,
    );
  }
  const problem = setProblem('lots', answer.lots, params.lots);
  if (problem) return fail(problem);
  return pass(`${params.usable_ul} µL of ${params.compound} is usable.`);
};

// lot_pick: the ANSWER gives the lots one re-test of the compound draws from, or the reason it
// has nothing to draw, and reservations.csv is unchanged.
validators.lot_pick = (params, ctx) => {
  const changed = holdsChanged(ctx);
  if (changed) return fail(changed);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  if (!sameId(answer.compound, params.compound)) {
    return fail(`compound is ${show(answer.compound)} but should be ${params.compound}.`);
  }
  const problem = allocationProblem(answer, params, params.tolerance);
  if (problem) return fail(problem);
  return pass(allocationDone(params));
};

// allocation: the ANSWER gives, for each compound of the list, the lots its re-test draws from
// or the reason it has nothing to draw, and reservations.csv is unchanged.
validators.allocation = (params, ctx) => {
  const changed = holdsChanged(ctx);
  if (changed) return fail(changed);
  const answer = ctx.answer;
  if (!isObject(answer) || !Array.isArray(answer.allocations)) {
    return fail('allocations is missing from the ANSWER line, or is not a list.');
  }
  for (const expected of params.allocations) {
    const given = answer.allocations.filter(
      (a) => isObject(a) && sameId(a.compound, expected.compound),
    );
    if (given.length === 0) return fail(`allocations has no entry for ${expected.compound}.`);
    if (given.length > 1) return fail(`allocations lists ${expected.compound} twice.`);
    const problem = allocationProblem(given[0], expected, params.tolerance);
    if (problem) return fail(problem);
  }
  const extra = answer.allocations.find(
    (a) => !params.allocations.some((e) => isObject(a) && sameId(a.compound, e.compound)),
  );
  if (extra !== undefined) {
    return fail(
      `allocations includes ${show(isObject(extra) ? extra.compound : extra)}, not on the list.`,
    );
  }
  return pass(`${params.allocations.map(allocationDone).join(' ')}`);
};

// reservation: reservations.csv gained one row for each lot the list's re-tests draw from, and
// none for a compound with nothing to draw; the ANSWER says which compounds were reserved and why
// the others weren't.
validators.reservation = (params, ctx) => {
  const problem = rowsProblem(params, ctx);
  if (problem) return fail(problem);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  const reserved = params.allocations.filter((a) => a.reason === null).map((a) => a.compound);
  const reservedProblem = setProblem('reserved', answer.reserved, reserved);
  if (reservedProblem) return fail(reservedProblem);
  const unavailable = params.allocations.filter((a) => a.reason !== null);
  if (!Array.isArray(answer.unavailable)) {
    return fail('unavailable is missing from the ANSWER line, or is not a list.');
  }
  for (const expected of unavailable) {
    const given = answer.unavailable.find(
      (u) => isObject(u) && sameId(u.compound, expected.compound),
    );
    if (!given) return fail(`unavailable has no entry for ${expected.compound}.`);
    if (!sameText(given.reason, expected.reason)) {
      return fail(
        `reason for ${expected.compound} is ${show(given.reason)} but should be ${expected.reason}.`,
      );
    }
  }
  if (answer.unavailable.length !== unavailable.length) {
    return fail(
      `unavailable lists ${answer.unavailable.length} compounds but should list ${unavailable.length}.`,
    );
  }
  const rows = params.ids.length;
  return pass(
    rows === 0
      ? 'Nothing to reserve.'
      : `Reserved ${rows} ${rows === 1 ? 'lot' : 'lots'} for ${reserved.length} compounds.`,
  );
};

// Why an answer's draws or reason for one compound are not the expected ones, or null.
function allocationProblem(given, expected, tolerance) {
  const compound = expected.compound;
  if (expected.reason !== null) {
    if (!sameText(given.reason, expected.reason)) {
      return `reason for ${compound} is ${show(given.reason)} but should be ${expected.reason}: it has nothing to draw.`;
    }
    if (!Array.isArray(given.draws) || given.draws.length > 0) {
      return `draws for ${compound} should be an empty list: it has nothing to draw (${expected.reason}).`;
    }
    return null;
  }
  if (given.reason !== null && given.reason !== undefined && text(given.reason) !== '') {
    return `reason for ${compound} is ${show(given.reason)}, but it can be drawn, so it should be null.`;
  }
  if (!Array.isArray(given.draws)) return `draws for ${compound} is missing, or is not a list.`;
  for (const draw of expected.draws) {
    const match = given.draws.filter((d) => isObject(d) && sameId(d.lot, draw.lot));
    if (match.length === 0) return `draws for ${compound} has no draw from lot ${draw.lot}.`;
    if (match.length > 1) return `draws for ${compound} lists lot ${draw.lot} twice.`;
    if (!near(match[0].amount_ul, draw.amount_ul, tolerance)) {
      return `amount_ul from lot ${draw.lot} is ${show(match[0].amount_ul)} but should be ${draw.amount_ul} (within ${tolerance}).`;
    }
    if (!sameId(match[0].location, draw.location)) {
      return `location of lot ${draw.lot} is ${show(match[0].location)} but should be ${draw.location}.`;
    }
  }
  const extra = given.draws.find(
    (d) => !expected.draws.some((e) => isObject(d) && sameId(d.lot, e.lot)),
  );
  if (extra !== undefined) {
    return `draws for ${compound} includes lot ${show(isObject(extra) ? extra.lot : extra)}, not one the policy draws from.`;
  }
  return null;
}

function allocationDone(allocation) {
  if (allocation.reason !== null)
    return `${allocation.compound}: nothing to draw (${allocation.reason}).`;
  return `${allocation.compound}: ${allocation.draws.map((d) => d.lot).join(' and ')}.`;
}

// Why the rows added to reservations.csv are not the ones the list's re-tests draw, or null.
function rowsProblem(params, ctx) {
  const change = compareRows(
    ctx.readOriginalTable('reservations.csv'),
    ctx.readTable('reservations.csv'),
  );
  if (change.removed.length > 0) {
    return `reservations.csv: an existing row was changed or deleted (${text(change.removed[0].reservation_id)}).`;
  }
  const wanted = [];
  for (const a of params.allocations) {
    for (const d of a.draws) wanted.push({ compound: a.compound, lot: d.lot, amount: d.amount_ul });
  }
  const seen = [];
  for (const row of change.added) {
    const id = text(row.reservation_id);
    const compound = text(row.compound_id);
    const allocation = params.allocations.find((a) => sameId(compound, a.compound));
    if (!allocation) return `compound_id ${show(row.compound_id)} is not on the list (row ${id}).`;
    if (allocation.reason !== null) {
      return `reservations.csv: ${allocation.compound} has nothing to draw (${allocation.reason}), so it gets no row (row ${id}).`;
    }
    const draw = wanted.find((w) => sameId(w.compound, compound) && sameId(row.lot, w.lot));
    if (!draw)
      return `lot ${show(row.lot)} is not one ${allocation.compound} draws from (row ${id}).`;
    const key = idKey(draw.compound) + '/' + idKey(draw.lot);
    if (seen.includes(key))
      return `reservations.csv holds lot ${draw.lot} twice for ${draw.compound}.`;
    seen.push(key);
    const amount = volumeOf(row.amount, params.unit);
    if (amount === null || Math.abs(amount - draw.amount) > params.tolerance) {
      return `amount is ${show(row.amount)} but should be ${draw.amount} µL, written as a number and ${UNITS[params.unit].text} (lot ${draw.lot}, row ${id}).`;
    }
    if (dayOf(row.reserved_on, params.date_form) !== params.reserved_on) {
      return `reserved_on is ${show(row.reserved_on)} but should be ${params.reserved_on}, written ${FORMS[params.date_form]} (row ${id}).`;
    }
  }
  const missing = wanted.find((w) => !seen.includes(idKey(w.compound) + '/' + idKey(w.lot)));
  if (missing) return `reservations.csv has no row for lot ${missing.lot} of ${missing.compound}.`;
  const ids = change.added.map((row) => text(row.reservation_id));
  const lost = params.ids.find((id) => !ids.includes(id));
  if (lost !== undefined) {
    return `reservation_id: expected the new rows to be ${params.ids.join(', ')}, numbered on from the file, but ${lost} is missing.`;
  }
  return null;
}

// Rows added to and removed from a table. The rows that were there must stay, unchanged and in
// their order, as the start of the table; whatever follows that start in the new table is added,
// and whatever of the old table does not is removed. A changed or moved row counts as one of each.
function compareRows(before, after) {
  const columns = Object.keys(before[0] || after[0] || {});
  const key = (row) => JSON.stringify(columns.map((column) => row[column] ?? null));
  let kept = 0;
  while (kept < before.length && kept < after.length && key(before[kept]) === key(after[kept])) {
    kept += 1;
  }
  return { added: after.slice(kept), removed: before.slice(kept) };
}

// Why reservations.csv changed when the task only asks a question, or null.
function holdsChanged(ctx) {
  const change = compareRows(
    ctx.readOriginalTable('reservations.csv'),
    ctx.readTable('reservations.csv'),
  );
  return change.added.length > 0 || change.removed.length > 0
    ? 'reservations.csv changed, but this task only asks a question.'
    : null;
}

// Why a list of ids is not the expected set, or null.
function setProblem(field, given, expected) {
  if (!Array.isArray(given)) return `${field} is missing from the ANSWER line, or is not a list.`;
  const keys = given.map(idKey);
  const twice = given.find((value, i) => keys.indexOf(idKey(value)) !== i);
  if (twice !== undefined) return `${field} lists ${show(twice)} twice.`;
  const missing = expected.filter((value) => !keys.includes(idKey(value)));
  if (missing.length > 0) return `${field} is missing ${missing.join(', ')}.`;
  const extra = given.filter((value) => !expected.some((e) => idKey(e) === idKey(value)));
  if (extra.length > 0)
    return `${field} includes ${extra.map(show).join(', ')}, which it should not.`;
  return null;
}

// Each unit a lab may write in: how it is written after the number, and microlitres in one.
const UNITS = {
  uL: { text: 'µL', pattern: /^[µμu]l$/i, ul: 1 },
  mL: { text: 'mL', pattern: /^ml$/i, ul: 1000 },
  nL: { text: 'nL', pattern: /^nl$/i, ul: 0.001 },
};

// Microlitres in a cell written as a number and the lab's unit ("20 µL" at a lab that writes µL),
// or null when the unit is missing or another one.
function volumeOf(cell, unit) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(\S+)\s*$/.exec(text(cell));
  if (!match || !UNITS[unit].pattern.test(match[2])) return null;
  return Number(match[1]) * UNITS[unit].ul;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// How each date form is named, as the policies name it.
const FORMS = {
  iso: 'year-month-day',
  us: 'month/day/year',
  dmy: 'day-month-year',
};

// A date written in the lab's form (2026-10-14, 10/14/2026 or 14-Oct-2026), as YYYY-MM-DD, or
// null when it is written another way.
function dayOf(cell, form) {
  const value = text(cell);
  const two = (n) => String(n).padStart(2, '0');
  if (form === 'iso') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  if (form === 'us') {
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
    return match ? `${match[3]}-${two(match[1])}-${two(match[2])}` : null;
  }
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value);
  const month = match ? MONTHS.indexOf(match[2].toLowerCase()) : -1;
  return month >= 0 ? `${match[3]}-${two(month + 1)}-${two(match[1])}` : null;
}

// An id with case, spaces and punctuation set aside.
function idKey(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function sameId(value, expected) {
  return (
    (typeof value === 'string' || typeof value === 'number') && idKey(value) === idKey(expected)
  );
}

// The same text, ignoring case and spaces at the ends.
function sameText(value, expected) {
  if (typeof value !== 'string') return false;
  return value.trim().toLowerCase() === String(expected).trim().toLowerCase();
}

function near(value, expected, tolerance) {
  const number = numberOf(value);
  return number !== null && Math.abs(number - expected) <= tolerance;
}

// A number, or text that is plainly one, as a number; anything else is null.
function numberOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^\s*-?\d+(\.\d+)?\s*$/.test(value)) return null;
  return Number(value);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(cell) {
  return cell === null || cell === undefined ? '' : String(cell).trim();
}

function show(value) {
  if (value === null || value === undefined || value === '') return 'empty';
  return typeof value === 'string' ? `"${value.trim()}"` : JSON.stringify(value);
}

function pass(reason, details) {
  return { pass: true, reason, details: details || {} };
}

function fail(reason, details) {
  return { pass: false, reason, details: details || {} };
}
