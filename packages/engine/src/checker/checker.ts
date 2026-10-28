import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  CheckResultSchema,
  type CheckOutcome,
  type CheckResult,
  type Expected,
  type Job,
  type Task,
} from '@architect/shared';
import type { TableSnapshot } from '../data/types';
import type { CheckedFiles } from '../files/agent-files';
import type { Sandbox, SandboxOutcome, ValidatorContext } from '../sandbox/types';
import { checkFacts, compareAnswer, TaskDefinitionError } from './compare';

/** The job's checker can't grade a task: its module is missing or broken, or the task is invalid. */
export class CheckerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckerError';
  }
}

export interface Checker {
  /** Grades one attempt. The same task, outcome and end state always give the same result. */
  check(task: Task, outcome: CheckOutcome, files: CheckedFiles): Promise<CheckResult>;
}

export interface CheckerOptions {
  job: Job;
  /** The job folder; a checker module path is relative to it. */
  jobDir: string;
  sandbox: Sandbox;
}

type EndState = Extract<Expected, { kind: 'end_state' }>;

/**
 * Grades attempts deterministically: answers with the built-in comparator, facts by path, and
 * end states with the job's checker module, run in the sandbox without a clock or randomness.
 * A task that asks only for an answer or facts fails when the attempt changed any table.
 */
export function createChecker(options: CheckerOptions): Checker {
  let source: Promise<string> | undefined;
  const checkerSource = () => (source ??= loadCheckerSource(options.job, options.jobDir));

  return {
    async check(task, outcome, files) {
      const stopped = stoppedEarly(outcome);
      if (stopped) return fail(stopped);
      const { expected } = task;
      if (expected.kind !== 'end_state') {
        const changed = changedTable(files);
        if (changed !== null) {
          return fail(`${changed} changed, but the task asks only for an answer.`);
        }
      }
      try {
        if (expected.kind === 'answer') {
          return graded(
            missingAnswer(outcome) ??
              compareAnswer(outcome.answer, expected.value, expected.compare),
            'The answer matches the expected value.',
          );
        }
        if (expected.kind === 'facts') {
          const holds =
            expected.facts.length === 1
              ? 'The fact holds.'
              : `All ${expected.facts.length} facts hold.`;
          return graded(
            missingAnswer(outcome) ?? checkFacts(outcome.answer, expected.facts),
            holds,
          );
        }
      } catch (error) {
        if (error instanceof TaskDefinitionError)
          throw new CheckerError(`Task ${task.id}: ${error.message}`);
        throw error;
      }
      return checkEndState(expected, outcome, files, await checkerSource(), options.sandbox);
    },
  };
}

async function checkEndState(
  expected: EndState,
  outcome: CheckOutcome,
  files: CheckedFiles,
  source: string,
  sandbox: Sandbox,
): Promise<CheckResult> {
  const context: ValidatorContext = {
    tables: files.tables(),
    originalTables: files.originalTables(),
    answer: outcome.answer,
    finalText: outcome.finalText,
    toolCalls: outcome.toolCalls,
  };
  const run = () => sandbox.runValidator(source, expected.validator, expected.params, context);
  let result: SandboxOutcome = await run();
  // A crashed sandbox process is replaced on the next call, so one retry tells a fluke from a fault.
  if (!result.ok && result.failure.kind === 'crashed') result = await run();

  if (result.ok) {
    const parsed = CheckResultSchema.safeParse(result.value);
    if (parsed.success) return parsed.data;
    throw new CheckerError(
      `The validator ${expected.validator} returned ${JSON.stringify(result.value).slice(0, 120)} instead of { pass, reason }.`,
    );
  }
  const { kind, message } = result.failure;
  if (kind === 'load' || kind === 'crashed') {
    throw new CheckerError(
      `The checker module could not run the validator ${expected.validator}: ${message}`,
    );
  }
  return fail(`The validator ${expected.validator} failed on this end state: ${message}`);
}

async function loadCheckerSource(job: Job, jobDir: string): Promise<string> {
  if (job.checker.kind !== 'module') {
    throw new CheckerError('A task is checked by end state, but the job has no checker module.');
  }
  const root = resolve(jobDir);
  const path = resolve(root, job.checker.path);
  const inside = relative(root, path);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) {
    throw new CheckerError(`The checker module ${job.checker.path} must be inside the job folder.`);
  }
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    throw new CheckerError(
      `The checker module ${job.checker.path} could not be read: ${(error as Error).message}`,
    );
  }
}

function stoppedEarly(outcome: CheckOutcome): string | null {
  switch (outcome.stopReason) {
    case 'refused':
      return 'The agent refused the request instead of doing it.';
    case 'aborted':
      return 'The attempt was stopped before it finished.';
    case 'error':
      return 'The attempt ended with an error before the agent finished.';
    default:
      return null;
  }
}

/**
 * The first data table whose rows an attempt changed, or null. An unchanged table is the same
 * snapshot before and after; a rewrite that kept every row and column counts as unchanged.
 */
function changedTable(files: CheckedFiles): string | null {
  return changedTables(files.originalTables(), files.tables())[0] ?? null;
}

/**
 * The tables in `now` whose rows or columns differ from `before`, by name, in the order `now`
 * lists them. The checker's one notion of a changed table: a rewrite that kept every row and
 * column is unchanged.
 */
export function changedTables(
  before: Readonly<Record<string, TableSnapshot>>,
  now: Readonly<Record<string, TableSnapshot>>,
): string[] {
  return Object.entries(now).flatMap(([name, table]) => {
    const original = before[name];
    if (table === original) return [];
    return original === undefined || !sameRows(table, original) ? [name] : [];
  });
}

function sameRows(a: TableSnapshot, b: TableSnapshot): boolean {
  return JSON.stringify([a.columns, a.rows]) === JSON.stringify([b.columns, b.rows]);
}

function missingAnswer(outcome: CheckOutcome): string | null {
  if (outcome.answerError === undefined) return null;
  if (outcome.stopReason === 'max_steps') {
    return 'The agent ran out of steps before giving an ANSWER line.';
  }
  return outcome.answerError;
}

function graded(difference: string | null, passReason: string): CheckResult {
  return difference === null ? { pass: true, reason: passReason } : fail(difference);
}

function fail(reason: string): CheckResult {
  return { pass: false, reason };
}
