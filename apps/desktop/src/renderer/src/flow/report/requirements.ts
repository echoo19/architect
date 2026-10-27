import type { ReportCard } from '@architect/shared';
import { formatAnswerTime } from '../format';

/** The requirements the graduate missed, in words; empty only when it met every one. */
export function missedRequirements(report: ReportCard): string[] {
  const { passRate, p95LatencyMs } = report.requirements;
  const missed: string[] = [];
  if (!passRate.met) {
    const actual = Math.round(passRate.actual * 100);
    const target = Math.round(passRate.target * 100);
    missed.push(`task success (${actual}%, needs ${target}%)`);
  }
  if (p95LatencyMs && !p95LatencyMs.met) {
    const actual = formatAnswerTime(p95LatencyMs.actual);
    const target = formatAnswerTime(p95LatencyMs.target);
    missed.push(`answer time (slowest ${actual}, needs under ${target})`);
  }
  return missed;
}
