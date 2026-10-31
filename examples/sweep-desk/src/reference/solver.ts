import type { JsonValue } from '@architect/shared';
import type { CsvRow } from '../lib/csv';
import type { HelpRequest, RunRequest, SweepRequest } from '../tasks/build';
import { readPolicy } from './policy';
import type { Policy } from './policy';
import type { AgentTools } from './tools';

/**
 * Reference solutions that use only the agent's built-in tools, the way a careful agent works:
 * read policy.md, send code to `run` that reads the group's files and applies the policy's rules
 * to the sweep the request names, and append any rows the request asks for. Nothing about a group
 * is known in advance: its metric names and numbers come from policy.md, its knob names, grid,
 * configs and ids from its files. What the code knows on its own is how training logs differ:
 *
 * - a config is in runs.csv or in configs.json, its knobs named `lr` or `learning_rate`,
 *   `warmup` or `warmup_steps`;
 * - a metric name is matched with its capitals, separators and spaces set aside;
 * - a loss may be written in scientific notation, and NaN and infinity in several spellings;
 * - a learning rate may be written 0.0003, 3e-4 or 3.0e-04;
 * - a run's rows may come in any order, so its evals are sorted by step or epoch;
 * - `status` says nothing about divergence, so only the losses are read.
 */

/** The rules the code applies, the same for every request. `P` is the policy's numbers. */
const LIB = [
  "const read = (name) => csv.parse(files.read('data/' + name));",
  "const key = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();",
  'const num = (s) => {',
  '  const t = String(s).trim().toLowerCase();',
  "  if (t === 'nan' || t === '-nan') return NaN;",
  "  if (t === 'inf' || t === '+inf' || t === 'infinity') return Infinity;",
  '  return Number(t);',
  '};',
  'const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;',
  'const r3 = (x) => Math.round(x * 1000) / 1000;',
  "const LR = ['lr', 'learning_rate'];",
  "const WARMUP = ['warmup', 'warmup_steps'];",
  'const knob = (row, names) => names.find((name) => name in row);',
  "const runs = read('runs.csv');",
  'const fromJson = knob(runs[0], LR) === undefined;',
  "const configs = fromJson ? JSON.parse(files.read('data/configs.json')) : null;",
  'const configOf = (run) => {',
  '  const c = fromJson ? configs[run.run_id] : run;',
  '  return { lr: num(c[knob(c, LR)]), warmup: num(c[knob(c, WARMUP)]) };',
  '};',
  'const same = (a, b) => a.lr === b.lr && a.warmup === b.warmup;',
  "const sweep = read('sweeps.csv').find((s) => s.sweep_id === SWEEP);",
  'const knobsIn = (text) => {',
  '  const out = {};',
  "  for (const part of text.split(';')) {",
  "    const [name, values] = part.split('=');",
  "    out[LR.includes(name.trim()) ? 'lr' : 'warmup'] = values.split('/').map(num);",
  '  }',
  '  return out;',
  '};',
  'const grid = knobsIn(sweep.grid);',
  'const base = knobsIn(sweep.baseline);',
  'const baseline = { lr: base.lr[0], warmup: base.warmup[0] };',
  'const mine = runs',
  '  .filter((run) => run.sweep_id === SWEEP)',
  '  .map((run) => Object.assign({ id: run.run_id, seed: Number(run.seed) }, configOf(run)));',
  'const ids = new Set(mine.map((run) => run.id));',
  "const metrics = read('metrics.csv');",
  "const AXIS = 'step' in metrics[0] ? 'step' : 'epoch';",
  'const series = {};',
  'for (const row of metrics) {',
  '  if (!ids.has(row.run_id)) continue;',
  '  const k = key(row.metric);',
  "  const kind = k === key(P.metrics.val) ? 'val' : k === key(P.metrics.train) ? 'train' : null;",
  '  if (kind === null) continue;',
  '  if (!series[row.run_id]) series[row.run_id] = { train: [], val: [] };',
  '  series[row.run_id][kind].push({ at: Number(row[AXIS]), v: num(row.value) });',
  '}',
  'for (const id in series) {',
  '  series[id].train.sort((a, b) => a.at - b.at);',
  '  series[id].val.sort((a, b) => a.at - b.at);',
  '}',
  'const diverged = (id) => {',
  '  const train = series[id].train;',
  '  return train.some((e) => !Number.isFinite(e.v) || e.v > P.factor * train[0].v);',
  '};',
  'const score = (id) => {',
  '  const vals = series[id].val.map((e) => e.v);',
  "  return P.score.kind === 'min' ? Math.min(...vals) : mean(vals.slice(-P.score.k));",
  '};',
  'const configList = [];',
  'for (const run of mine) if (!configList.some((c) => same(c, run))) configList.push({ lr: run.lr, warmup: run.warmup });',
  'const configScore = (c) => {',
  '  const all = mine.filter((run) => same(run, c));',
  '  const kept = all.filter((run) => !diverged(run.id));',
  '  if (kept.length === 0) return null;',
  "  if (P.divergedSeeds === 'exclude' && kept.length < all.length) return null;",
  '  return mean(kept.map((run) => score(run.id)));',
  '};',
  'const best = () => {',
  '  let found = null;',
  '  for (const c of configList) {',
  '    const s = configScore(c);',
  '    if (s !== null && (found === null || s < found.score)) found = { lr: c.lr, warmup: c.warmup, score: s };',
  '  }',
  '  return { lr: found.lr, warmup: found.warmup, score: r3(found.score) };',
  '};',
  'const divergedRuns = () => mine.filter((run) => diverged(run.id)).map((run) => run.id);',
  'const compare = (a, b) => {',
  '  const d = [];',
  '  for (const seed of P.seeds) {',
  '    const ra = mine.find((run) => same(run, a) && run.seed === seed);',
  '    const rb = mine.find((run) => same(run, b) && run.seed === seed);',
  '    if (ra && rb && !diverged(ra.id) && !diverged(rb.id)) d.push(score(ra.id) - score(rb.id));',
  '  }',
  '  const n = d.length;',
  '  const m = mean(d);',
  '  let low = Math.min(...d);',
  '  let high = Math.max(...d);',
  "  if (P.interval !== 'range') {",
  '    const sd = Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));',
  "    const half = ((P.interval === 't' ? P.t[n - 2] : 2) * sd) / Math.sqrt(n);",
  '    low = m - half;',
  '    high = m + half;',
  '  }',
  "  const verdict = low > 0 ? 'helped' : high < 0 ? 'hurt' : 'unclear';",
  '  return { n, mean_diff: r3(m), low: r3(low), high: r3(high), verdict };',
  '};',
  "const header = (name) => files.read('data/' + name).split('\\n')[0].split(',');",
  'const nextIds = (rows, column, count) => {',
  "  let max = -1, prefix = '', width = 0;",
  '  for (const row of rows) {',
  '    const m = /^(.*?)(\\d+)$/.exec(row[column]);',
  '    if (m && Number(m[2]) > max) [max, prefix, width] = [Number(m[2]), m[1], m[2].length];',
  '  }',
  "  return Array.from({ length: count }, (_, i) => prefix + String(max + 1 + i).padStart(width, '0'));",
  '};',
];

