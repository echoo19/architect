import { studentPricing } from '@architect/shared';
import type { LoopDeps } from '../loop/deps';
import { CREDIT_REFUSAL, type StudentCredit } from './spend';
import { GPU_REFUSAL, type GpuWindow } from './gpu';

/** What holds a comparison's spending at the request: the student's credit and the GPU window. */
export interface Guards {
  credit: StudentCredit;
  gpu: GpuWindow;
}

/**
 * The engine's dependencies with every student behind the comparison's guards: a hosted one
 * through the credit's journal and cap, one on this computer (Ollama, or llama-server with
 * adapters) through the GPU window. Spark, as the mentor or as the agent, is held by each arm's
 * own Spark cap in the engine, as before.
 */
export function guardedDeps(deps: LoopDeps, guards: Guards): LoopDeps {
  const { adapters } = deps;
  const adapterStudent = adapters.createAdapterStudent;
  return {
    ...deps,
    adapters: {
      ...adapters,
      createStudent: (endpoint, options) => {
        const student = adapters.createStudent(endpoint, options);
        return student.isLocal
          ? guards.gpu.guard(student)
          : guards.credit.guard(student, studentPricing(endpoint));
      },
      ...(adapterStudent === undefined
        ? {}
        : {
            createAdapterStudent: (request, options) =>
              guards.gpu.guard(adapterStudent(request, options)),
          }),
    },
  };
}

/** Whether an error a run paused with is a guard's refusal rather than a passing failure. */
export function isGuardRefusal(message: string | undefined): boolean {
  return (
    message !== undefined && (message.startsWith(CREDIT_REFUSAL) || message.startsWith(GPU_REFUSAL))
  );
}

/**
 * Whether something a guard paused may go on now: what the GPU window stopped, while this
 * command has a window open or not yet opened; what the credit stopped, while it has room left.
 * Waiting won't change either, so the runner asks once, not after rests.
 */
export function guardAllows(guards: Guards, message: string | undefined): boolean {
  if (message?.startsWith(GPU_REFUSAL) === true) return guards.gpu.refusal() === null;
  if (message?.startsWith(CREDIT_REFUSAL) === true) return guards.credit.hasRoom();
  return true;
}
