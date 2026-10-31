import type { JsonValue, Task } from '@architect/shared';
import { hits, normalize, plateReport, qc, replicates, retestPlan } from '../src/reference/solver';
import { AgentTools } from '../src/reference/tools';
import type {
  NormalizeRequest,
  PlateRequest,
  ReplicateRequest,
  RetestPlanRequest,
} from '../src/tasks/build';
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
      case 'normalize':
        return normalize(tools, request as NormalizeRequest);
      case 'hits':
        return hits(tools, request as PlateRequest);
      case 'qc':
        return qc(tools, request as PlateRequest);
      case 'replicates':
        return replicates(tools, request as ReplicateRequest);
      case 'retest_plan':
        return retestPlan(tools, request as RetestPlanRequest);
      case 'plate_report':
        return plateReport(tools, request as PlateRequest);
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
