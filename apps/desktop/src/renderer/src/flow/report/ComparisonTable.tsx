import type { ReportCard } from '@architect/shared';
import { Skeleton } from '@architect/ui';
import { api, flowApi } from '../../api/client';
import { useQuery, type QueryState } from '../../api/query';
import { ProblemState } from '../../components/ProblemState';
import { formatUsd } from '../../lib/format';
import { Section } from '../ledger';
import type { ModelNames } from '../train/phase';
import {
  comparisonPeers,
  comparisonRows,
  formatPoints,
  methodExplanation,
  type ComparisonRow,
} from './comparison';

async function loadComparison(report: ReportCard): Promise<ComparisonRow[]> {
  const peers = comparisonPeers(await flowApi.runs(report.jobId), report.runId);
  const reports = await Promise.all(
    peers.map((run) => (run.id === report.runId ? report : api.report(run.id))),
  );
  return comparisonRows(reports, report.runId);
}

/**
 * This run beside the baselines trained on the same job and seed. Nothing is loaded unless
 * comparison mode is on, so the report never waits on runs it won't show.
 */
export function useComparison(report: ReportCard, enabled: boolean): QueryState<ComparisonRow[]> {
  return useQuery(`comparison:${report.runId}:${enabled ? 'on' : 'off'}`, () =>
    enabled ? loadComparison(report) : Promise.resolve([]),
  );
}

export function ComparisonTable({
  rows,
  names,
}: {
  rows: QueryState<ComparisonRow[]>;
  names: ModelNames;
}) {
  if (rows.status === 'success' && rows.data.length === 0) return null;
  return (
    <Section title="Compared with simpler methods" id="comparison">
      {rows.status === 'loading' && (
        <div aria-busy="true" aria-label="Loading the comparison">
          <Skeleton className="h-[188px] w-full rounded-control" />
        </div>
      )}
      {rows.status === 'error' && (
        <ProblemState
          layout="inline"
          error={rows.error}
          title="Couldn't load the comparison"
          onRetry={rows.reload}
        />
      )}
      {rows.status === 'success' && (
        <div className="overflow-x-auto border-b border-line">
          <table
            aria-label="Compared with simpler methods"
            className="w-full min-w-[640px] border-collapse text-ui"
          >
            <thead>
              <tr className="text-small">
                <th className="pb-3 text-left font-normal">Method</th>
                <th className="pb-3 pl-6 text-right font-normal">Final test</th>
                <th className="pb-3 pl-6 text-right font-normal">vs. no setup</th>
                <th className="pb-3 pl-6 text-right font-normal">{names.mentor} cost</th>
                <th className="pb-3 pl-6 text-right font-normal">Rounds</th>
              </tr>
            </thead>
            <tbody>
              {rows.data.map((row) => (
                <tr
                  key={row.runId}
                  aria-current={row.current ? 'true' : undefined}
                  className="border-t border-line"
                >
                  <th scope="row" className="py-3.5 pr-4 text-left font-normal">
                    <span className="flex flex-col gap-0.5">
                      <span className={row.current ? 'font-medium' : undefined}>
                        {row.label}
                        {row.current && <span> · this training</span>}
                      </span>
                      <span className="text-small">{methodExplanation(row.method, names)}</span>
                    </span>
                  </th>
                  <td className="py-3.5 pl-6 text-right align-middle font-mono font-medium tabular-nums">
                    {Math.round(row.testRate)}%
                  </td>
                  <td className="py-3.5 pl-6 text-right align-middle font-mono tabular-nums">
                    {row.vsBare === null || row.method === 'bare' ? '–' : formatPoints(row.vsBare)}
                  </td>
                  <td className="py-3.5 pl-6 text-right align-middle font-mono tabular-nums">
                    {formatUsd(row.mentorUsd)}
                  </td>
                  <td className="py-3.5 pl-6 text-right align-middle font-mono tabular-nums">
                    {row.rounds}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
