import type { FieldView, Job, ReportCard, Run, Score } from '@architect/shared';
import { api } from '../api/client';
import { rate } from '../flow/format';
import { orgScores, type OrgScores } from '../lab/items';

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
  /** Newest first. */
  candidates: Candidate[];
  /** The newest change to the job or any of its runs. */
  lastActivity: string;
}

export interface OrgCounts {
  taughtOn: number;
  sealed: number;
  /** Null when the job doesn't say whether its one organization is real. */
  real: number | null;
}

/**
 * A final test's scores by kind of organization. Seen is the card's own score, which for a job
 * with organizations counts only those it trained on (decision 070).
 */
export function scoresOf(report: ReportCard): OrgScores {
  const perOrg = report.test.perOrg ?? [];
  const { unseen, real } = orgScores(perOrg);
  return { seen: report.test.score.total === 0 ? null : report.test.score, unseen, real };
}

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
        return { run, report, scores: scoresOf(report) };
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
  return { job, view, candidates, lastActivity };
}

export const fieldKey = (jobId: string) => `field:${jobId}`;

/**
 * The candidate that did best on the organizations it trained on; on a tie, the newest. Null
 * before any run took its final test.
 */
export function bestCandidate(candidates: readonly Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    const seen = candidate.scores.seen;
    if (seen === null) continue;
    if (!best?.scores.seen || rate(seen) > rate(best.scores.seen)) best = candidate;
  }
  return best;
}

/** How many organizations it trains on, how many are sealed, and how many of all are real. */
export function orgCounts(view: FieldView): OrgCounts {
  const kinds = [
    ...view.organizations.map((org) => org.synthetic),
    ...view.sealed.map((org) => org.synthetic),
  ];
  return {
    taughtOn: view.organizations.length,
    sealed: view.sealed.length,
    real: kinds.includes(null) ? null : kinds.filter((synthetic) => synthetic === false).length,
  };
}

/** Pass rate for sorting, or null for a kind not tested. */
export const rateOf = (score: Score | null | undefined): number | null =>
  score ? rate(score) : null;
