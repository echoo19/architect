import { isLoopbackUrl, type LocalRuntimes } from '@architect/shared';
import { isInstalled } from '../../settings/models/StudentRows';
import { modelNames } from '../names';
import type { LiveRun } from './run-state';

/**
 * Something that would keep a paused run from going on, found by looking at the computer now, not
 * by reading the engine's sentence: a key that isn't saved, Ollama not running, or a model that
 * isn't downloaded. Each has a way to put it right.
 */
export type PauseProblem =
  | { kind: 'key'; text: string }
  | { kind: 'runtime'; text: string }
  | { kind: 'model'; text: string; model: string };

/** What the computer has now: the keys that are saved, and the local runtimes. Null until read. */
export interface PauseFacts {
  keys: Record<string, boolean> | null;
  local: LocalRuntimes | null;
}

/** Whether two addresses name the same server, whatever the trailing slash or the path says. */
function sameServer(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

/**
 * What stands in the way of a paused run, from the job's own settings and what the computer has
 * now. The mentor is looked at only while the run teaches: its final test runs without it. The
 * student is looked at where it works now, which is a hosted copy while a hosted run practices
 * and this computer for the final test. A fact not read yet claims nothing.
 */
export function pauseProblems(live: LiveRun, facts: PauseFacts): PauseProblem[] {
  const { job, run } = live;
  const names = modelNames(job);
  const problems: PauseProblem[] = [];
  const testing = run.phase === 'testing' || run.status === 'testing';

  const { mentor } = job;
  if (!testing && mentor.kind === 'model' && mentor.secretRef !== undefined) {
    if (facts.keys?.[mentor.secretRef] === false) {
      problems.push({ kind: 'key', text: `${names.mentor} has no key saved.` });
    }
  }

  if (!testing && job.student.trainOn === 'hosted') {
    const { hosted } = job.student;
    if (hosted?.secretRef !== undefined && facts.keys?.[hosted.secretRef] === false) {
      problems.push({ kind: 'key', text: `The online ${names.student} has no key saved.` });
    }
    return problems;
  }

  const endpoint = job.student.local;
  const ollama = facts.local?.ollama;
  if (
    ollama !== undefined &&
    endpoint.runtime === 'ollama' &&
    isLoopbackUrl(endpoint.baseUrl) &&
    sameServer(endpoint.baseUrl, ollama.baseUrl)
  ) {
    if (!ollama.running) {
      problems.push({
        kind: 'runtime',
        text: `Ollama isn't running, so ${names.student} can't answer.`,
      });
    } else if (!isInstalled(ollama, endpoint.model)) {
      problems.push({
        kind: 'model',
        text: `${names.student} isn't downloaded on this computer.`,
        model: endpoint.model,
      });
    }
  }
  return problems;
}
