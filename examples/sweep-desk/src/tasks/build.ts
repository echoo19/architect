import type { JsonValue, Task } from '@architect/shared';
import type { Group } from '../group/build';
import { formatId, helpPairs } from '../group/build';
import { lrForm } from '../group/files';
import {
  bestConfig,
  candidates,
  configsOf,
  diverged,
  earlyStop,
  paired,
  proposalConfigs,
  round,
  sameKnobs,
} from '../group/rules';
import type { Knobs, Paired, Sweep } from '../group/rules';
import { longDate } from '../lib/calendar';
import type { Random } from '../lib/random';

/**
 * The six kinds of request Sweep desk answers for a research group, one of each per sweep,
 * written the way a researcher asks. Expected values come from the group's rules applied to its
 * true records (src/group/rules.ts).
 */

export const SKILLS = [
  'best_config',
  'early_stop',
  'diverged',
  'did_it_help',
  'next_runs',
  'sweep_report',
] as const;
export type Skill = (typeof SKILLS)[number];

/** What a request asks, kept in the task's meta for the reference solutions and for people. */
export interface SweepRequest {
  sweep_id: string;
  today: string;
}
export interface RunRequest extends SweepRequest {
  run_id: string;
}
export interface HelpRequest extends SweepRequest {
  baseline: Knobs;
  change: Knobs;
}

const lrText = (lr: number) => lrForm(lr, 'short');

const pairedParams = (p: Paired) => ({
  n: p.n,
  mean_diff: round(p.mean_diff),
  low: round(p.low),
  high: round(p.high),
  verdict: p.verdict,
});

const PAIRED_ANSWER =
  '"n": <pairs>, "mean_diff": <mean difference>, "low": <interval low>, "high": <interval high>, "verdict": "helped" | "hurt" | "unclear"';

