import {
  reportScores,
  type FieldView,
  type Job,
  type OrgScores,
  type ReportCard,
  type Run,
  type Score,
} from '@architect/shared';
import { api } from '../api/client';
import { rate } from '../flow/format';

/*
 * A field as its pages show it, read from records the engine keeps: the job, what it is made of,
 * and every run that took its final test, each a candidate with its scores on organizations it
 * trained on, generated ones it never saw and real ones it never saw. Nothing is estimated; a
 * kind of organization that wasn't tested is null, never zero.
 */

export interface Candidate {
  run: Run;
  report: ReportCard;
  scores: OrgScores;
}

export interface FieldSummary {
  job: Job;
  view: FieldView;
  /** Every run of the job, as the engine lists them. */
  runs: Run[];
  /** Newest first. */
  candidates: Candidate[];
  /** The newest change to the job or any of its runs. */
  lastActivity: string;
}

export { bestCandidate, orgCounts } from '@architect/shared';

const newer = (a: string, b: string) => (a > b ? a : b);

/** Every run of the job that took its final test, with its card. */
async function candidatesOf(jobId: string): Promise<{ runs: Run[]; candidates: Candidate[] }> {
  const runs = await api.runs(jobId);
  const finished = runs.filter((run) => run.status === 'finished');
  const tested = await Promise.all(
    finished.map(async (run) => ((await api.reportTargets(run.id)).length > 0 ? run : null)),
  );
  const candidates = await Promise.all(
    tested
      .filter((run): run is Run => run !== null)
      .map(async (run) => {
        const report = await api.report(run.id);
        return { run, report, scores: reportScores(report) };
      }),
  );
  candidates.sort((a, b) => (a.report.createdAt < b.report.createdAt ? 1 : -1));
  return { runs, candidates };
}

/** Reads one field: the job, its view, and its candidates. */
export async function readField(jobId: string): Promise<FieldSummary> {
  const [job, view, { runs, candidates }] = await Promise.all([
    api.job(jobId),
    api.field(jobId),
    candidatesOf(jobId),
  ]);
  const lastActivity = runs.reduce((at, run) => newer(at, run.updatedAt), job.createdAt);
  return { job, view, runs, candidates, lastActivity };
}

export const fieldKey = (jobId: string) => `field:${jobId}`;

/** Pass rate for sorting, or null for a kind not tested. */
export const rateOf = (score: Score | null | undefined): number | null =>
  score ? rate(score) : null;
