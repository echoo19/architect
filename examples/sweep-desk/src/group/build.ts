import { addDays } from '../lib/calendar';
import { compareText } from '../lib/compare';
import type { Random } from '../lib/random';
import {
  bestConfig,
  candidates,
  clearance,
  configScores,
  configsOf,
  diverged,
  paired,
  sameKnobs,
} from './rules';
import type { Eval, Knobs, Run, Sweep } from './rules';
import type { GroupStyle, IdFormat } from './style';

/**
 * A research group's true records, built from its seed: its sweeps, every run with its config,
 * seed and losses, the runs proposed earlier and its decisions log. Losses come from a simple
 * model of training: a curve that falls toward a floor set by the config, a seed effect shared
 * by every config of a sweep (so pairing by seed matters), noise, some runs that start to
 * overfit, some that blow up, and a few that spike and recover.
 */

/** Sweeps a group has, each the subject of one task of every skill. */
export const SWEEPS = 8;
/** Grid points a sweep ran, the baseline among them, out of the twelve on its grid. */
const RAN_CONFIGS = 5;
const LR_LADDER = [1e-4, 2e-4, 3e-4, 6e-4, 1e-3, 2e-3, 3e-3, 6e-3];
const WARMUP_LADDER = [0, 250, 500, 1000, 2000];
const MODEL_FLOOR: Record<string, number> = {
  '70M': 3.62,
  '125M': 3.41,
  '160M': 3.33,
  '350M': 3.08,
  '410M': 3.01,
  '760M': 2.86,
  '1B': 2.77,
  '1.3B': 2.69,
  '1.4B': 2.66,
};

export interface Proposal {
  proposal_id: string;
  sweep_id: string;
  knobs: Knobs;
  seed: number;
  proposed_on: string;
}

export interface Decision {
  decision_id: string;
  sweep_id: string;
  decided_on: string;
  knobs: Knobs;
  decision: 'adopt' | 'keep';
}

export interface Group {
  style: GroupStyle;
  sweeps: Sweep[];
  proposals: Proposal[];
  decisions: Decision[];
}

export function formatId(format: IdFormat, n: number): string {
  return `${format.prefix}${String(n).padStart(format.width, '0')}`;
}

