import type { LlamaServerStatus } from '@architect/shared';

/** What the llama.cpp row in Settings shows, worked out from its status and the setting. */
export interface LlamaServerRowState {
  /** Where it was found and its build, when it works. */
  found: { build: number | undefined; path: string | null } | null;
  /** What stands in the way, in one plain sentence, when it doesn't work. */
  problem: string | null;
  /** The engine's own sentences on it, with what to do, for whoever opens Details. */
  details: string | null;
  tooOld: boolean;
  /** A program was chosen in Settings, so going back to the one on PATH is offered. */
  canClear: boolean;
}

/**
 * The row's state. A chosen program can be cleared whether or not it was found: the hint for a
 * missing one says to clear it, so the row must offer it. The plain sentence comes from the
 * status's fields (a build below the minimum, no program found, a chosen program gone), and the
 * engine's sentences, which say what to do, wait under Details.
 */
export function llamaServerRowState(
  status: LlamaServerStatus | undefined,
  chosenPath: string | undefined,
): LlamaServerRowState {
  const canClear = chosenPath !== undefined;
  if (status === undefined) {
    return { found: null, problem: null, details: null, tooOld: false, canClear };
  }
  const tooOld = status.build !== undefined && status.build < status.minimumBuild;
  if (status.ready) {
    return {
      found: { build: status.build, path: status.source === 'path' ? null : (status.path ?? null) },
      problem: null,
      details: null,
      tooOld,
      canClear,
    };
  }
  const details = [status.problem, status.hint].filter(Boolean).join(' ');
  let problem: string;
  if (tooOld) {
    problem = `Build ${status.build} is too old. Build ${status.minimumBuild} or newer is needed.`;
  } else if (status.source === null && canClear) {
    problem = "The program you chose isn't there anymore.";
  } else if (status.source === null) {
    problem = 'Not installed. Agents with trained weights need it.';
  } else {
    problem = "Couldn't run it.";
  }
  return { found: null, problem, details: details === '' ? null : details, tooOld, canClear };
}
