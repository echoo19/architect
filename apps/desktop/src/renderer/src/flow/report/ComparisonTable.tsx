import type { ReportCard } from '@architect/shared';
import {
  ErrorState,
  Heading,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { api, flowApi } from '../../api/client';
import { useQuery, type QueryState } from '../../api/query';
import { formatUsd } from '../../lib/format';
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
    <section aria-labelledby="comparison" className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <Heading id="comparison">Compared with simpler ways to build it</Heading>
        <p className="m-0 text-fg-secondary text-pretty">
          The same job, budget and final test, built three simpler ways. Points are the difference
          in final test score from {names.student} with no setup.
        </p>
      </div>
      {rows.status === 'loading' && (
        <div aria-busy="true" aria-label="Loading the comparison">
          <Skeleton className="h-[188px] w-full rounded-xl" />
        </div>
      )}
      {rows.status === 'error' && (
        <ErrorState
          layout="inline"
          title="Couldn't load the comparison"
          message={rows.error.message}
          onRetry={rows.reload}
        />
      )}
      {rows.status === 'success' && (
        <div className="rounded-xl bg-panel">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Final test</TableHead>
                <TableHead className="text-right">Versus no setup</TableHead>
                <TableHead className="text-right">{names.mentor} cost</TableHead>
                <TableHead className="text-right">Rounds</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.data.map((row) => (
                <TableRow key={row.runId} aria-current={row.current ? 'true' : undefined}>
                  <TableCell>
                    <span className="flex flex-col gap-0.5">
                      <span className={row.current ? 'font-medium' : undefined}>
                        {row.label}
                        {row.current && <span className="text-fg-muted"> · this run</span>}
                      </span>
                      <span className="text-sm text-fg-muted">
                        {methodExplanation(row.method, names)}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium text-fg">
                    {Math.round(row.testRate)}%
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {row.vsBare === null || row.method === 'bare' ? '–' : formatPoints(row.vsBare)}
                  </TableCell>
                  <TableCell className="text-right font-mono">{formatUsd(row.mentorUsd)}</TableCell>
                  <TableCell className="text-right font-mono">{row.rounds}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
