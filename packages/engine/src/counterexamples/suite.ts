import {
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
import { detectFailure, expectedFields, failureHolds } from './predicate';

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
 * reduced case it passes when the recorded failure no longer holds. On the original case, the
 * attempt's own inputs rebuilt by replay, it must neither throw nor give a value the checker's
 * expected values contradict.
 */
export async function runSuite(
  ctx: SuiteContext,
  tool: Pick<HarnessTool, 'name' | 'code'>,
  cases: readonly SuiteCase[],
): Promise<SuiteResult[]> {
  const results: SuiteResult[] = [];
  for (const { counterexample: cx, original } of cases) {
    const reduced = await runOnCase(ctx.sandbox, tool, cx.arguments, cx);
    const still = failureHolds(cx.predicate, reduced);
    results.push({
      counterexampleId: cx.id,
      case: 'reduced',
      passed: !still,
      detail: still
        ? `Still: ${predicateSentence(tool.name, cx.predicate)}.`
        : cx.predicate.kind === 'threw'
          ? `No longer stops with "${cx.predicate.message}".`
          : `No longer gives ${cx.predicate.field} ${JSON.stringify(cx.predicate.got)}.`,
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
