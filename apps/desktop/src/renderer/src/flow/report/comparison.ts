import { METHOD_LABELS, type Method, type ReportCard, type Run } from '@architect/shared';
import { rate } from '../format';

const METHOD_ORDER: readonly Method[] = ['architect', 'one_shot', 'self_reflection', 'bare'];

export interface ComparisonRow {
  runId: string;
  method: Method;
  label: string;
  /** Locked-test pass rate in percent. */
  testRate: number;
  /** Percentage points above (or below) the bare student; null when there is no bare run. */
  vsBare: number | null;
  mentorUsd: number;
  rounds: number;
  current: boolean;
}

/**
 * The finished runs of every method on the same job and seed as `runId`, newest per method.
 * Returns nothing unless at least one other method has finished, since one row compares nothing.
 */
export function comparisonPeers(runs: readonly Run[], runId: string): Run[] {
  const current = runs.find((run) => run.id === runId);
  if (!current) return [];
  const newest = new Map<Method, Run>();
  for (const run of runs) {
    if (run.jobId !== current.jobId || run.seed !== current.seed || run.status !== 'finished') {
      continue;
    }
    if (run.method === current.method && run.id !== current.id) continue;
    const seen = newest.get(run.method);
    if (!seen || Date.parse(run.createdAt) > Date.parse(seen.createdAt)) {
      newest.set(run.method, run);
    }
  }
  newest.set(current.method, current);
  return newest.size > 1 ? METHOD_ORDER.flatMap((method) => newest.get(method) ?? []) : [];
}

function testRate(report: ReportCard): number {
  return rate(report.test.score);
}

export function comparisonRows(reports: readonly ReportCard[], runId: string): ComparisonRow[] {
  const bare = reports.find((report) => report.method === 'bare');
  return [...reports]
    .sort((a, b) => METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method))
    .map((report) => ({
      runId: report.runId,
      method: report.method,
      label: METHOD_LABELS[report.method],
      testRate: testRate(report),
      vsBare: bare ? testRate(report) - testRate(bare) : null,
      mentorUsd: report.cost.mentorUsd,
      rounds: report.cost.rounds,
      current: report.runId === runId,
    }));
}

/** "+28 pts", "−4 pts", "0 pts". */
export function formatPoints(points: number): string {
  const rounded = Math.round(points);
  if (rounded > 0) return `+${rounded} pts`;
  if (rounded < 0) return `−${Math.abs(rounded)} pts`;
  return '0 pts';
}
