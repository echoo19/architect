import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GuardError,
  JobSchema,
  RewardRequestSchema,
  TaskSchema,
  type CheckOutcome,
  type RewardRequest,
  type RewardScore,
  type Task,
} from '@architect/shared';
import { parseAnswerLine } from '../agent/answer';
import { CheckerError, createChecker } from '../checker/checker';
import { DataError } from '../data/errors';
import { openAgentFiles } from '../files/agent-files';
import { taskDataDir } from '../loop/organizations';
import { createSandbox } from '../sandbox/sandbox';

/** The outcome scorer of a field export's `env/` folder: one request in, one score out. */
export interface RewardScorer {
  /** Scores one JSON request line. Never throws: a failure is a score with an `error`. */
  score(line: string): Promise<RewardScore>;
  close(): Promise<void>;
}

export interface RewardScorerOptions {
  /** A field export's `env/` folder: `job.json`, `tasks.jsonl`, the checker and the files. */
  envDir: string;
  /** The tool sandbox's child entry, when running from a bundle. */
  sandboxEntryPath?: string;
}

/**
 * Opens the outcome scorer over an `env/` folder (docs/SCALE.md, the amendments). Each attempt is
 * graded as the runner grades one: a fresh scratch copy of its organization's files, its changes
 * applied through the same checks the agent's write tools use, its ANSWER line parsed the same
 * way, and the job's full checker (`createChecker`: the stop reason, the files a task may change,
 * the validator in the sandbox with its limits).
 */
export function openRewardScorer(options: RewardScorerOptions): RewardScorer {
  const { envDir } = options;
  const job = JobSchema.parse(JSON.parse(readFileSync(join(envDir, 'job.json'), 'utf8')));
  const tasks = new Map<string, Task>();
  for (const line of readFileSync(join(envDir, 'tasks.jsonl'), 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    const task = TaskSchema.parse(JSON.parse(line));
    tasks.set(task.id, task);
  }
  const sandbox = createSandbox(
    options.sandboxEntryPath === undefined ? {} : { entryPath: options.sandboxEntryPath },
  );
  const checker = createChecker({ job, jobDir: envDir, sandbox });

  const grade = async (request: RewardRequest, task: Task): Promise<RewardScore> => {
    const files = await openAgentFiles({
      dataDir: taskDataDir(envDir, task),
      files: job.data.files,
      ...(job.data.output === undefined ? {} : { output: job.data.output }),
      mode: 'scratch',
    });
    for (const change of request.changes) {
      try {
        await files.apply(files.plan('write', change.path, change.text));
      } catch (error) {
        if (!(error instanceof GuardError) && !(error instanceof DataError)) throw error;
        return { reward: 0, reason: `The change to ${change.path} was refused: ${error.message}` };
      }
    }
    const parsed = parseAnswerLine(request.final_text);
    const outcome: CheckOutcome = {
      finalText: request.final_text,
      answer: parsed.answer,
      ...(parsed.error === undefined ? {} : { answerError: parsed.error }),
      toolCalls: request.tool_calls,
      stopReason: request.stop_reason,
    };
    const check = await checker.check(task, outcome, files);
    return { reward: check.pass ? 1 : 0, reason: check.reason };
  };

  return {
    async score(line) {
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        return failed(undefined, 'bad_request', 'The request is not a line of JSON.');
      }
      const id = idOf(raw);
      const parsed = RewardRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return failed(id, 'bad_request', `${issue?.path.join('.') ?? ''}: ${issue?.message ?? ''}`);
      }
      const request = parsed.data;
      const task = tasks.get(request.task_id);
      if (task === undefined) {
        return failed(
          id,
          'unknown_task',
          `${request.task_id} is not one of this field's train tasks.`,
        );
      }
      try {
        return { ...(id === undefined ? {} : { id }), ...(await grade(request, task)) };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failed(id, error instanceof CheckerError ? 'checker' : 'internal', message);
      }
    },
    close: () => sandbox.dispose(),
  };
}

function idOf(raw: unknown): string | number | undefined {
  const id = (raw as { id?: unknown } | null)?.id;
  return typeof id === 'string' || typeof id === 'number' ? id : undefined;
}

function failed(
  id: string | number | undefined,
  code: NonNullable<RewardScore['error']>['code'],
  message: string,
): RewardScore {
  return {
    ...(id === undefined ? {} : { id }),
    reward: 0,
    reason: 'Not scored: see the error.',
    error: { code, message },
  };
}
