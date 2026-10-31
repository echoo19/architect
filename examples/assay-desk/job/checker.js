// Answer and end-state checks for the assay desk job.
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
// Numbers pass within the task's tolerance; lists of compounds compare as sets. Ids pass however
// their case, spaces and punctuation are written, and a well however it is named (C5, C05, c 5).
// Where the policy allows more than one plan (more compounds qualify for a re-test than a plate
// may take), any plan that keeps to the rules passes, its rows in any order.

var validators = {};

// inhibition: the ANSWER gives each well's percent inhibition, or null for a well with no
// reading, and retests.csv is unchanged.
validators.inhibition = (params, ctx) => {
  const changed = queueChanged(ctx);
  if (changed) return fail(changed);
  const answer = ctx.answer;
  if (!isObject(answer) || !isObject(answer.inhibition)) {
    return fail('inhibition is missing from the ANSWER line, or is not an object of wells.');
  }
  const given = {};
  for (const name of Object.keys(answer.inhibition)) {
    given[wellKey(name)] = answer.inhibition[name];
  }
  for (const well of Object.keys(params.wells)) {
    const expected = params.wells[well];
    if (!hasOwn(given, wellKey(well))) return fail(`inhibition has no value for well ${well}.`);
    const value = given[wellKey(well)];
    if (expected === null) {
      if (value !== null) {
        return fail(
          `inhibition for ${well} is ${show(value)}, but the well has no reading, so it should be null.`,
        );
      }
      continue;
    }
    if (!near(value, expected, params.tolerance)) {
      return fail(
        `inhibition for ${well} is ${show(value)} but should be ${fixed(expected, 2)} (within ${params.tolerance}).`,
      );
    }
  }
  return pass(`Percent inhibition is right for ${Object.keys(params.wells).join(', ')}.`);
};

// hit_set: the ANSWER lists the plate's hits, as a set; none on a plate that fails QC.
validators.hit_set = (params, ctx) => {
  const changed = queueChanged(ctx);
  if (changed) return fail(changed);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  return hitsProblem(answer, params) || pass(hitsDone(params));
};

// plate_qc: the ANSWER gives the plate's Z′ and whether it passes.
validators.plate_qc = (params, ctx) => {
  const changed = queueChanged(ctx);
  if (changed) return fail(changed);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  return qcProblem(answer, params) || pass(`Z′ ${fixed(params.z_prime, 3)}: ${params.qc}.`);
};

// replicate_call: the ANSWER gives the percent inhibition of each well of the compound that has
// a reading, their mean, whether they agree and the call.
validators.replicate_call = (params, ctx) => {
  const changed = queueChanged(ctx);
  if (changed) return fail(changed);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  if (!sameId(answer.compound, params.compound)) {
    return fail(`compound is ${show(answer.compound)} but should be ${params.compound}.`);
  }
  if (!Array.isArray(answer.inhibition)) {
    return fail('inhibition is missing from the ANSWER line, or is not a list.');
  }
  const expected = params.inhibition.slice().sort((a, b) => a - b);
  const given = answer.inhibition.map(numberOf);
  if (given.length !== expected.length || given.some((v) => v === null)) {
    return fail(
      `inhibition lists ${answer.inhibition.length} values but the compound has ${expected.length} wells with a reading: ${expected.map((v) => fixed(v, 2)).join(', ')}.`,
    );
  }
  const sorted = given.slice().sort((a, b) => a - b);
  if (sorted.some((v, i) => Math.abs(v - expected[i]) > params.tolerance)) {
    return fail(
      `inhibition is ${show(answer.inhibition)} but should be ${expected.map((v) => fixed(v, 2)).join(', ')} (within ${params.tolerance}).`,
    );
  }
  if (
    params.mean === null ? answer.mean !== null : !near(answer.mean, params.mean, params.tolerance)
  ) {
    return fail(
      `mean is ${show(answer.mean)} but should be ${params.mean === null ? 'null' : fixed(params.mean, 2)}.`,
    );
  }
  if (answer.agree !== params.agree) {
    return fail(`agree is ${show(answer.agree)} but should be ${params.agree}.`);
  }
  if (!sameText(answer.call, params.call)) {
    return fail(`call is ${show(answer.call)} but should be ${params.call}.`);
  }
  return pass(`${params.compound}: ${params.call}.`);
};