const json = (value: unknown): string => JSON.stringify(value);

/** The code for one run: the policy's numbers, the sweep, the date, the rules, then `tail`. */
function code(policy: Policy, sweep: string, today: string, tail: readonly string[]): string {
  return [
    `const P = ${json(policy)};`,
    `const SWEEP = ${sweep};`,
    `const TODAY = ${json(today)};`,
    ...LIB,
    ...tail,
  ].join('\n');
}

function policyOf(tools: AgentTools): Policy {
  tools.readAll('policy.md');
  return readPolicy(tools.fileText('policy.md'));
}

const asRows = (value: JsonValue): CsvRow[] =>
  (value as Record<string, JsonValue>[]).map((row) =>
    Object.fromEntries(Object.entries(row).map(([column, cell]) => [column, String(cell)])),
  );

export function bestConfig(tools: AgentTools, request: SweepRequest): JsonValue {
  const policy = policyOf(tools);
  return tools.run(code(policy, json(request.sweep_id), request.today, ['best()']));
}

export function divergedRuns(tools: AgentTools, request: SweepRequest): JsonValue {
  const policy = policyOf(tools);
  return tools.run(
    code(policy, json(request.sweep_id), request.today, ['({ runs: divergedRuns() })']),
  );
}

/** The run's sweep is found from runs.csv, so the code needs only the run. */
export function earlyStop(tools: AgentTools, request: RunRequest): JsonValue {
  const policy = policyOf(tools);
  const sweep = `csv.parse(files.read('data/runs.csv')).find((run) => run.run_id === ${json(request.run_id)}).sweep_id`;
  return tools.run(
    code(policy, sweep, request.today, [
      `const evals = series[${json(request.run_id)}].val;`,
      'let low = Infinity;',
      'let bestAt = evals[0].at;',
      'let since = 0;',
      'let stopAt = evals[evals.length - 1].at;',
      'for (const e of evals) {',
      '  if (e.v < low - P.minDelta) {',
      '    low = e.v;',
      '    bestAt = e.at;',
      '    since = 0;',
      '  } else if (++since === P.patience) {',
      '    stopAt = e.at;',
      '    break;',
      '  }',
      '}',
      '({ stop_at: stopAt, best_at: bestAt })',
    ]),
  );
}

