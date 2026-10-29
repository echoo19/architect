import type { JobRun, JobSummary } from '@architect/shared';
import { paths } from '../lib/router';

/**
 * What a job's newest run asks of the person, for the row it gets in the sidebar: training and
 * paused runs, one waiting for an answer, results nobody has taken yet, and runs that ended with
 * nothing made, which can still be opened to see what happened.
 */
export type TrainingRowKind = 'training' | 'paused' | 'question' | 'results' | 'stopped' | 'failed';

export interface TrainingRow {
  jobId: string;
  jobName: string;
  runId: string;
  kind: TrainingRowKind;
  /** Where the row goes: the results when they are ready, the run itself otherwise. */
  path: string;
}

/** The words each kind is listed with, beside the job's name. */
export const TRAINING_ROW_WORDS: Record<TrainingRowKind, string> = {
  training: 'Training',
  paused: 'Paused',
  question: 'Needs you',
  results: 'Results ready',
  stopped: 'Stopped',
  failed: 'Error',
};

/**
 * The kind of row a run gets, or null when it needs none. A finished run is in the list of agents
 * once its agent is accepted, so only one whose results still wait for the person has a row; an
 * improvement ends in a version under the agent's Teaching, which says so there.
 */
function kindOf(run: JobRun): TrainingRowKind | null {
  switch (run.status) {
    case 'queued':
    case 'running':
    case 'stopping':
    case 'testing':
      return 'training';
    case 'paused':
      return run.phase === 'clarifying' ? 'question' : 'paused';
    case 'finished':
      return run.improves !== true && run.accepted === false ? 'results' : null;
    case 'stopped':
      return 'stopped';
    case 'failed':
      return 'failed';
  }
}

/** One row for each job whose newest run has something to open, in the jobs' order. */
export function trainingRows(jobs: readonly JobSummary[]): TrainingRow[] {
  return jobs.flatMap((job) => {
    const run = job.latestRun;
    const kind = run === undefined ? null : kindOf(run);
    if (run === undefined || kind === null) return [];
    return [
      {
        jobId: job.id,
        jobName: job.name,
        runId: run.id,
        kind,
        path: kind === 'results' ? paths.report(run.id) : paths.train(run.id),
      },
    ];
  });
}