/** A normal draw (Box-Muller). */
function normal(random: Random, sd: number): number {
  const u = 1 - random.next();
  const v = random.next();
  return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A loss as the group's tools log it: four decimals. */
const four = (value: number): number =>
  Number.isFinite(value) ? Math.round(value * 1e4) / 1e4 : value;

interface SweepModel {
  grid: Sweep['grid'];
  floor: number;
  /** The best log10 learning rate and how fast the loss rises away from it. */
  bestLog: number;
  curvature: number;
  /** How much warmup lowers the loss at the two highest learning rates. */
  warmup: number;
  seedEffect: Map<number, number>;
}

/** How a run blows up, if it does: from which eval, and whether it reaches NaN or levels off. */
interface BlowUp {
  from: number;
  levelsAt: number | null;
  /** NaN or Infinity once the loss overflows, and whether the run then stops logging. */
  overflow: number;
  crashes: boolean;
}

/** One run's losses: `evals` evals, one every `interval` steps. */
function curve(
  random: Random,
  style: GroupStyle,
  model: SweepModel,
  knobs: Knobs,
  seed: number,
  interval: number,
  evals: number,
): { evals: Eval[]; blewUp: boolean } {
  const total = interval * evals;
  const high = knobs.lr >= model.grid.lr[2]!;
  const warm = knobs.warmup === 0 ? 0 : model.warmup * (high ? 1 : 0.4);
  const floor =
    model.floor +
    model.curvature * (Math.log10(knobs.lr) - model.bestLog) ** 2 -
    warm +
    model.seedEffect.get(seed)! +
    normal(random, 0.006);
  const tau = total / (7 + 4 * random.next());
  const valHeight = 1.5 + random.next();
  const trainHeight = 3.5 + 2 * random.next();
  const gap = 0.1 + 0.1 * random.next();
  const overfit = random.chance(0.35) ? (0.01 + 0.02 * random.next()) * (style.evals / evals) : 0;
  const overfitFrom = Math.floor(evals * (0.55 + 0.25 * random.next()));
  const top = knobs.lr === model.grid.lr[3];
  const risk = top ? (knobs.warmup === 0 ? 0.6 : 0.2) : high && knobs.warmup === 0 ? 0.15 : 0.02;
  const blowUp: BlowUp | null = random.chance(risk)
    ? {
        from: Math.floor(evals * (0.3 + 0.5 * random.next())),
        levelsAt: random.chance(0.3) ? 20 + 40 * random.next() : null,
        overflow: random.chance(0.4) ? Infinity : NaN,
        crashes: random.chance(0.5),
      }
    : null;
  const spike =
    blowUp === null && random.chance(0.12)
      ? { at: Math.floor(evals * (0.35 + 0.2 * random.next())), size: random.pick([0.8, 1.2]) }
      : null;

  const out: Eval[] = [];
  for (let i = 1; i <= evals; i += 1) {
    const t = i * interval;
    let train = trainHeight * Math.exp(-t / tau) + floor - gap + normal(random, 0.01);
    let val =
      valHeight * Math.exp(-t / tau) +
      floor +
      overfit * Math.max(0, i - overfitFrom) +
      normal(random, 0.005);
    const prev = out.at(-1);
    if (blowUp && prev && i >= blowUp.from) {
      const g = 1.6 + 1.4 * random.next();
      if (!Number.isFinite(prev.train)) {
        if (blowUp.crashes) break;
        train = blowUp.overflow;
        val = NaN;
      } else if (blowUp.levelsAt !== null) {
        train = Math.min(prev.train * g, blowUp.levelsAt + random.next());
        val = Math.min(prev.val * g, blowUp.levelsAt + 1 + random.next());
      } else if (prev.train * g < 200) {
        train = prev.train * g;
        val = prev.val * (1 + (g - 1) / 2);
      } else {
        train = blowUp.overflow;
        val = NaN;
      }
    }
    if (spike && i === spike.at) {
      train = style.policy.factor * out[0]!.train * spike.size;
      val += 0.3;
    }
    out.push({ at: style.axis === 'epoch' ? i : t, train: four(train), val: four(val) });
  }
  return { evals: out, blewUp: blowUp !== null };
}

/** One sweep, drawn again until it supports every skill's task clearly. */
function buildSweep(random: Random, style: GroupStyle, index: number, sweepId: string): Sweep {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const r = random.fork(`sweep ${index} try ${attempt}`);
    const lrStart = r.int(0, LR_LADDER.length - 4);
    const grid = {
      lr: LR_LADDER.slice(lrStart, lrStart + 4),
      warmup: [0, ...r.sample(WARMUP_LADDER.slice(1), 2).sort((a, b) => a - b)],
    };
    const baseline: Knobs = { lr: grid.lr[1]!, warmup: 0 };
    const others = grid.lr
      .flatMap((lr) => grid.warmup.map((warmup) => ({ lr, warmup })))
      .filter((k) => !sameKnobs(k, baseline));
    const ran = [baseline, ...r.sample(others, RAN_CONFIGS - 1)];
    const model = r.pick(style.models);
    const sweepModel: SweepModel = {
      grid,
      floor: MODEL_FLOOR[model]! + 0.1 * (r.next() - 0.5),
      bestLog: Math.log10(grid.lr[0]!) + 0.15 + 0.7 * r.next(),
      curvature: 0.15 + 0.2 * r.next(),
      warmup: -0.01 + 0.06 * r.next(),
      seedEffect: new Map(style.policy.seeds.map((seed) => [seed, normal(r, 0.025)])),
    };
    const runs: Run[] = [];
    for (const knobs of r.shuffle(ran)) {
      const missing =
        !sameKnobs(knobs, baseline) && r.chance(0.12) ? r.pick(style.policy.seeds) : null;
      for (const seed of style.policy.seeds) {
        if (seed === missing) continue;
        const fine = style.fineInterval !== null && r.chance(0.12);
        const interval = fine ? style.fineInterval! : style.interval;
        const evals = (style.evals * style.interval) / interval;
        const killed = r.chance(0.05);
        const drawn = curve(r, style, sweepModel, knobs, seed, interval, evals);
        const logged = killed ? Math.ceil(drawn.evals.length * (0.5 + 0.3 * r.next())) : evals;
        const status = drawn.blewUp
          ? r.pick(r.chance(0.3) ? style.statuses.ok : style.statuses.failed)
          : killed
            ? style.statuses.killed
            : r.pick(style.statuses.ok);
        runs.push({
          run_id: '',
          sweep_id: sweepId,
          knobs,
          seed,
          status,
          evals: drawn.evals.slice(0, logged),
        });
      }
    }
    const sweep: Sweep = {
      sweep_id: sweepId,
      name: `${model} lr x warmup${r.pick(['', '', ' (rerun)', ' v2'])}`,
      model,
      started_on: '',
      grid,
      baseline,
      runs,
    };
    if (supportsEveryTask(sweep, style)) return sweep;
  }
  throw new Error(`${style.id}: no clear sweep ${index} in 500 tries`);
}

