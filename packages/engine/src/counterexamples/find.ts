import type { Counterexample, Harness, Job, Task, Trace } from '@architect/shared';
import type { Sandbox } from '../sandbox/types';
import { replayToCall } from '../teaching/checkpoint';
import { caseHash, caseOf, codeHash, runOnCase } from './cases';
import { detectFailure, expectedFields, failureHolds } from './predicate';
import { columnCount, reduceCase, rowCount } from './reduce';

/** Counterexamples one round may add, so the mentor gets a few small cases, not a pile. */
export const MAX_COUNTEREXAMPLES_PER_ROUND = 3;

/** A counterexample as found, before the loop gives it an id and files it with its round. */
export type FoundCounterexample = Omit<
  Counterexample,
  'id' | 'jobId' | 'runId' | 'round' | 'createdAt' | 'repair'
>;

export interface CounterexampleSearch {
  job: Job;
  jobDir: string;
  /** The harness the attempts ran with. */
  harness: Harness;
  sandbox: Sandbox;
  today: string;
  /** Failed train attempts, with their tasks and traces. */
  attempts: readonly { attemptId: string; task: Task; trace: Trace }[];
  /** Keys of the calls already turned into counterexamples (see `callKey`). */
  known: ReadonlySet<string>;
  maxSteps?: number;
}

/** What makes two failing calls the same: the helper's code, the task and the arguments. */
export function callKey(found: Pick<Counterexample, 'helper' | 'taskId' | 'arguments'>): string {
  return [
    found.helper.name,
    found.helper.codeHash,
    found.taskId,
    JSON.stringify(found.arguments),
  ].join('\u0000');
}

/**
 * Finds the helper calls that failed in failed train attempts and reduces each to a small case
 * (decision 078). Each call is replayed faithfully from the attempt's record, run again in the
 * sandbox on exactly those inputs, and judged against the checker's expected values: it threw, or
 * it gave a value the checker contradicts. At most one per helper and a few per round. Only train
 * attempts come here; nothing from dev or the locked test does.
 */
export async function findCounterexamples(
  search: CounterexampleSearch,
): Promise<FoundCounterexample[]> {
  const helpers = new Map(search.harness.tools.map((tool) => [tool.name, tool]));
  const found: FoundCounterexample[] = [];
  const done = new Set<string>();
  for (const { attemptId, task, trace } of search.attempts) {
    for (const step of trace.steps) {
      if (found.length >= MAX_COUNTEREXAMPLES_PER_ROUND) return found;
      if (step.kind !== 'tool') continue;
      const tool = helpers.get(step.name);
      if (tool === undefined || done.has(tool.name)) continue;
      const helper = { name: tool.name, codeHash: codeHash(tool.code) };
      if (search.known.has(callKey({ helper, taskId: task.id, arguments: step.arguments }))) {
        continue;
      }
      const replay = await replayToCall({
        trace,
        job: search.job,
        jobDir: search.jobDir,
        ...(task.org === undefined ? {} : { org: task.org }),
        harness: search.harness,
        sandbox: search.sandbox,
        today: search.today,
        callId: step.callId,
      });
      if (!replay.ok) continue;
      const original = caseOf(replay.replayed.data);
      const args = step.arguments;
      const expected = expectedFields(task);
      const predicate = detectFailure(
        await runOnCase(search.sandbox, tool, args, original),
        expected,
      );
      if (predicate === null) continue;
      const reduction = await reduceCase({
        data: original,
        args,
        predicate,
        code: tool.code,
        expected,
        holds: async (candidate) =>
          failureHolds(predicate, await runOnCase(search.sandbox, tool, args, candidate)),
        ...(search.maxSteps === undefined ? {} : { maxSteps: search.maxSteps }),
      });
      done.add(tool.name);
      found.push({
        taskId: task.id,
        ...(task.org === undefined ? {} : { org: task.org }),
        attemptId,
        callId: step.callId,
        helper,
        arguments: args,
        predicate,
        tables: reduction.data.tables,
        texts: reduction.data.texts,
        size: {
          originalRows: rowCount(original),
          reducedRows: rowCount(reduction.data),
          originalColumns: columnCount(original),
          reducedColumns: columnCount(reduction.data),
        },
        minimality: reduction.minimal ? '1-minimal' : 'reduced',
        steps: reduction.steps,
        hashes: { original: caseHash(original), reduced: caseHash(reduction.data) },
      });
    }
  }
  return found;
}
