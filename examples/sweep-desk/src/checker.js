// End-state and answer checks for the sweep desk job.
//
// The runner loads this file in a sandbox and calls the validator a task names, passing the
// task's params and a context:
//   ctx.readTable(name)          a table of the task's group after the attempt: one object per
//                                row, each value a string, empty cells null
//   ctx.readOriginalTable(name)  the same table before the attempt
//   ctx.answer                   the JSON after the reply's last ANSWER: line, or null
// A validator returns { pass, reason, details }. The reason is one sentence for a person, and it
// starts with the field or table that is wrong. Nothing here reads a clock or draws a random
// number, so the same attempt always gets the same verdict.
//
// The expected values come with the task. A loss or a difference passes within 0.001 of it, so
// one rounded to three decimals passes and one worked out another way fails. A learning rate
// passes however it is written (0.0003, 3e-4, "3.0e-04"). Where the policy allows more than one
// right action, any of them passes: any of the configs a proposal round may name.

var validators = {};

// The tables an attempt may write to.
const WRITABLE_TABLES = ['proposed_runs.csv', 'decisions.csv'];
const TOLERANCE = 0.001;

// best_config: no table changed, and the ANSWER names the best config and its score.
validators.best_config = (params, ctx) => {
  const other = otherTableChanged(ctx, null);
  if (other) return fail(`${other} changed, but this task only asks a question.`);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  return bestProblem(answer, params) || pass(`The best config is ${configText(params)}.`);
};

// early_stop: no table changed, and the ANSWER names where the run stops and its best eval.
validators.early_stop = (params, ctx) => {
  const other = otherTableChanged(ctx, null);
  if (other) return fail(`${other} changed, but this task only asks a question.`);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  for (const field of ['stop_at', 'best_at']) {
    if (!hasOwn(answer, field)) return fail(`${field} is missing from the ANSWER line.`);
    if (numberOf(answer[field]) !== params[field]) {
      return fail(
        `${field} is ${show(answer[field])} but should be ${params[field]} (the ${params.unit}).`,
      );
    }
  }
  return pass(`The run stops at ${params.unit} ${params.stop_at}, best at ${params.best_at}.`);
};

// diverged_runs: no table changed, and the ANSWER lists exactly the runs that diverged.
validators.diverged_runs = (params, ctx) => {
  const other = otherTableChanged(ctx, null);
  if (other) return fail(`${other} changed, but this task only asks a question.`);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  return (
    runsProblem(answer.runs, params.runs, 'runs') ||
    pass(params.runs.length === 0 ? 'No run diverged.' : `Diverged: ${params.runs.join(', ')}.`)
  );
};

// did_it_help: no table changed, and the ANSWER gives the pairs, the mean difference, the
// interval and the verdict.
validators.did_it_help = (params, ctx) => {
  const other = otherTableChanged(ctx, null);
  if (other) return fail(`${other} changed, but this task only asks a question.`);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  return pairedProblem(answer, params) || pass(`The change ${params.verdict}, n = ${params.n}.`);
};

// runs_proposed: proposed_runs.csv gained the runs a proposal round allows and nothing else
// changed; the ANSWER says how many.
validators.runs_proposed = (params, ctx) => {
  const other = otherTableChanged(ctx, 'proposed_runs.csv');
  if (other) return fail(`${other} changed, but this task only proposes runs.`);
  const problem = proposalProblem(params, ctx);
  if (problem) return fail(problem);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  const rows = params.proposal_ids.length;
  if (numberOf(answer.proposed) !== rows) {
    return fail(`proposed in the ANSWER line is ${show(answer.proposed)} but should be ${rows}.`);
  }
  return pass(`Proposed ${params.configs} configs, ${rows} runs.`);
};

