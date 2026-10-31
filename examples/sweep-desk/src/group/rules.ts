import type { PolicyNumbers } from './style';

/**
 * The group's rules applied to its true records, before any export wrote them another way. The
 * expected value of every task comes from here. The reference solutions work the same rules out
 * a second way, in the code they send to `run`, from the files as written.
 */

export interface Knobs {
  lr: number;
  warmup: number;
}

export interface Eval {
  /** The step or epoch the eval was logged at. */
  at: number;
  /** Losses as the files hold them: four decimals, or NaN and Infinity. */
  train: number;
  val: number;
}

export interface Run {
  run_id: string;
  sweep_id: string;
  knobs: Knobs;
  seed: number;
  status: string;
  /** In order of `at`. */
  evals: Eval[];
}

export interface Sweep {
  sweep_id: string;
  name: string;
  model: string;
  started_on: string;
  grid: { lr: number[]; warmup: number[] };
  baseline: Knobs;
  runs: Run[];
}

export const sameKnobs = (a: Knobs, b: Knobs): boolean => a.lr === b.lr && a.warmup === b.warmup;

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** Whether a run diverged: its training loss is ever NaN or infinite, or above factor x its first. */
export function diverged(run: Run, policy: PolicyNumbers): boolean {
  const first = run.evals[0]!.train;
  return run.evals.some((e) => !Number.isFinite(e.train) || e.train > policy.factor * first);
}

/** A run's score by the policy: the mean of its last k evals, or its lowest. */
export function runScore(run: Run, policy: PolicyNumbers): number {
  const vals = run.evals.map((e) => e.val);
  return policy.score.kind === 'min' ? Math.min(...vals) : mean(vals.slice(-policy.score.k));
}

export interface ConfigScore {
  knobs: Knobs;
  score: number;
}

/** The distinct configs a sweep ran, in the order their first run appears. */
export function configsOf(sweep: Sweep): Knobs[] {
  const configs: Knobs[] = [];
  for (const run of sweep.runs) {
    if (!configs.some((k) => sameKnobs(k, run.knobs))) configs.push(run.knobs);
  }
  return configs;
}

/** Each config's score: the mean of its seeds' scores, diverged seeds handled as the policy says. */
export function configScores(sweep: Sweep, policy: PolicyNumbers): ConfigScore[] {
  const scores: ConfigScore[] = [];
  for (const knobs of configsOf(sweep)) {
    const runs = sweep.runs.filter((run) => sameKnobs(run.knobs, knobs));
    const kept = runs.filter((run) => !diverged(run, policy));
    if (kept.length === 0) continue;
    if (policy.divergedSeeds === 'exclude' && kept.length < runs.length) continue;
    scores.push({ knobs, score: mean(kept.map((run) => runScore(run, policy))) });
  }
  return scores;
}

/** The best config and how far ahead of the next it is. */
export function bestConfig(sweep: Sweep, policy: PolicyNumbers): ConfigScore & { margin: number } {
  const ranked = [...configScores(sweep, policy)].sort((a, b) => a.score - b.score);
  const [best, next] = ranked;
  if (!best) throw new Error(`${sweep.sweep_id} has no config to rank`);
  return { ...best, margin: next ? next.score - best.score : Infinity };
}

export interface EarlyStop {
  stop_at: number;
  best_at: number;
}

/**
 * Where the policy stops a run: at the eval that makes `patience` evals in a row without a value
 * at least `minDelta` below the best so far, or at its last eval when that never happens.
 */
export function earlyStop(run: Run, policy: PolicyNumbers): EarlyStop {
  let best = Infinity;
  let bestAt = run.evals[0]!.at;
  let since = 0;
  for (const e of run.evals) {
    if (e.val < best - policy.minDelta) {
      best = e.val;
      bestAt = e.at;
      since = 0;
    } else {
      since += 1;
      if (since === policy.patience) return { stop_at: e.at, best_at: bestAt };
    }
  }
  return { stop_at: run.evals.at(-1)!.at, best_at: bestAt };
}

/** The two-sided 95% t value for 1 to 9 degrees of freedom; policy.md lists the same. */
export const T_975 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262];

export type Verdict = 'helped' | 'hurt' | 'unclear';

export interface Paired {
  n: number;
  mean_diff: number;
  low: number;
  high: number;
  verdict: Verdict;
}

/**
 * A paired comparison of a change against a baseline: seeds both ran where neither diverged, each
 * difference the baseline's score minus the change's (above zero: the change lowered the loss),
 * and the 95% interval by the policy's method.
 */
export function paired(
  sweep: Sweep,
  baseline: Knobs,
  change: Knobs,
  policy: PolicyNumbers,
): Paired | null {
  const scoreAt = (knobs: Knobs, seed: number): number | null => {
    const run = sweep.runs.find((r) => sameKnobs(r.knobs, knobs) && r.seed === seed);
    return run && !diverged(run, policy) ? runScore(run, policy) : null;
  };
  const diffs: number[] = [];
  for (const seed of policy.seeds) {
    const a = scoreAt(baseline, seed);
    const b = scoreAt(change, seed);
    if (a !== null && b !== null) diffs.push(a - b);
  }
  const n = diffs.length;
  if (n < 2) return null;
  const m = mean(diffs);
  let low: number;
  let high: number;
  if (policy.interval === 'range') {
    low = Math.min(...diffs);
    high = Math.max(...diffs);
  } else {
    const sd = Math.sqrt(diffs.reduce((sum, d) => sum + (d - m) ** 2, 0) / (n - 1));
    const half = (policy.interval === 't' ? T_975[n - 2]! : 2) * (sd / Math.sqrt(n));
    low = m - half;
    high = m + half;
  }
  const verdict: Verdict = low > 0 ? 'helped' : high < 0 ? 'hurt' : 'unclear';
  return { n, mean_diff: m, low, high, verdict };
}

/** How far the interval's ends stay from zero: a verdict that rounding could flip is too close. */
export const clearance = (p: Paired): number => Math.min(Math.abs(p.low), Math.abs(p.high));

/**
 * The configs one grid step from the best in one knob that no run of the sweep used and no
 * earlier proposal named, in grid order: learning rates first, then warmups.
 */
export function candidates(sweep: Sweep, best: Knobs, proposed: readonly Knobs[]): Knobs[] {
  const ran = configsOf(sweep);
  const step = (values: readonly number[], value: number) => {
    const at = values.indexOf(value);
    return [values[at - 1], values[at + 1]].filter((v): v is number => v !== undefined);
  };
  const near: Knobs[] = [
    ...step(sweep.grid.lr, best.lr).map((lr) => ({ lr, warmup: best.warmup })),
    ...step(sweep.grid.warmup, best.warmup).map((warmup) => ({ lr: best.lr, warmup })),
  ];
  return near.filter(
    (k) => !ran.some((r) => sameKnobs(r, k)) && !proposed.some((p) => sameKnobs(p, k)),
  );
}

/** How many configs a proposal round adds: whole seed sets within the budget, as far as they go. */
export const proposalConfigs = (policy: PolicyNumbers, available: number): number =>
  Math.min(Math.floor(policy.budget / policy.seeds.length), available);

/** Rounded to `places` decimals, half away from zero, for an expected value a task keeps. */
export function round(value: number, places = 6): number {
  const scale = 10 ** places;
  return Math.sign(value) * (Math.round(Math.abs(value) * scale) / scale);
}
