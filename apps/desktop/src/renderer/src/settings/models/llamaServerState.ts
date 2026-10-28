import type { LlamaServerStatus } from '@architect/shared';

/** What the llama.cpp row in Settings shows, worked out from its status and the setting. */
export interface LlamaServerRowState {
  /** Where it was found and its build, when it works. */
  found: { build: number | undefined; path: string | null } | null;
  /** What stands in the way, and what to do about it, when it doesn't. */
  problem: string | null;
  tooOld: boolean;
  /** A program was chosen in Settings, so going back to the one on PATH is offered. */
  canClear: boolean;
}

/**
 * The row's state. A chosen program can be cleared whether or not it was found: the hint for a
 * missing one says to clear it, so the row must offer it.
 */
export function llamaServerRowState(
  status: LlamaServerStatus | undefined,
  chosenPath: string | undefined,
): LlamaServerRowState {
  const canClear = chosenPath !== undefined;
  if (status === undefined) return { found: null, problem: null, tooOld: false, canClear };
  const tooOld = status.build !== undefined && status.build < status.minimumBuild;
  if (status.ready) {
    return {
      found: { build: status.build, path: status.source === 'path' ? null : (status.path ?? null) },
      problem: null,
      tooOld,
      canClear,
    };
  }
  const problem = [status.problem, status.hint].filter(Boolean).join(' ');
  return { found: null, problem: problem === '' ? null : problem, tooOld, canClear };
}