// sweep_report: the ANSWER gives the best config, the diverged runs and the comparison with the
// baseline, and decisions.csv gained one row recording the decision; nothing else changed.
validators.sweep_report = (params, ctx) => {
  const other = otherTableChanged(ctx, 'decisions.csv');
  if (other) return fail(`${other} changed, but this task only writes the decision.`);
  const answer = ctx.answer;
  if (!isObject(answer)) return fail('The reply has no ANSWER line with a JSON object.');
  const answerProblem =
    bestProblem(answer, params) ||
    runsProblem(answer.diverged, params.diverged, 'diverged') ||
    pairedProblem(answer, params);
  if (answerProblem) return answerProblem;
  if (text(answer.decision).toLowerCase() !== params.decision) {
    return fail(`decision is ${show(answer.decision)} but should be ${params.decision}.`);
  }
  const change = compareRows(
    ctx.readOriginalTable('decisions.csv'),
    ctx.readTable('decisions.csv'),
  );
  if (change.removed.length > 0) {
    return fail(
      `decisions.csv: an existing row was changed or deleted (${text(change.removed[0].decision_id)}).`,
    );
  }
  if (change.added.length !== 1) {
    return fail(`decisions.csv gained ${change.added.length} rows but should gain one.`);
  }
  const row = change.added[0];
  const field = fieldProblem(row, {
    decision_id: params.decision_id,
    sweep_id: params.sweep_id,
    decided_on: params.decided_on,
    decision: params.decision,
  });
  if (field) return fail(`${field} (decisions.csv).`);
  const knobs = knobProblem(row, params, params.fields);
  if (knobs) return fail(`${knobs} (decisions.csv).`);
  return pass(`${configText(params)} is best; the decision is ${params.decision}.`);
};

function bestProblem(answer, params) {
  for (const field of ['lr', 'warmup']) {
    if (!hasOwn(answer, field)) return fail(`${field} is missing from the ANSWER line.`);
    if (!sameNumber(answer[field], params[field])) {
      return fail(`${field} is ${show(answer[field])} but should be ${params[field]}.`);
    }
  }
  return lossProblem(answer, params, 'score');
}

function pairedProblem(answer, params) {
  if (!hasOwn(answer, 'n')) return fail('n is missing from the ANSWER line.');
  if (numberOf(answer.n) !== params.n) {
    return fail(`n is ${show(answer.n)} but should be ${params.n} pairs.`);
  }
  for (const field of ['mean_diff', 'low', 'high']) {
    const problem = lossProblem(answer, params, field);
    if (problem) return problem;
  }
  if (text(answer.verdict).toLowerCase() !== params.verdict) {
    return fail(`verdict is ${show(answer.verdict)} but should be ${params.verdict}.`);
  }
  return null;
}

function lossProblem(answer, params, field) {
  if (!hasOwn(answer, field)) return fail(`${field} is missing from the ANSWER line.`);
  const value = numberOf(answer[field]);
  if (value === null || Math.abs(value - params[field]) > TOLERANCE) {
    return fail(`${field} is ${show(answer[field])} but should be ${params[field].toFixed(3)}.`);
  }
  return null;
}

function runsProblem(value, expected, field) {
  if (!Array.isArray(value)) return fail(`${field} in the ANSWER line is not a list of run ids.`);
  const given = value.map((id) => text(id));
  const missing = expected.find((id) => !given.includes(id));
  if (missing !== undefined) return fail(`${field} leaves out ${missing}, which diverged.`);
  const extra = given.find((id) => !expected.includes(id));
  if (extra !== undefined) return fail(`${field} lists ${extra}, which did not diverge.`);
  if (given.length !== expected.length) return fail(`${field} lists a run more than once.`);
  return null;
}

