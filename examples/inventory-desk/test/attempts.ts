import { AgentTools } from '@architect/example-assay-desk';
import type { JsonValue, Task } from '@architect/shared';
import { allocateList, pickLot, reserve, usable } from '../src/reference/solver';
import type { CompoundRequest, ListRequest } from '../src/tasks/build';
import { job, orgOf, todayOf } from './helpers';

export interface Attempt {
  task: Task;
  tools: AgentTools;
  answer: JsonValue;
}

/** One reference attempt at a task, with fresh tools bound to the task's lab. */
export function solveTask(task: Task): Attempt {
  const tools = new AgentTools(job.data(orgOf(task)), todayOf(task));
  const request = task.meta?.request as unknown;
  const answer = (() => {
    switch (task.type) {
      case 'usable':
        return usable(tools, request as CompoundRequest);
      case 'pick_lot':
        return pickLot(tools, request as CompoundRequest);
      case 'allocate':
        return allocateList(tools, request as ListRequest);
      case 'reserve':
        return reserve(tools, request as ListRequest);
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
