import { newId, type Harness, type ReportCard, type Run } from '@architect/shared';
import { buildGraduateManifest } from '../report/manifest';
import { computeReportCard } from '../report/report-card';
import type { GraduateFreeze } from '../store/records';
import { resultOf } from './attempts';
import { must } from './errors';
import { evaluate } from './evaluation';
import type { RunState } from './run-state';
import { studentEndpoint } from './setup';

/** Who wrote the run's hypotheses, as the report card names them. */
function authorIdentity(state: RunState): ReportCard['mentor'] {
  const { job } = state;
  switch (state.run.method) {
    case 'bare':
      return { label: 'No mentor', model: '' };
    case 'self_reflection':
      return {
        label: `${job.student.label} (self-reflection)`,
        model: studentEndpoint(job, job.student.trainOn).model,
      };
    default:
      return {
        label: job.mentor.label,
        model: job.mentor.kind === 'model' ? job.mentor.model : job.mentor.agent,
      };
  }
}

/** Fixes what will ship before any test runs: the harness version, its hash and the student. */
export async function freeze(state: RunState): Promise<void> {
  await state.resources.releaseMentor();
  const harness = await state.resources.harness(state.run.currentVersion);
  const pin = await (await state.resources.student('local')).describe();
  const frozen: GraduateFreeze = {
    graduateId: newId('grd'),
    harnessVersion: harness.meta.version,
    harnessHash: harness.meta.hash,
    student: {
      model: pin.model || state.job.student.local.model,
      quantization: pin.quantization,
      digest: pin.digest,
      sizeBytes: pin.sizeBytes,
      contextLength: pin.contextLength,
    },
    frozenAt: state.now(),
  };
  state.saveRun({}, { freeze: frozen });
  state.log(
    'info',
    `Graduate frozen at harness version ${frozen.harnessVersion} before its locked test.`,
  );
}

/** Writes the report card and the graduate folder, and finishes the run. */
async function graduate(state: RunState, harness: Harness, frozen: GraduateFreeze): Promise<void> {
  const { paths, store, deps, runId } = state.ctx;
  const { job } = state;
  const target = state.record.lockedTestOn;
  const attempts = state.attempts({
    split: 'test',
    round: null,
    version: frozen.harnessVersion,
    target,
  });
  state.emit({
    type: 'eval.finished',
    split: 'test',
    harnessVersion: frozen.harnessVersion,
    ...resultOf(attempts, job),
  });
  const tester = await state.resources.student(target);
  const lineage = await state.lineage.read();
  const rounds = state.rounds();
  const createdAt = state.now();
  const run: Run = {
    ...state.run,
    totals: { ...state.run.totals, wallMs: Math.round(state.budget.wallMs()) },
  };
  const report = computeReportCard({
    job,
    run,
    rounds: rounds.map(({ round }) => round),
    lineage,
    test: attempts.map((attempt) => ({
      taskType: attempt.taskType,
      pass: attempt.check.pass,
      latencyMs: attempt.latencyMs,
      refused: attempt.stopReason === 'refused',
    })),
    guardrails: harness.guardrails,
    student: {
      label: job.student.label,
      model: tester.model,
      runtime: studentEndpoint(job, target).runtime,
      ...(frozen.student.quantization === undefined
        ? {}
        : { quantization: frozen.student.quantization }),
      ...(frozen.student.sizeBytes === undefined ? {} : { sizeBytes: frozen.student.sizeBytes }),
    },
    mentor: authorIdentity(state),
    readyClaimed: rounds.some(({ hypothesis }) => hypothesis?.readyClaim === true),
    ranOffline: target === 'local' && tester.isLocal,
    createdAt,
  });
  const manifest = buildGraduateManifest({
    freeze: frozen,
    job,
    run,
    report,
    endpoint: job.student.local,
    createdAt,
  });
  const dir = paths.graduateDir(frozen.graduateId);
  await deps.harness.writeGraduate(dir, { harness, manifest, report, lineage });

  const finished = store.transaction(() => {
    store.reports.put(runId, report);
    const existing = store.graduates.get(frozen.graduateId);
    const record = {
      id: frozen.graduateId,
      runId,
      name: job.name,
      path: paths.toStored(dir),
      manifest,
      settings: existing?.settings ?? null,
      createdAt,
    };
    if (existing) store.graduates.update(record);
    else store.graduates.insert(record);
    return state.writeRun({
      status: 'finished',
      phase: 'done',
      endedAt: createdAt,
      graduateId: frozen.graduateId,
    });
  });
  state.emit({ type: 'run.updated', run: finished });
  state.emit({ type: 'graduate.ready', graduateId: frozen.graduateId });
}

/**
 * The frozen graduate's one locked test, on the target the run chose, with the mentor
 * released first. A pause parks it like any other evaluation; it is never stopped.
 */
export async function lockedTest(state: RunState): Promise<void> {
  const frozen = must(state.record.freeze, 'The frozen graduate');
  const proof = await state.resources.releaseMentor();
  const tests = await state.ctx.deps.vault.openForLockedTest(state.run.jobId, proof);
  const harness = await state.resources.harness(frozen.harnessVersion);
  if (harness.meta.hash !== frozen.harnessHash) {
    throw new Error(
      `Harness version ${frozen.harnessVersion} changed after the graduate was frozen, so it won't be tested.`,
    );
  }
  const complete = await evaluate(state, {
    tasks: tests,
    split: 'test',
    round: null,
    version: frozen.harnessVersion,
    seed: state.record.seeds.test,
    target: state.record.lockedTestOn,
    training: false,
    concurrency: 1,
  });
  if (complete) await graduate(state, harness, frozen);
}
