import type { FileEdit, MentorView, Probe } from '@architect/shared';
import type { StoredRound } from '../store/records';
import { resultOf } from './attempts';
import { configurationKey } from './configuration';
import { must } from './errors';
import { attemptsMade, evaluate, type EvaluationSpec } from './evaluation';
import type { RunState } from './run-state';
import { devSeeds, roundSeed } from './seeds';
import { probingSpecs } from './training';

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

/** Writes what one probe measured on the round as soon as it is known. */
function recordProbe(state: RunState, index: number, position: number, scores: Partial<Probe>) {
  const current = state.round(index);
  const probes = (current.round.probes ?? []).map((probe) =>
    probe.index === position ? { ...probe, ...scores } : probe,
  );
  state.saveRound({ ...current, round: { ...current.round, probes } });
}

/**
 * The probe step: the incumbent on dev under the round's seeds, each probe on dev under the
 * round's probe seeds, then each probe on the round's train tasks. The dev attempts are one count
 * with the composed change still to come, every attempt counted, so the score neither starts over
 * nor changes its total after a restart. The incumbent's attempts are the ones the round's
 * decision reuses; the probes' seeds are apart from them, so the composed change is decided on
 * draws no probe was scored on. Each probe's score is written on the round as soon as it is
 * measured, so a round cut short keeps it, and the mentor composes once all are in.
 */
export async function probeRound(state: RunState, index: number): Promise<void> {
  state.setPhase('evaluating');
  const stored = state.round(index);
  const runs = state.job.evaluation.devRepeats;
  const config = state.incumbentConfig();
  const { devPanel } = state.record.seeds;
  const specs = await probingSpecs(state, index);
  const incumbent = must(specs[0], "The probe step's incumbent");
  const composed = incumbent.tasks.length * incumbent.seeds.length;
  const total = specs.reduce((sum, spec) => sum + spec.tasks.length * spec.seeds.length, composed);
  const roundSeeds = devSeeds(devPanel, index, runs);
  for (const spec of specs) {
    const before = specs.reduce((sum, item) => sum + attemptsMade(state, item), 0);
    if (!(await evaluate(state, { ...spec, of: { before, total } }))) return;
    const result = state.devResult(spec.version, index, spec.seeds, config);
    state.emit({ type: 'eval.finished', split: 'dev', harnessVersion: spec.version, ...result });
    const probe = built(state.round(index).round.probes ?? []).find(
      (item) => item.version === spec.version,
    );
    if (probe === undefined) continue;
    recordProbe(state, index, probe.index, {
      devBefore: state.devResult(stored.baseVersion, index, roundSeeds, config).score,
      devAfter: result.score,
    });
  }
  for (const probe of built(state.round(index).round.probes ?? [])) {
    if (!(await evaluate(state, await practiceSpec(state, index, probe.version)))) return;
    const practice = state.attempts({
      split: 'train',
      round: index,
      version: probe.version,
      target: state.targetOf(config),
      config: configurationKey(config),
    });
    recordProbe(state, index, probe.index, { train: resultOf(practice, state.job).score });
  }
  const current = state.round(index);
  state.saveRound({ ...current, round: { ...current.round, status: 'composing' } });
  const devBefore = state.devResult(stored.baseVersion, index, roundSeeds, config).score;
  const scores = built(current.round.probes ?? []).map(
    (probe) => `probe ${probe.index} ${probe.devAfter?.pass ?? 0}/${probe.devAfter?.total ?? 0}`,
  );
  state.log(
    'info',
    `Round ${index}: ${scores.join(', ')} on the check tasks, against ${devBefore.pass}/${devBefore.total}; composing one change.`,
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