// retest_plan: retests.csv gained the re-tests the policy asks for, and the ANSWER says how many.
validators.retest_plan = (params, ctx) => {
  const problem = queueProblem(params, ctx);
  if (problem) return fail(problem);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  return retestsProblem(answer, params) || pass(queueDone(params));
};

// plate_report: the whole read of a plate: its Z′ and QC, its hits, and the re-tests queued.
validators.plate_report = (params, ctx) => {
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  const answerProblem =
    qcProblem(answer, params) ||
    hitsProblem(answer, params) ||
    retestsProblem(answer, params.retests);
  if (answerProblem) return answerProblem;
  const problem = queueProblem(params.retests, ctx);
  if (problem) return fail(problem);
  return pass(`${hitsDone(params)} ${queueDone(params.retests)}`);
};

function qcProblem(answer, params) {
  if (!hasOwn(answer, 'z_prime')) return fail('z_prime is missing from the ANSWER line.');
  if (!near(answer.z_prime, params.z_prime, params.tolerance)) {
    return fail(
      `z_prime is ${show(answer.z_prime)} but should be ${fixed(params.z_prime, 3)} (within ${params.tolerance}).`,
    );
  }
  if (!sameText(answer.qc, params.qc)) {
    return fail(`qc is ${show(answer.qc)} but should be ${params.qc}.`);
  }
  return null;
}

function hitsProblem(answer, params) {
  if (!Array.isArray(answer.hits))
    return fail('hits is missing from the ANSWER line, or is not a list.');
  if (params.qc === 'fail' && answer.hits.length > 0) {
    return fail(`hits should be empty: plate ${params.plate} fails QC, so no hits are called.`);
  }
  const keys = answer.hits.map(idKey);
  const twice = answer.hits.find((hit, i) => keys.indexOf(idKey(hit)) !== i);
  if (twice !== undefined) return fail(`hits lists ${show(twice)} twice.`);
  const missing = params.hits.filter((hit) => !keys.includes(idKey(hit)));
  if (missing.length > 0) return fail(`hits is missing ${missing.join(', ')}.`);
  const expected = params.hits.map(idKey);
  const extra = answer.hits.filter((hit) => !expected.includes(idKey(hit)));
  if (extra.length > 0) {
    return fail(
      `hits includes ${extra.map(show).join(', ')}, not ${extra.length === 1 ? 'a hit' : 'hits'} by the lab's rules.`,
    );
  }
  return null;
}

function hitsDone(params) {
  if (params.qc === 'fail') return `${params.plate} fails QC, so no hits are called.`;
  return `${params.hits.length} hits on ${params.plate}.`;
}

function expectedCount(plan) {
  return plan.plates.reduce((sum, plate) => sum + (plate.whole ? 1 : 0) + plate.take, 0);
}

function retestsProblem(answer, plan) {
  if (!hasOwn(answer, 'retests')) return fail('retests is missing from the ANSWER line.');
  if (numberOf(answer.retests) !== expectedCount(plan)) {
    return fail(
      `retests in the ANSWER line is ${show(answer.retests)} but should be ${expectedCount(plan)}.`,
    );
  }
  return null;
}

function queueDone(plan) {
  const count = expectedCount(plan);
  return count === 0 ? 'Nothing new to re-test.' : `Queued ${count} re-tests.`;
}