/**
 * The comparisons a did_it_help task can ask about: two configs that differ in one knob, the
 * less warmup as the baseline (a learning rate either way), whose verdict no rounding could flip.
 */
export function helpPairs(sweep: Sweep, style: GroupStyle): [Knobs, Knobs][] {
  const configs = configsOf(sweep);
  const pairs: [Knobs, Knobs][] = [];
  for (const a of configs) {
    for (const b of configs) {
      const oneKnob = (a.lr === b.lr) !== (a.warmup === b.warmup);
      const ordered = a.lr !== b.lr || a.warmup < b.warmup;
      if (!oneKnob || !ordered) continue;
      const p = paired(sweep, a, b, style.policy);
      if (p && clearance(p) >= 0.002) pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * Whether a sweep makes a clear task of every skill: a best config ahead of the next by a margin
 * and not the baseline, a clear verdict on it against the baseline, a config to propose next, a
 * run that did not diverge, and a clear comparison of two configs.
 */
function supportsEveryTask(sweep: Sweep, style: GroupStyle): boolean {
  if (configScores(sweep, style.policy).length < 2) return false;
  const best = bestConfig(sweep, style.policy);
  if (best.margin < 0.004 || sameKnobs(best.knobs, sweep.baseline)) return false;
  const report = paired(sweep, sweep.baseline, best.knobs, style.policy);
  if (!report || clearance(report) < 0.002) return false;
  if (candidates(sweep, best.knobs, []).length === 0) return false;
  if (!sweep.runs.some((run) => !diverged(run, style.policy))) return false;
  return helpPairs(sweep, style).length > 0;
}

export function buildGroup(style: GroupStyle, random: Random): Group {
  const ids = random.fork('ids');
  let runNumber = style.ids.run.start;
  let day = addDays(style.today, -7 * SWEEPS - 3);
  const sweeps = Array.from({ length: SWEEPS }, (_, i) => {
    const sweepId = formatId(style.ids.sweep, style.ids.sweep.start + i * 2);
    const sweep = buildSweep(random.fork('sweeps'), style, i, sweepId);
    for (const run of sweep.runs) {
      runNumber += 1 + (ids.chance(0.2) ? ids.int(1, 3) : 0);
      run.run_id = formatId(style.ids.run, runNumber);
    }
    day = addDays(day, ids.int(4, 7));
    sweep.started_on = day;
    return sweep;
  });

  // Earlier proposals: an untried neighbor of the best config, with every seed, for a few sweeps
  // that have more than one, so a new round must not propose it again.
  const extra = random.fork('proposals');
  const withRoom = sweeps.filter(
    (s) => candidates(s, bestConfig(s, style.policy).knobs, []).length > 1,
  );
  const proposed = extra
    .sample(withRoom, Math.min(3, withRoom.length))
    .sort((a, b) => compareText(a.started_on, b.started_on));
  const proposals = proposed.flatMap((sweep) => {
    const knobs = extra.pick(candidates(sweep, bestConfig(sweep, style.policy).knobs, []));
    const on = addDays(sweep.started_on, extra.int(1, 2));
    return style.policy.seeds.map((seed) => ({
      proposal_id: '',
      sweep_id: sweep.sweep_id,
      knobs,
      seed,
      proposed_on: on,
    }));
  });
  proposals.forEach(
    (p, i) => (p.proposal_id = formatId(style.ids.proposal, style.ids.proposal.start + i + 1)),
  );

  // Earlier decisions: a quick look at a few sweeps that kept the baseline for now.
  const decisions: Decision[] = extra
    .sample(sweeps, 3)
    .sort((a, b) => compareText(a.started_on, b.started_on))
    .map((sweep, i) => ({
      decision_id: formatId(style.ids.decision, style.ids.decision.start + i + 1),
      sweep_id: sweep.sweep_id,
      decided_on: addDays(sweep.started_on, 2),
      knobs: sweep.baseline,
      decision: 'keep',
    }));
  return { style, sweeps, proposals, decisions };
}
