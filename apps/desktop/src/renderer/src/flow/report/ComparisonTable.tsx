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
import { useQuery } from '../../api/query';
import { formatUsd } from '../../lib/format';
import { comparisonPeers, comparisonRows, formatPoints } from './comparison';

async function loadComparison(report: ReportCard) {
  const peers = comparisonPeers(await flowApi.runs(report.jobId), report.runId);
  const reports = await Promise.all(
    peers.map((run) => (run.id === report.runId ? report : api.report(run.id))),
  );
  return comparisonRows(reports, report.runId);
}

/** This run beside the baselines trained on the same job and seed, when they have finished. */
export function ComparisonTable({ report, mentor }: { report: ReportCard; mentor: string }) {
  const rows = useQuery(`comparison:${report.runId}`, () => loadComparison(report));
  if (rows.status === 'success' && rows.data.length === 0) return null;
  return (
    <section aria-labelledby="comparison" className="flex flex-col gap-[18px]">
      <Heading id="comparison">Compared with the baselines</Heading>
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
                <TableHead className="text-right">Versus bare student</TableHead>
                <TableHead className="text-right">{mentor} cost</TableHead>
                <TableHead className="text-right">Rounds</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.data.map((row) => (
                <TableRow key={row.runId} aria-current={row.current ? 'true' : undefined}>
                  <TableCell className={row.current ? 'font-medium' : undefined}>
                    {row.label}
                    {row.current && <span className="text-fg-muted"> · this run</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono">
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