// Why the rows added to retests.csv are not a plan the policy allows, or null.
function queueProblem(plan, ctx) {
  const change = compareRows(ctx.readOriginalTable('retests.csv'), ctx.readTable('retests.csv'));
  if (change.removed.length > 0) {
    return `retests.csv: an existing row was changed or deleted (${text(change.removed[0].retest_id)}).`;
  }
  const byPlate = {};
  for (const row of change.added) {
    const id = text(row.retest_id);
    if (text(row.requested_on) !== plan.requested_on) {
      return `requested_on is ${show(row.requested_on)} but should be ${plan.requested_on} (row ${id}).`;
    }
    const plate = plan.plates.find((p) => sameId(text(row.plate_id), p.plate));
    if (!plate) return `plate_id ${show(row.plate_id)} was not asked about (row ${id}).`;
    (byPlate[plate.plate] = byPlate[plate.plate] || []).push(row);
  }
  for (const plate of plan.plates) {
    const rows = byPlate[plate.plate] || [];
    const problem =
      plate.qc === 'fail' ? wholeProblem(plate, rows, plan) : compoundsProblem(plate, rows);
    if (problem) return problem;
  }
  const ids = change.added.map((row) => text(row.retest_id));
  const missing = plan.ids.find((id) => !ids.includes(id));
  if (missing !== undefined) {
    return `retest_id: expected the new rows to be ${plan.ids.join(', ')}, numbered on from the file, but ${missing} is missing.`;
  }
  return null;
}

// A plate that fails QC: one row for the whole plate, unless the queue already holds one.
function wholeProblem(plate, rows, plan) {
  if (!plate.whole) {
    return rows.length > 0
      ? `retests.csv: ${plate.plate} is already queued whole, so it needs no new row.`
      : null;
  }
  if (rows.length !== 1 || text(rows[0].compound_id) !== '') {
    return `retests.csv: ${plate.plate} fails QC, so it gets one row for the whole plate with compound_id empty, not ${rows.length} ${rows.length === 1 ? 'row' : 'rows'} with compounds.`;
  }
  if (!sameText(rows[0].reason, plan.qc_reason)) {
    return `reason is ${show(rows[0].reason)} but should be ${plan.qc_reason} (the whole of ${plate.plate}).`;
  }
  return null;
}

// A plate that passes: its inconclusive and borderline compounds, as many as the policy takes.
function compoundsProblem(plate, rows) {
  if (rows.some((row) => text(row.compound_id) === '')) {
    return `compound_id is empty on a row for ${plate.plate}, but the plate passes QC: queue its compounds, not the whole plate.`;
  }
  if (rows.length !== plate.take) {
    const why =
      plate.candidates.length > plate.take
        ? ` (${plate.candidates.length} qualify, and the policy takes at most ${plate.take})`
        : '';
    return `retests.csv gained ${rows.length} rows for ${plate.plate} but should gain ${plate.take}${why}.`;
  }
  const seen = [];
  for (const row of rows) {
    const compound = text(row.compound_id);
    const candidate = plate.candidates.find((c) => sameId(compound, c.compound));
    if (!candidate) {
      return `compound_id ${show(row.compound_id)} on ${plate.plate} is neither inconclusive nor borderline, or is already queued.`;
    }
    if (seen.includes(idKey(compound))) return `compound_id ${compound} is queued twice.`;
    seen.push(idKey(compound));
    if (!sameText(row.reason, candidate.reason)) {
      return `reason is ${show(row.reason)} but should be ${candidate.reason} (${compound} on ${plate.plate}).`;
    }
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

// Why retests.csv changed when the task only asks a question, or null.
function queueChanged(ctx) {
  const change = compareRows(ctx.readOriginalTable('retests.csv'), ctx.readTable('retests.csv'));
  return change.added.length > 0 || change.removed.length > 0
    ? 'retests.csv changed, but this task only asks a question.'
    : null;
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

// A well as row letter and column number: C5, C05 and "c 05" are all C5.
function wellKey(name) {
  const match = /^\s*([A-Pa-p])\s*0*(\d+)\s*$/.exec(String(name));
  return match ? match[1].toUpperCase() + Number(match[2]) : String(name).trim().toUpperCase();
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

function fixed(value, digits) {
  return Number(value).toFixed(digits);
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

function pass(reason, details) {
  return { pass: true, reason, details: details || {} };
}

function fail(reason, details) {
  return { pass: false, reason, details: details || {} };
}
