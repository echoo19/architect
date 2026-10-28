import type { ReportCard } from '@architect/shared';
import { formatAnswerTime } from '../format';

/** The requirements the graduate missed, in words; empty only when it met every one. */
export function missedRequirements(report: ReportCard): string[] {
  const { passRate, p95LatencyMs } = report.requirements;
  const missed: string[] = [];
  if (!passRate.met) {
    const actual = Math.round(passRate.actual * 100);
    const target = Math.round(passRate.target * 100);
    // On a short test a target is a count of tasks; say it, since 95% of 6 is all 6.
    const total = report.test?.score.total;
    const needed = total ? Math.ceil(passRate.target * total - 1e-9) : null;
    missed.push(
      needed === null
        ? `task success (${actual}%, needs ${target}%)`
        : `task success (${report.test.score.pass} of ${total}, ${actual}%; needs ${target}%, which is ${needed} of ${total})`,
    );
  }
  if (p95LatencyMs && !p95LatencyMs.met) {
    const actual = formatAnswerTime(p95LatencyMs.actual);
    const target = formatAnswerTime(p95LatencyMs.target);
    missed.push(`answer time (slowest ${actual}, needs under ${target})`);
  }
  return missed;
}
