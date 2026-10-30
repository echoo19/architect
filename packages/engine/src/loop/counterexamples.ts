import {
  newId,
  predicateSentence,
  TraceSchema,
  type Counterexample,
  type Harness,
  type Hypothesis,
  type MentorView,
  type Task,
  type Trace,
} from '@architect/shared';
import { codeHash } from '../counterexamples/cases';
import { callKey } from '../counterexamples/find';
import type { SuiteCase } from '../counterexamples/suite';
import type { StoredRound } from '../store/records';
import { must } from './errors';
import { readJsonFile } from './files';
import type { RunState } from './run-state';

/** A failed train attempt of the round, as a counterexample search reads it. */
export interface FailedAttempt {
  attemptId: string;
  task: Task;
  trace: Trace;
}

/**
 * Counterexamples come with a mentor choosing from the menu; the comparison arms keep the
 * protocol they were declared with.
 */
function counts(state: RunState): boolean {
  return state.run.method === 'architect';
}

/**
 * This round's counterexamples (decision 078): found once, before the mentor is asked, from the
 * helper calls of the round's failed train attempts, and stored with the round. A round that
 * already has its reply searched before, so it only reads back what that search stored.
 */
export async function roundCounterexamples(
  state: RunState,
  stored: StoredRound,
  failed: readonly FailedAttempt[],
): Promise<Counterexample[]> {
  const { store, runId } = state.ctx;
  const index = stored.round.index;
  const existing = store.counterexamples.list({ runId, round: index });
  if (!counts(state) || existing.length > 0 || stored.reply !== null || failed.length === 0) {
    return existing;
  }
  const found = await state.ctx.deps.runtime.findCounterexamples({
    job: state.job,
    jobDir: state.jobDir,
    harness: await state.resources.harness(stored.baseVersion),
    sandbox: await state.resources.sandbox(),
    today: state.record.today,
    attempts: failed,
    known: new Set(store.counterexamples.list({ jobId: state.run.jobId }).map(callKey)),
  });
  const createdAt = state.now();
  const records: Counterexample[] = found.map((counterexample) => ({
    ...counterexample,
    id: newId('cex'),
    jobId: state.run.jobId,
    runId,
    round: index,
    createdAt,
  }));
  store.transaction(() => {
    for (const record of records) store.counterexamples.put(record);
  });
  for (const record of records) {
    state.announce('counterexample', record.id, index);
    state.log(
      'info',
      `Round ${index}: ${predicateSentence(record.helper.name, record.predicate)} on ${record.taskId}; its ${record.size.originalRows} rows reduced to ${record.size.reducedRows}.`,
    );
  }
  return records;
}

/** What the mentor sees of the counterexamples: this round's cases and each helper's suite size. */
export function counterexampleView(
  state: RunState,
  round: readonly Counterexample[],
): MentorView['counterexamples'] {
  const suite: Record<string, number> = {};
  for (const counterexample of state.ctx.store.counterexamples.list({ jobId: state.run.jobId })) {
    suite[counterexample.helper.name] = (suite[counterexample.helper.name] ?? 0) + 1;
  }
  return {
    cases: round.map((counterexample) => ({
      helper: counterexample.helper.name,
      taskId: counterexample.taskId,
      failure: predicateSentence(counterexample.helper.name, counterexample.predicate),
      arguments: counterexample.arguments,
      tables: counterexample.tables,
      texts: Object.keys(counterexample.texts),
      originalRows: counterexample.size.originalRows,
      reducedRows: counterexample.size.reducedRows,
    })),
    suite,
  };
}

/** A counterexample of this round, with the attempt it came from for its original case. */
async function suiteCase(
  state: RunState,
  stored: StoredRound,
  base: Harness,
  counterexample: Counterexample,
): Promise<SuiteCase> {
  if (counterexample.runId !== state.ctx.runId || counterexample.round !== stored.round.index) {
    return { counterexample };
  }
  const attempt = must(
    state
      .attempts({ split: 'train', round: stored.round.index, version: stored.baseVersion })
      .find((one) => one.id === counterexample.attemptId),
    `The attempt ${counterexample.attemptId}`,
  );
  const task = must(
    (await state.trainBatch(stored.round.index)).find((one) => one.id === counterexample.taskId),
    `The train task ${counterexample.taskId}`,
  );
  const trace = TraceSchema.parse(
    await readJsonFile(
      state.ctx.paths.fromStored(must(attempt.tracePath, `The trace of ${attempt.id}`)),
    ),
  );
  return { counterexample, original: { task, trace, harness: base } };
}

/**
 * Why a change set's helpers fail the field's counterexamples, or null when they pass or have
 * none (decision 078). Each helper the change writes is run in the sandbox on every counterexample
 * of that helper in the field: on each reduced case, and on this round's original inputs too. No
 * model is called. Each counterexample records the try; a passing one is kept as its repair.
 */
export async function suiteProblem(
  state: RunState,
  stored: StoredRound,
  candidate: Harness,
  hypothesis: Hypothesis,
): Promise<string | null> {
  if (!counts(state)) return null;
  const { store, runId } = state.ctx;
  const touched = new Set(hypothesis.edits.map((edit) => edit.path));
  const field = store.counterexamples.list({ jobId: state.run.jobId });
  const base = await state.resources.harness(stored.baseVersion);
  const problems: string[] = [];
  for (const tool of candidate.tools) {
    if (!touched.has(`tools/${tool.name}.js`) && !touched.has(`tools/${tool.name}.json`)) continue;
    const mine = field.filter((counterexample) => counterexample.helper.name === tool.name);
    if (mine.length === 0) continue;
    const cases = await Promise.all(mine.map((one) => suiteCase(state, stored, base, one)));
    const results = await state.ctx.deps.runtime.runSuite(
      {
        job: state.job,
        jobDir: state.jobDir,
        sandbox: await state.resources.sandbox(),
        today: state.record.today,
      },
      tool,
      cases,
    );
    store.transaction(() => {
      for (const counterexample of mine) {
        if (counterexample.repair?.passed === true) continue;
        const own = results.filter((result) => result.counterexampleId === counterexample.id);
        store.counterexamples.put({
          ...counterexample,
          repair: {
            runId,
            round: stored.round.index,
            codeHash: codeHash(tool.code),
            passed: own.every((result) => result.passed),
            results: own,
          },
        });
      }
    });
    for (const counterexample of mine) {
      state.announce('counterexample', counterexample.id, stored.round.index);
    }
    const failed = results.filter((result) => !result.passed);
    if (failed.length > 0) {
      problems.push(
        `tools/${tool.name}.js fails ${failed.length} of the ${results.length} cases of its counterexamples. ${must(failed[0], 'A failed case').detail}`,
      );
    }
  }
  return problems.length === 0 ? null : problems.join(' ');
}
