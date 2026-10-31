import type { JsonValue, Task } from '@architect/shared';
import {
  bestConfig,
  didItHelp,
  divergedRuns,
  earlyStop,
  nextRuns,
  sweepReport,
} from '../src/reference/solver';
import { AgentTools } from '../src/reference/tools';
import type { HelpRequest, RunRequest, SweepRequest } from '../src/tasks/build';
import { job, orgOf } from './helpers';

export interface Attempt {
  task: Task;
  tools: AgentTools;
  answer: JsonValue;
}

/** One reference attempt at a task, with fresh tools bound to the task's group. */
export function solveTask(task: Task): Attempt {
  const tools = new AgentTools(job.data(orgOf(task)));
  const request = task.meta?.request as unknown;
  const answer = (() => {
    switch (task.type) {
      case 'best_config':
        return bestConfig(tools, request as SweepRequest);
      case 'early_stop':
        return earlyStop(tools, request as RunRequest);
      case 'diverged':
        return divergedRuns(tools, request as SweepRequest);
      case 'did_it_help':
        return didItHelp(tools, request as HelpRequest);
      case 'next_runs':
        return nextRuns(tools, request as SweepRequest);
      case 'sweep_report':
        return sweepReport(tools, request as SweepRequest);
      default:
        throw new Error(`No reference for ${task.type}`);
    }
  })();
  return { task, tools, answer };
}

let all: Attempt[] | undefined;

/** Every task solved once by the reference. */
export function allAttempts(): Attempt[] {
  all ??= job.allTasks().map(solveTask);
  return all;
}

/** The end state an attempt leaves: its answer and the rows it appended. */
export function endState(attempt: Attempt) {
  return job.withAppended(
    attempt.task,
    {
      'proposed_runs.csv': attempt.tools.appendedTo('proposed_runs.csv'),
      'decisions.csv': attempt.tools.appendedTo('decisions.csv'),
    },
    attempt.answer,
  );
}