export function didItHelp(tools: AgentTools, request: HelpRequest): JsonValue {
  const policy = policyOf(tools);
  return tools.run(
    code(policy, json(request.sweep_id), request.today, [
      `compare(${json(request.baseline)}, ${json(request.change)})`,
    ]),
  );
}

/** The proposal rows the code works out, appended; the ANSWER counts them. */
export function nextRuns(tools: AgentTools, request: SweepRequest): JsonValue {
  const policy = policyOf(tools);
  const rows = tools.run(
    code(policy, json(request.sweep_id), request.today, [
      "const proposed = read('proposed_runs.csv');",
      "const columns = header('proposed_runs.csv');",
      'const lrColumn = knob(Object.fromEntries(columns.map((c) => [c, 1])), LR);',
      'const warmupColumn = knob(Object.fromEntries(columns.map((c) => [c, 1])), WARMUP);',
      'const earlier = proposed',
      '  .filter((row) => row.sweep_id === SWEEP)',
      '  .map((row) => ({ lr: num(row[lrColumn]), warmup: num(row[warmupColumn]) }));',
      'const top = best();',
      'const step = (values, value) => {',
      '  const at = values.indexOf(value);',
      '  return [values[at - 1], values[at + 1]].filter((v) => v !== undefined);',
      '};',
      'const near = [',
      '  ...step(grid.lr, top.lr).map((lr) => ({ lr, warmup: top.warmup })),',
      '  ...step(grid.warmup, top.warmup).map((warmup) => ({ lr: top.lr, warmup })),',
      '].filter((c) => !configList.some((r) => same(r, c)) && !earlier.some((p) => same(p, c)));',
      'const chosen = near.slice(0, Math.floor(P.budget / P.seeds.length));',
      "const newIds = nextIds(proposed, 'proposal_id', chosen.length * P.seeds.length);",
      'chosen.flatMap((c, i) => P.seeds.map((seed, j) => ({',
      '  proposal_id: newIds[i * P.seeds.length + j],',
      '  sweep_id: SWEEP,',
      '  [lrColumn]: c.lr,',
      '  [warmupColumn]: c.warmup,',
      '  seed,',
      '  proposed_on: TODAY,',
      '})))',
    ]),
  );
  const added = asRows(rows);
  if (added.length > 0) tools.append('proposed_runs.csv', added);
  return { proposed: added.length };
}

/** The report the code works out, with its decision row appended. */
export function sweepReport(tools: AgentTools, request: SweepRequest): JsonValue {
  const policy = policyOf(tools);
  const report = tools.run(
    code(policy, json(request.sweep_id), request.today, [
      'const top = best();',
      'const against = compare(baseline, top);',
      "const decision = against.verdict === 'helped' ? 'adopt' : 'keep';",
      "const columns = header('decisions.csv');",
      'const lookup = Object.fromEntries(columns.map((c) => [c, 1]));',
      "const [id] = nextIds(read('decisions.csv'), 'decision_id', 1);",
      '({',
      '  answer: Object.assign({}, top, { diverged: divergedRuns() }, against, { decision }),',
      '  row: {',
      '    decision_id: id,',
      '    sweep_id: SWEEP,',
      '    decided_on: TODAY,',
      '    [knob(lookup, LR)]: top.lr,',
      '    [knob(lookup, WARMUP)]: top.warmup,',
      '    decision,',
      '  },',
      '})',
    ]),
  ) as { answer: JsonValue; row: JsonValue };
  tools.append('decisions.csv', asRows([report.row]));
  return report.answer;
}
