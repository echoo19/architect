import type { FileEdit, MentorView, Probe } from '@architect/shared';
import type { StoredRound } from '../store/records';
import { resultOf } from './attempts';
import { configurationKey } from './configuration';
import { attemptsLeft, evaluate, type EvaluationSpec } from './evaluation';
import type { RunState } from './run-state';
import { devSeeds, probeSeeds, roundSeed } from './seeds';
import { devEvaluation } from './training';

/*
 * Propose, probe, compose (decision 108). A round in this mode asks the mentor for several
 * alternative changes to the same failures, measures each one here, and asks the mentor to
 * compose the round's one change from what they did. That change is measured and kept or
 * reverted by the same rule as any other; no probe is ever kept on its own.
 */

/** A probe the runner built, with the version it was saved as. */
type Built = Probe & { version: number };

function built(probes: readonly Probe[]): Built[] {
  return probes.flatMap((probe) =>
    probe.version === undefined ? [] : [{ ...probe, version: probe.version }],
  );
}

/** A probe's practice: the round's train tasks under its train seed, as the incumbent took them. */
async function practiceSpec(
  state: RunState,
  index: number,
  version: number,
): Promise<EvaluationSpec> {
  const config = state.incumbentConfig();
  return {
    tasks: await state.trainBatch(index),
    split: 'train',
    round: index,
    version,
    seeds: [roundSeed(state.record.seeds.trainStudent, index)],
    target: state.targetOf(config),
    purpose: 'training',
    concurrency: state.ctx.concurrency,
    config,
  };
}

/**
 * The probe step: the incumbent on dev under the round's seeds, each probe on dev under the
 * round's probe seeds, then each probe on the round's train tasks. The dev attempts are one count
 * with the composed change still to come, so the score doesn't start over. The incumbent's
 * attempts are the ones the round's decision reuses; the probes' seeds are apart from them, so
 * the composed change is decided on draws no probe was scored on. Each probe's scores are then
 * written on the round, and the mentor composes.
 */
export async function probeRound(state: RunState, index: number): Promise<void> {
  state.setPhase('evaluating');
  const stored = state.round(index);
  const probes = stored.round.probes ?? [];
  const runs = state.job.evaluation.devRepeats;
  const config = state.incumbentConfig();
  const { devPanel } = state.record.seeds;
  const own = probeSeeds(devPanel, index, runs);
  const incumbent = await devEvaluation(state, stored.baseVersion, index, runs, config);
  const specs = [incumbent];
  for (const probe of built(probes)) {
    specs.push(await devEvaluation(state, probe.version, index, runs, config, own));
  }
  const left = specs.map((spec) => attemptsLeft(state, spec));
  const composed = incumbent.tasks.length * incumbent.seeds.length;
  const total = left.reduce((sum, count) => sum + count, 0) + composed;
  let before = 0;
  for (const [i, spec] of specs.entries()) {
    if (!(await evaluate(state, { ...spec, of: { before, total } }))) return;
    before += left[i]!;
    const result = state.devResult(spec.version, index, spec.seeds, config);
    state.emit({ type: 'eval.finished', split: 'dev', harnessVersion: spec.version, ...result });
  }
  for (const probe of built(probes)) {
    if (!(await evaluate(state, await practiceSpec(state, index, probe.version)))) return;
  }
  const devBefore = state.devResult(
    stored.baseVersion,
    index,
    devSeeds(devPanel, index, runs),
    config,
  ).score;
  const measured = probes.map((probe): Probe => {
    if (probe.version === undefined) return probe;
    const practice = state.attempts({
      split: 'train',
      round: index,
      version: probe.version,
      target: state.targetOf(config),
      config: configurationKey(config),
    });
    return {
      ...probe,
      devBefore,
      devAfter: state.devResult(probe.version, index, own, config).score,
      train: resultOf(practice, state.job).score,
    };
  });
  const current = state.round(index);
  state.saveRound({
    ...current,
    round: { ...current.round, status: 'composing', probes: measured },
  });
  state.log(
    'info',
    `Round ${index}: ${built(measured)
      .map(
        (probe) =>
          `probe ${probe.index} ${probe.devAfter?.pass ?? 0}/${probe.devAfter?.total ?? 0}`,
      )
      .join(
        ', ',
      )} on the check tasks, against ${devBefore.pass}/${devBefore.total}; composing one change.`,
  );
}

/** A built probe's change set, as the difference between its version and the incumbent's. */
async function probeEdits(state: RunState, base: number, version: number): Promise<FileEdit[]> {
  const { harness } = state.ctx.deps;
  const from = await state.resources.harness(base);
  const to = await state.resources.harness(version);
  const files = harness.harnessToFiles(to);
  return harness
    .diffHarness(from, to)
    .map((diff) =>
      diff.status === 'deleted'
        ? { op: 'delete' as const, path: diff.path }
        : { op: 'write' as const, path: diff.path, content: files[diff.path] ?? '' },
    );
}

/**
 * What the mentor composes from (decision 108): each probe's change set and either why the runner
 * refused it, or its overall dev score beside the incumbent's and the checker's verdict on each
 * of the round's train tasks. Nothing else about dev, and nothing about the test split.
 */
export async function probeEvidence(
  state: RunState,
  stored: StoredRound,
): Promise<NonNullable<MentorView['probes']>> {
  const index = stored.round.index;
  const config = state.incumbentConfig();
  const probes = stored.round.probes ?? [];
  const devBefore = probes.find((probe) => probe.devBefore !== undefined)?.devBefore ?? {
    pass: 0,
    total: 0,
  };
  const items: NonNullable<MentorView['probes']>['items'] = [];
  for (const probe of probes) {
    const head = {
      index: probe.index,
      title: probe.title,
      diagnosis: probe.diagnosis,
      predicted: probe.predicted,
    };
    if (probe.version === undefined) {
      items.push({ ...head, edits: [], refused: probe.refused ?? 'The runner refused it.' });
      continue;
    }
    const practice = state.attempts({
      split: 'train',
      round: index,
      version: probe.version,
      target: state.targetOf(config),
      config: configurationKey(config),
    });
    items.push({
      ...head,
      edits: await probeEdits(state, stored.baseVersion, probe.version),
      ...(probe.devAfter === undefined ? {} : { devAfter: probe.devAfter }),
      train: practice.map((attempt) => ({
        taskId: attempt.taskId,
        pass: attempt.check.pass,
        reason: attempt.check.reason,
      })),
    });
  }
  return { devBefore, items };
}