// Why the proposals written are not a round the policy allows, or null.
function proposalProblem(params, ctx) {
  const change = compareRows(
    ctx.readOriginalTable('proposed_runs.csv'),
    ctx.readTable('proposed_runs.csv'),
  );
  if (change.removed.length > 0) {
    return `proposed_runs.csv: an existing row was changed or deleted (${text(change.removed[0].proposal_id)}).`;
  }
  const rows = params.proposal_ids.length;
  if (change.added.length !== rows) {
    return `proposed_runs.csv gained ${change.added.length} rows but should gain ${rows}: ${params.configs} configs with each of the ${params.seeds.length} seeds.`;
  }
  const ids = change.added.map((row) => text(row.proposal_id));
  const missingId = params.proposal_ids.find((id) => !ids.includes(id));
  if (missingId !== undefined) {
    return `proposal_id: expected the new rows to be ${params.proposal_ids.join(', ')}, numbered on from the file, but ${missingId} is missing.`;
  }
  const lrField = params.fields.lr;
  const warmupField = params.fields.warmup;
  const configs = [];
  for (const row of change.added) {
    const id = text(row.proposal_id);
    const field = fieldProblem(row, {
      sweep_id: params.sweep_id,
      proposed_on: params.proposed_on,
    });
    if (field) return `${field} (row ${id}).`;
    const knobs = { lr: numberOf(row[lrField]), warmup: numberOf(row[warmupField]) };
    if (!params.grid.lr.some((lr) => sameNumber(knobs.lr, lr))) {
      return `${lrField} ${show(row[lrField])} is not on the sweep's grid (row ${id}).`;
    }
    if (!params.grid.warmup.some((w) => sameNumber(knobs.warmup, w))) {
      return `${warmupField} ${show(row[warmupField])} is not on the sweep's grid (row ${id}).`;
    }
    const config = `${knobs.lr}/${knobs.warmup}`;
    if (params.ran.some((k) => sameConfig(k, knobs))) {
      return `${config} was already run in the sweep (row ${id}).`;
    }
    if (params.proposed.some((k) => sameConfig(k, knobs))) {
      return `${config} was already proposed for the sweep (row ${id}).`;
    }
    if (!nextToBest(knobs, params)) {
      return `${config} is not one grid step from the best config, ${configText(params.best)} (row ${id}).`;
    }
    let entry = configs.find((c) => sameConfig(c.knobs, knobs));
    if (!entry) {
      entry = { knobs, seeds: [] };
      configs.push(entry);
    }
    const seed = numberOf(row.seed);
    if (!params.seeds.includes(seed)) {
      return `seed ${show(row.seed)} is not one of the group's seeds (row ${id}).`;
    }
    if (entry.seeds.includes(seed)) return `seed ${seed} is proposed twice for ${config}.`;
    entry.seeds.push(seed);
  }
  if (configs.length !== params.configs) {
    return `proposed_runs.csv names ${configs.length} configs but should name ${params.configs}, each with every seed.`;
  }
  return null;
}

function nextToBest(knobs, params) {
  const step = (values, from, to) => {
    const a = values.findIndex((v) => sameNumber(v, from));
    const b = values.findIndex((v) => sameNumber(v, to));
    return a >= 0 && b >= 0 && Math.abs(a - b) === 1;
  };
  const best = params.best;
  return (
    (sameNumber(knobs.warmup, best.warmup) && step(params.grid.lr, best.lr, knobs.lr)) ||
    (sameNumber(knobs.lr, best.lr) && step(params.grid.warmup, best.warmup, knobs.warmup))
  );
}

function knobProblem(row, expected, fields) {
  for (const knob of ['lr', 'warmup']) {
    const column = fields[knob];
    if (!sameNumber(row[column], expected[knob])) {
      return `${column} is ${show(row[column])} but should be ${expected[knob]}`;
    }
  }
  return null;
}

function fieldProblem(row, expected) {
  for (const field of Object.keys(expected)) {
    if (text(row[field]) !== expected[field]) {
      return `${field} is ${show(row[field])} but should be ${expected[field]}`;
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

// The first writable table other than `allowed` whose rows the attempt changed, or null.
function otherTableChanged(ctx, allowed) {
  for (const table of WRITABLE_TABLES) {
    if (table === allowed) continue;
    const change = compareRows(ctx.readOriginalTable(table), ctx.readTable(table));
    if (change.added.length > 0 || change.removed.length > 0) return table;
  }
  return null;
}

function configText(knobs) {
  return `lr ${knobs.lr}, warmup ${knobs.warmup}`;
}

function sameConfig(a, b) {
  return sameNumber(a.lr, b.lr) && sameNumber(a.warmup, b.warmup);
}

// The same number, however it is written: 0.0003, 3e-4 and "3.0e-04" are one learning rate.
function sameNumber(value, expected) {
  const a = numberOf(value);
  const b = numberOf(expected);
  return a !== null && b !== null && Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
}

// A number, or text that is plainly one (decimal or scientific notation), as a number; else null.
function numberOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  if (!/^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i.test(value)) return null;
  return Number(value);
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
