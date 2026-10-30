import type { JsonValue, Task } from '@architect/shared';
import { afterWrong, assign, diagnose, hint, history, solve } from '../src/reference/solver';
import { AgentTools } from '../src/reference/tools';
import type { AssignRequest, HistoryRequest, SolveRequest, WrongAnswer } from '../src/tasks/build';
import { TODAY, job, orgOf } from './helpers';

export interface Attempt {
  task: Task;
  tools: AgentTools;
  answer: JsonValue;
}

/** One reference attempt at a task, with fresh tools bound to the task's organization. */
export function solveTask(task: Task): Attempt {
  const tools = new AgentTools(job.data(orgOf(task)), TODAY);
  const request = task.meta?.request;
  const answer = (() => {
    switch (task.type) {
      case 'diagnose':
        return diagnose(tools, request as unknown as WrongAnswer);
      case 'hint':
        return hint(tools, request as unknown as WrongAnswer);
      case 'solve':
        return solve(request as unknown as SolveRequest);
      case 'history':
        return history(tools, request as unknown as HistoryRequest);
      case 'assign':
        return assign(tools, request as unknown as AssignRequest);
      case 'after_wrong':
        return afterWrong(tools, request as unknown as WrongAnswer);
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
