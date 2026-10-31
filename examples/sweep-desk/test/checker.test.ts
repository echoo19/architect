import vm from 'node:vm';
import type { CheckResult, JsonValue, Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { buildJobFiles } from '../src';
import type { Group } from '../src/group/build';
import {
  bestConfig,
  candidates,
  configsOf,
  diverged,
  earlyStop,
  paired,
  runScore,
  sameKnobs,
} from '../src/group/rules';
import type { Knobs, Sweep } from '../src/group/rules';
import type { PolicyNumbers } from '../src/group/style';
import type { CsvRow } from '../src/lib/csv';
import { solveTask } from './attempts';
import type { HelpRequest, RunRequest, SweepRequest } from '../src/tasks/build';
import { job, paramsOf } from './helpers';

/**
 * The checker passes the ground truth and any other choice the policy allows, and fails the
 * common mistakes with a reason that starts with what is wrong.
 */

const groups = new Map(buildJobFiles().groups.map((g) => [g.organization.id, g.group]));
const groupOf = (task: Task): Group => groups.get(task.org!)!;
const sweepOf = (task: Task): Sweep => {
  const { sweep_id } = task.meta!.request as unknown as SweepRequest;
  return groupOf(task).sweeps.find((s) => s.sweep_id === sweep_id)!;
};

const asked = (task: Task, answer: JsonValue, appended: Record<string, CsvRow[]> = {}) =>
  job.check(task, job.withAppended(task, appended, answer));

function failsWith(result: CheckResult, start: string) {
  expect(result.pass, result.reason).toBe(false);
  expect(result.reason.startsWith(start), result.reason).toBe(true);
}

/** The reference's answer and the rows it appended. */
function reference(task: Task) {
  const { tools, answer } = solveTask(task);
  return {
    answer: answer as Record<string, JsonValue>,
    proposals: [...tools.appendedTo('proposed_runs.csv')],
    decisions: [...tools.appendedTo('decisions.csv')],
  };
}

/** The tasks of a skill whose answer a mistaken rule changes, with that mistaken answer. */
function mistaken<T>(skill: string, wrong: (task: Task) => T | null): [Task, T][] {
  const found = job
    .tasksOfType(skill)
    .map((task) => [task, wrong(task)] as [Task, T | null])
    .filter((pair): pair is [Task, T] => pair[1] !== null);
  // A mistake no task catches would test nothing.
  expect(found.length, skill).toBeGreaterThan(2);
  return found;
}

const withPolicy = (task: Task, change: Partial<PolicyNumbers>): PolicyNumbers => ({
  ...groupOf(task).style.policy,
  ...change,
});

describe('the checker sandbox', () => {
  it('has no clock and no randomness, and defines the six validators', () => {
    const sandbox = job.checkerSandbox();
    expect(vm.runInContext('typeof Date', sandbox)).toBe('undefined');
    expect(vm.runInContext('typeof Math.random', sandbox)).toBe('undefined');
    expect(vm.runInContext('Object.keys(validators).sort().join()', sandbox)).toBe(
      'best_config,did_it_help,diverged_runs,early_stop,runs_proposed,sweep_report',
    );
  });
});

describe('best_config', () => {
  const tasks = job.tasksOfType('best_config');
  const truth = (task: Task) => {
    const p = paramsOf(task);
    return { lr: p.lr!, warmup: p.warmup!, score: p.score! };
  };

  it('passes the right config, its score to three decimals, and a learning rate written any way', () => {
    for (const task of tasks) {
      const t = truth(task);
      expect(asked(task, t), task.id).toMatchObject({ pass: true });
      const rounded = Math.round((t.score as number) * 1000) / 1000;
      const lr = (t.lr as number).toExponential();
      expect(asked(task, { ...t, lr, score: rounded }), task.id).toMatchObject({ pass: true });
    }
  });

  it('fails a score off by more than the rounding, and an answer with a row written', () => {
    for (const task of tasks) {
      const t = truth(task);
      failsWith(asked(task, { ...t, score: (t.score as number) + 0.003 }), 'score is');
      failsWith(asked(task, null), 'The reply has no ANSWER');
      const row: CsvRow = { decision_id: 'X', sweep_id: 'X', decided_on: 'X', decision: 'keep' };
      failsWith(asked(task, t, { 'decisions.csv': [row] }), 'decisions.csv changed');
    }
  });

  it('fails the best config by another rule: the other score, or diverged seeds kept in', () => {
    const otherScore = (task: Task) => {
      const policy = groupOf(task).style.policy;
      const score: PolicyNumbers['score'] =
        policy.score.kind === 'min' ? { kind: 'last', k: 3 } : { kind: 'min' };
      return withPolicy(task, { score });
    };
    const otherSeeds = (task: Task) =>
      withPolicy(task, {
        divergedSeeds: groupOf(task).style.policy.divergedSeeds === 'drop' ? 'exclude' : 'drop',
      });
    for (const rule of [otherScore, otherSeeds]) {
      const cases = mistaken('best_config', (task) => {
        const best = bestConfig(sweepOf(task), rule(task));
        return sameKnobs(best.knobs, truth(task) as unknown as Knobs) ? null : best;
      });
      for (const [task, best] of cases) {
        const result = asked(task, { ...best.knobs, score: best.score });
        expect(result.pass, task.id).toBe(false);
        expect(/^(lr|warmup) is/.test(result.reason), result.reason).toBe(true);
      }
    }
  });
});

describe('early_stop', () => {
  const runOf = (task: Task) => {
    const { run_id } = task.meta!.request as unknown as RunRequest;
    return sweepOf(task).runs.find((run) => run.run_id === run_id)!;
  };

  it('passes the stop and the best eval', () => {
    for (const task of job.tasksOfType('early_stop')) {
      const p = paramsOf(task);
      expect(asked(task, { stop_at: p.stop_at!, best_at: p.best_at! }), task.id).toMatchObject({
        pass: true,
      });
    }
  });

  it('fails a patience off by one, the best eval given as the stop, and a wrong best', () => {
    const offByOne = mistaken('early_stop', (task) => {
      const policy = groupOf(task).style.policy;
      const stop = earlyStop(runOf(task), { ...policy, patience: policy.patience + 1 });
      return stop.stop_at === paramsOf(task).stop_at ? null : stop;
    });
    for (const [task, stop] of offByOne) failsWith(asked(task, { ...stop }), 'stop_at is');
    for (const task of job.tasksOfType('early_stop')) {
      const p = paramsOf(task);
      if (p.stop_at !== p.best_at)
        failsWith(asked(task, { stop_at: p.best_at!, best_at: p.best_at! }), 'stop_at is');
      failsWith(asked(task, { stop_at: p.stop_at!, best_at: -1 }), 'best_at is');
    }
  });
});

describe('diverged_runs', () => {
  const tasks = job.tasksOfType('diverged');
  const truth = (task: Task) => paramsOf(task).runs as string[];

  it('passes the runs in any order, and an empty list when none diverged', () => {
    for (const task of tasks) {
      expect(asked(task, { runs: [...truth(task)].reverse() }), task.id).toMatchObject({
        pass: true,
      });
    }
    expect(tasks.some((task) => truth(task).length === 0)).toBe(true);
  });

  it("fails the scheduler's word for it, and NaN alone without the factor", () => {
    const byStatus = mistaken('diverged', (task) => {
      const failed = groupOf(task).style.statuses.failed;
      const runs = sweepOf(task)
        .runs.filter((run) => failed.includes(run.status))
        .map((r) => r.run_id);
      return runs.join() === truth(task).join() ? null : runs;
    });
    for (const [task, runs] of byStatus) {
      expect(asked(task, { runs }).pass, task.id).toBe(false);
      expect(/^runs (leaves out|lists)/.test(asked(task, { runs }).reason)).toBe(true);
    }
    const nanOnly = mistaken('diverged', (task) => {
      const runs = sweepOf(task)
        .runs.filter((run) => run.evals.some((e) => !Number.isFinite(e.train)))
        .map((r) => r.run_id);
      return runs.join() === truth(task).join() ? null : runs;
    });
    for (const [task, runs] of nanOnly) failsWith(asked(task, { runs }), 'runs leaves out');
  });

  it('fails a list with a run left out, or one extra', () => {
    for (const task of tasks) {
      const runs = truth(task);
      if (runs.length > 0) failsWith(asked(task, { runs: runs.slice(1) }), 'runs leaves out');
      const fine = sweepOf(task).runs.find((run) => !runs.includes(run.run_id))!;
      failsWith(asked(task, { runs: [...runs, fine.run_id] }), 'runs lists');
    }
  });
});

describe('did_it_help', () => {
  const truth = (task: Task) => {
    const p = paramsOf(task);
    return { n: p.n!, mean_diff: p.mean_diff!, low: p.low!, high: p.high!, verdict: p.verdict! };
  };

  it('passes the comparison, with numbers rounded to three decimals', () => {
    for (const task of job.tasksOfType('did_it_help')) {
      const t = truth(task);
      const r3 = (x: JsonValue) => Math.round((x as number) * 1000) / 1000;
      const rounded = { ...t, mean_diff: r3(t.mean_diff), low: r3(t.low), high: r3(t.high) };
      expect(asked(task, rounded), task.id).toMatchObject({ pass: true });
    }
  });

  it('fails the difference the wrong way round, an unpaired interval, and the wrong verdict', () => {
    for (const task of job.tasksOfType('did_it_help')) {
      const t = truth(task) as Record<string, number | string>;
      const flipped = {
        ...t,
        mean_diff: -t.mean_diff!,
        low: -t.high!,
        high: -t.low!,
        verdict: t.verdict === 'helped' ? 'hurt' : t.verdict === 'hurt' ? 'helped' : 'unclear',
      };
      if (t.mean_diff !== 0) failsWith(asked(task, flipped), 'mean_diff is');
      const other = t.verdict === 'unclear' ? 'helped' : 'unclear';
      failsWith(asked(task, { ...t, verdict: other }), 'verdict is');
    }
    // Unpaired: each config's mean over its own seeds, the interval from both spreads.
    const unpaired = mistaken('did_it_help', (task) => {
      const { baseline, change } = task.meta!.request as unknown as HelpRequest;
      const sweep = sweepOf(task);
      const policy = groupOf(task).style.policy;
      const scores = (k: Knobs) =>
        sweep.runs
          .filter((run) => sameKnobs(run.knobs, k) && !diverged(run, policy))
          .map((run) => runScore(run, policy));
      const a = scores(baseline);
      const b = scores(change);
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
      const v = (xs: number[]) =>
        xs.reduce((s, x) => s + (x - mean(xs)) ** 2, 0) / (xs.length - 1) / xs.length;
      const m = mean(a) - mean(b);
      const half = 2 * Math.sqrt(v(a) + v(b));
      const low = m - half;
      return Math.abs(low - (paramsOf(task).low as number)) > 0.002
        ? { ...truth(task), mean_diff: m, low, high: m + half }
        : null;
    });
    for (const [task, answer] of unpaired) {
      expect(/^(mean_diff|low|high) is/.test(asked(task, answer).reason), task.id).toBe(true);
    }
    expect(job.tasksOfType('did_it_help').map((t) => paramsOf(t).verdict)).toEqual(
      expect.arrayContaining(['helped', 'hurt', 'unclear']),
    );
  });

  it('agrees with the rules on whether a comparison pairs every seed', () => {
    for (const task of job.tasksOfType('did_it_help')) {
      const { baseline, change } = task.meta!.request as unknown as HelpRequest;
      const p = paired(sweepOf(task), baseline, change, groupOf(task).style.policy)!;
      expect(p.n, task.id).toBe(paramsOf(task).n);
    }
  });
});

describe('runs_proposed', () => {
  const tasks = job.tasksOfType('next_runs');
  const seedsOf = (task: Task) => paramsOf(task).seeds as number[];

  /** Proposal rows for configs, every seed each, numbered and dated as the task expects. */
  function rowsFor(task: Task, configs: Knobs[], change: CsvRow = {}): CsvRow[] {
    const p = paramsOf(task);
    const fields = p.fields as { lr: string; warmup: string };
    const ids = [...(p.proposal_ids as string[])];
    return configs.flatMap((k) =>
      seedsOf(task).map((seed) => ({
        proposal_id: ids.shift() ?? 'P-999',
        sweep_id: p.sweep_id as string,
        [fields.lr]: String(k.lr),
        [fields.warmup]: String(k.warmup),
        seed: String(seed),
        proposed_on: p.proposed_on as string,
        ...change,
      })),
    );
  }

  const open = (task: Task) => {
    const p = paramsOf(task);
    return candidates(sweepOf(task), p.best as unknown as Knobs, p.proposed as unknown as Knobs[]);
  };
  const count = (task: Task) => paramsOf(task).configs as number;
  const proposedAs = (task: Task, rows: CsvRow[]) =>
    asked(task, { proposed: rows.length }, { 'proposed_runs.csv': rows });

  it("passes the reference's round and any other choice of the configs that qualify", () => {
    for (const task of tasks) {
      const ref = reference(task);
      expect(proposedAs(task, ref.proposals), task.id).toMatchObject({ pass: true });
      const other = rowsFor(task, open(task).reverse().slice(0, count(task)));
      expect(proposedAs(task, other), task.id).toMatchObject({ pass: true });
    }
    // Some rounds are held back by the budget, others by the configs that qualify.
    expect(tasks.some((t) => open(t).length > count(t))).toBe(true);
    expect(tasks.some((t) => open(t).length === count(t))).toBe(true);
  });

  it('fails a round over the budget, short of it, or with a seed missing', () => {
    for (const task of tasks) {
      const configs = open(task).slice(0, count(task));
      const rows = rowsFor(task, configs);
      failsWith(
        proposedAs(task, [...rows, { ...rows[0]!, proposal_id: 'P-998' }]),
        'proposed_runs.csv gained',
      );
      failsWith(proposedAs(task, rows.slice(1)), 'proposed_runs.csv gained');
      failsWith(
        asked(task, { proposed: rows.length + 1 }, { 'proposed_runs.csv': rows }),
        'proposed in the ANSWER',
      );
    }
  });

  it('fails a config already run, already proposed, off the grid or not next to the best', () => {
    for (const task of tasks) {
      const p = paramsOf(task);
      const sweep = sweepOf(task);
      const configs = open(task).slice(0, count(task));
      const swap = (k: Knobs) => rowsFor(task, [k, ...configs.slice(1)]);
      const ran = configsOf(sweep).find((k) => !sameKnobs(k, configs[0]!))!;
      failsWith(proposedAs(task, swap(ran)), `${ran.lr}/${ran.warmup} was already run`);
      const earlier = p.proposed as unknown as Knobs[];
      if (earlier.length > 0)
        failsWith(
          proposedAs(task, swap(earlier[0]!)),
          `${earlier[0]!.lr}/${earlier[0]!.warmup} was already proposed`,
        );
      const fields = p.fields as { lr: string };
      failsWith(
        proposedAs(task, swap({ lr: 0.0005, warmup: configs[0]!.warmup })),
        `${fields.lr} "0.0005" is not on the sweep's grid`,
      );
      const far = sweep.grid.lr
        .flatMap((lr) => sweep.grid.warmup.map((warmup) => ({ lr, warmup })))
        .find(
          (k) =>
            !configsOf(sweep).some((r) => sameKnobs(r, k)) &&
            !earlier.some((e) => sameKnobs(e, k)) &&
            !candidates(sweep, p.best as unknown as Knobs, []).some((c) => sameKnobs(c, k)),
        );
      if (far)
        failsWith(proposedAs(task, swap(far)), `${far.lr}/${far.warmup} is not one grid step`);
    }
  });

  it('fails the wrong date, ids not numbered on, and a decision written too', () => {
    for (const task of tasks) {
      const rows = rowsFor(task, open(task).slice(0, count(task)));
      failsWith(
        proposedAs(
          task,
          rowsFor(task, open(task).slice(0, count(task)), { proposed_on: '2026-11-20' }),
        ),
        'proposed_on is',
      );
      failsWith(
        proposedAs(
          task,
          rows.map((r, i) => ({ ...r, proposal_id: `P-9${i}` })),
        ),
        'proposal_id:',
      );
      const decision: CsvRow = {
        decision_id: 'X',
        sweep_id: 'X',
        decided_on: 'X',
        decision: 'keep',
      };
      failsWith(
        asked(
          task,
          { proposed: rows.length },
          { 'proposed_runs.csv': rows, 'decisions.csv': [decision] },
        ),
        'decisions.csv changed',
      );
    }
  });
});

describe('sweep_report', () => {
  const tasks = job.tasksOfType('sweep_report');
  const reported = (task: Task, answer: JsonValue, decisions: CsvRow[]) =>
    asked(task, answer, { 'decisions.csv': decisions });

  it("passes the reference's report and its decision row", () => {
    for (const task of tasks) {
      const ref = reference(task);
      expect(reported(task, ref.answer, ref.decisions), task.id).toMatchObject({ pass: true });
    }
    expect(new Set(tasks.map((t) => paramsOf(t).decision))).toEqual(new Set(['adopt', 'keep']));
  });

  it('fails a report without its decision row, with the other decision, or with a run left out', () => {
    for (const task of tasks) {
      const ref = reference(task);
      failsWith(reported(task, ref.answer, []), 'decisions.csv gained 0 rows');
      const other = ref.answer.decision === 'adopt' ? 'keep' : 'adopt';
      failsWith(reported(task, { ...ref.answer, decision: other }, ref.decisions), 'decision is');
      failsWith(
        reported(task, ref.answer, [{ ...ref.decisions[0]!, decision: other }]),
        'decision is',
      );
      const blewUp = ref.answer.diverged as string[];
      if (blewUp.length > 0) {
        failsWith(
          reported(task, { ...ref.answer, diverged: blewUp.slice(1) }, ref.decisions),
          'diverged leaves out',
        );
      }
      const p = paramsOf(task);
      const fields = p.fields as { lr: string };
      failsWith(
        reported(task, ref.answer, [{ ...ref.decisions[0]!, [fields.lr]: '0.5' }]),
        `${fields.lr} is`,
      );
      failsWith(
        reported(task, ref.answer, [ref.decisions[0]!, ref.decisions[0]!]),
        'decisions.csv gained 2 rows',
      );
      failsWith(
        asked(task, ref.answer, {
          'decisions.csv': ref.decisions,
          'proposed_runs.csv': [{ proposal_id: 'X' }],
        }),
        'proposed_runs.csv changed',
      );
    }
  });
});
