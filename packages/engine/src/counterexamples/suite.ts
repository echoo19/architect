import {
  errorWords,
  predicateSentence,
  type Counterexample,
  type Harness,
  type HarnessTool,
  type Job,
  type SuiteResult,
  type Task,
  type Trace,
} from '@architect/shared';
import type { Sandbox } from '../sandbox/types';
import { replayToCall } from '../teaching/checkpoint';
import { caseOf, runOnCase } from './cases';
import { detectFailure, expectedFields, failureHolds, regressionFailure } from './predicate';

/** A counterexample to run a changed helper on, and for this round's own, the attempt it came from. */
export interface SuiteCase {
  counterexample: Counterexample;
  /** The failed attempt and the harness it ran with, to rebuild the original inputs by replay. */
  original?: { task: Task; trace: Trace; harness: Harness };
}

export interface SuiteContext {
  job: Job;
  jobDir: string;
  sandbox: Sandbox;
  today: string;
}

/**
 * Runs a changed helper on the field's counterexamples in the sandbox, with no model call. On a
 * reduced case it passes only when it runs without an error and gives no value contradicting the
 * one the case records as expected, so a crash repaired into another crash fails. On the original
 * case, the attempt's own inputs rebuilt by replay, it must neither throw nor give a value the
 * checker's expected values contradict.
 */
export async function runSuite(
  ctx: SuiteContext,
  tool: Pick<HarnessTool, 'name' | 'code'>,
  cases: readonly SuiteCase[],
): Promise<SuiteResult[]> {
  const results: SuiteResult[] = [];
  for (const { counterexample: cx, original } of cases) {
    const reduced = await runOnCase(ctx.sandbox, tool, cx.arguments, cx);
    const failure = regressionFailure(cx.predicate, reduced);
    results.push({
      counterexampleId: cx.id,
      case: 'reduced',
      passed: failure === null,
      detail:
        failure !== null
          ? `${failureHolds(cx.predicate, reduced) ? 'Still: ' : ''}${predicateSentence(tool.name, failure)}.`
          : cx.predicate.kind === 'threw'
            ? `Runs without an error where it stopped with "${errorWords(cx.predicate.message)}".`
            : `No longer gives ${cx.predicate.field} ${JSON.stringify(cx.predicate.got)}, and nothing the checker contradicts.`,
    });
    if (original !== undefined) results.push(await originalResult(ctx, tool, cx, original));
  }
  return results;
}

async function originalResult(
  ctx: SuiteContext,
  tool: Pick<HarnessTool, 'name' | 'code'>,
  cx: Counterexample,
  original: NonNullable<SuiteCase['original']>,
): Promise<SuiteResult> {
  const replay = await replayToCall({
    trace: original.trace,
    job: ctx.job,
    jobDir: ctx.jobDir,
    ...(original.task.org === undefined ? {} : { org: original.task.org }),
    harness: original.harness,
    sandbox: ctx.sandbox,
    today: ctx.today,
    callId: cx.callId,
  });
  const result = { counterexampleId: cx.id, case: 'original' as const };
  if (!replay.ok) {
    return {
      ...result,
      passed: false,
      detail: `The original case couldn't be rebuilt: ${replay.reason}`,
    };
  }
  const outcome = await runOnCase(ctx.sandbox, tool, cx.arguments, caseOf(replay.replayed.data));
  const failure = detectFailure(outcome, expectedFields(original.task));
  return failure === null
    ? {
        ...result,
        passed: true,
        detail: 'Runs on the attempt’s own inputs with no value the checker contradicts.',
      }
    : { ...result, passed: false, detail: `${predicateSentence(tool.name, failure)}.` };
}