export function buildTasks(random: Random, group: Group): Task[] {
  const { style } = group;
  const policy = style.policy;
  const today = style.today;
  const unit = style.axis;
  const opening = `It's ${longDate(today)}.`;
  const tasks: Task[] = [];
  const counts = new Map<Skill, number>();

  const add = (
    skill: Skill,
    sweep: Sweep,
    prompt: string,
    expected: Task['expected'],
    meta: Record<string, JsonValue>,
  ) => {
    const n = (counts.get(skill) ?? 0) + 1;
    counts.set(skill, n);
    tasks.push({
      id: `${style.id}-${skill}-${String(n).padStart(2, '0')}`,
      type: skill,
      family: `${style.id}:${sweep.sweep_id}`,
      org: style.id,
      prompt: `${opening} ${prompt}`,
      expected,
      meta,
    });
  };

  for (const [index, sweep] of group.sweeps.entries()) {
    const r = random.fork(`sweep ${index}`);
    const person = style.people[index % style.people.length]!;
    const ref = r.chance(0.5)
      ? `sweep ${sweep.sweep_id} (${sweep.name})`
      : `the ${sweep.name} sweep, ${sweep.sweep_id}`;
    const request: SweepRequest = { sweep_id: sweep.sweep_id, today };
    const best = bestConfig(sweep, policy);
    const bestParams = { lr: best.knobs.lr, warmup: best.knobs.warmup, score: round(best.score) };
    const blewUp = sweep.runs.filter((run) => diverged(run, policy)).map((run) => run.run_id);

    add(
      'best_config',
      sweep,
      `${r.pick([
        `${person} here. Which config won ${ref}? Go by our rule for the best config.`,
        `What's the best config in ${ref}, by our policy?`,
      ])}\nEnd with: ANSWER: {"lr": <learning rate>, "warmup": <warmup steps>, "score": <the config's score>}`,
      { kind: 'end_state', validator: 'best_config', params: bestParams },
      {
        request: { ...request },
        summary: `lr ${lrText(best.knobs.lr)}, warmup ${best.knobs.warmup}`,
      },
    );

    // Mostly a run the rule stops early, sometimes one it lets run to its end.
    const kept = sweep.runs.filter((run) => !diverged(run, policy));
    const stops = kept.filter((run) => earlyStop(run, policy).stop_at !== run.evals.at(-1)!.at);
    const run = r.pick(stops.length > 0 && r.chance(0.75) ? stops : kept);
    const stop = earlyStop(run, policy);
    add(
      'early_stop',
      sweep,
      `${r.pick([
        `If our early-stopping rule had been on, at which ${unit} would run ${run.run_id} have stopped, and which eval was its best?`,
        `${person} here. Where would our early-stopping rule have stopped ${run.run_id}? I also need the ${unit} of its best eval.`,
      ])}\nEnd with: ANSWER: {"stop_at": <${unit}>, "best_at": <${unit}>}`,
      { kind: 'end_state', validator: 'early_stop', params: { ...stop, unit } },
      {
        request: { ...request, run_id: run.run_id },
        summary: `stops at ${stop.stop_at} of ${run.evals.at(-1)!.at}`,
      },
    );

    add(
      'diverged',
      sweep,
      `${r.pick([
        `Which runs in ${ref} diverged by our definition?`,
        `Before I write this up: did anything in ${ref} blow up? List the runs that count as diverged under our policy.`,
      ])}\nEnd with: ANSWER: {"runs": ["<run_id>", ...]} (an empty list if none did)`,
      { kind: 'end_state', validator: 'diverged_runs', params: { runs: blewUp } },
      { request: { ...request }, summary: blewUp.length === 0 ? 'none' : blewUp.join(', ') },
    );

    // More often a comparison with a clear answer than an unclear one.
    const pairs = helpPairs(sweep, style);
    const clear = pairs.filter(([a, b]) => paired(sweep, a, b, policy)!.verdict !== 'unclear');
    const [baseline, change] = r.pick(clear.length > 0 && r.chance(0.6) ? clear : pairs);
    const help = paired(sweep, baseline, change, policy)!;
    const question =
      baseline.lr === change.lr
        ? baseline.warmup === 0
          ? `Did adding warmup help on the ${sweep.model} runs? In ${ref}, compare lr ${lrText(baseline.lr)} with no warmup against ${change.warmup} warmup steps.`
          : `Did going from ${baseline.warmup} to ${change.warmup} warmup steps help at lr ${lrText(baseline.lr)} in ${ref}?`
        : `Did ${change.lr > baseline.lr ? 'raising' : 'lowering'} the learning rate from ${lrText(baseline.lr)} to ${lrText(change.lr)} help on the ${sweep.model} runs in ${ref}, ${baseline.warmup === 0 ? 'without warmup' : `with ${baseline.warmup} warmup steps`}?`;
    add(
      'did_it_help',
      sweep,
      `${question} Pair them by seed, the way our policy says.\nEnd with: ANSWER: {${PAIRED_ANSWER}}`,
      { kind: 'end_state', validator: 'did_it_help', params: pairedParams(help) },
      {
        request: { ...request, baseline, change } as unknown as JsonValue,
        summary: `${help.verdict}, n ${help.n}`,
      },
    );

    const earlier = group.proposals
      .filter((p) => p.sweep_id === sweep.sweep_id)
      .map((p) => p.knobs)
      .filter((k, i, all) => all.findIndex((o) => sameKnobs(o, k)) === i);
    const open = candidates(sweep, best.knobs, earlier);
    const configs = proposalConfigs(policy, open.length);
    const lastProposal = group.proposals.length + style.ids.proposal.start;
    add(
      'next_runs',
      sweep,
      `${r.pick([
        `Plan the next round for ${ref}: add the proposed runs to proposed_runs.csv, by our policy.`,
        `${person} here. We have budget for another round on ${ref}. Put the runs our policy calls for into proposed_runs.csv.`,
      ])}\nEnd with: ANSWER: {"proposed": <rows added>}`,
      {
        kind: 'end_state',
        validator: 'runs_proposed',
        params: {
          sweep_id: sweep.sweep_id,
          fields: style.fields,
          seeds: [...policy.seeds],
          grid: sweep.grid,
          best: best.knobs as unknown as JsonValue,
          ran: configsOf(sweep) as unknown as JsonValue,
          proposed: earlier as unknown as JsonValue,
          configs,
          proposal_ids: Array.from({ length: configs * policy.seeds.length }, (_, i) =>
            formatId(style.ids.proposal, lastProposal + i + 1),
          ),
          proposed_on: today,
        },
      },
      {
        request: { ...request },
        summary: `${configs} configs of ${open.length} that qualify`,
      },
    );

    const report = paired(sweep, sweep.baseline, best.knobs, policy)!;
    const decision = report.verdict === 'helped' ? 'adopt' : 'keep';
    add(
      'sweep_report',
      sweep,
      `${r.pick([
        `Write up ${ref} for the group meeting: the best config and its score, which runs diverged, and whether the best config beat the baseline. Log the decision in decisions.csv.`,
        `${person} here. Can you do the report on ${ref}? Best config, the diverged runs, best against the baseline, and the decision in our log.`,
      ])}\nEnd with: ANSWER: {"lr": <learning rate>, "warmup": <warmup steps>, "score": <the best config's score>, "diverged": ["<run_id>", ...], ${PAIRED_ANSWER}, "decision": "adopt" | "keep"}`,
      {
        kind: 'end_state',
        validator: 'sweep_report',
        params: {
          ...bestParams,
          diverged: blewUp,
          ...pairedParams(report),
          decision,
          decision_id: formatId(
            style.ids.decision,
            style.ids.decision.start + group.decisions.length + 1,
          ),
          sweep_id: sweep.sweep_id,
          decided_on: today,
          fields: style.fields,
        },
      },
      { request: { ...request }, summary: `${decision}: ${report.verdict} against the baseline` },
    );
  }
  return tasks;
}
