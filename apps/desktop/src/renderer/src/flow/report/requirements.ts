import type { ReportCard } from '@architect/shared';
import { formatAnswerTime } from '../format';

/**
 * What the graduate missed, as clauses of a sentence; empty only when it met every requirement.
 * On a short test a target is a count of tasks, so it says that: 95% of 6 is all 6.
 */
export function missedRequirements(report: ReportCard): string[] {
  const { passRate, p95LatencyMs } = report.requirements;
  const missed: string[] = [];
  if (!passRate.met) {
    const target = Math.round(passRate.target * 100);
    const total = report.test?.score.total;
    const needed = total ? Math.ceil(passRate.target * total - 1e-9) : null;
    const count = needed === total ? `all ${total}` : `${needed} of ${total}`;
    missed.push(
      needed === null
        ? `${Math.round(passRate.actual * 100)}% right, and the job needs ${target}%`
        : `${report.test.score.pass} of ${total} right, and the job needs ${target}%, which is ${count}`,
    );
  }
  if (p95LatencyMs && !p95LatencyMs.met) {
    const actual = formatAnswerTime(p95LatencyMs.actual);
    const target = formatAnswerTime(p95LatencyMs.target);
    missed.push(`its slowest answers took ${actual}, and the job wants them under ${target}`);
  }
  return missed;
}
