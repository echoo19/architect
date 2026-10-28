import type { ComparisonReport, Spend } from '@architect/shared';
import {
  Badge,
  Disclosure,
  EvidenceMark,
  Heading,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { formatCost, formatRate } from '../format';
import type { ModelNames } from '../train/phase';
import { reportArms, type ArmScore, type ReportArm } from './comparison-report';
import { PeakMemory } from './Comparisons';

const STATUS_WORDS: Record<Exclude<ReportArm['status'], 'complete'>, string> = {
  stopped: 'Stopped',
  incomplete: 'Not finished',
  not_run: 'Not run',
};

const percentOf = (share: number) => Math.round(share * 100);

/**
 * "45%" over "27 of 60", the range the true rate likely sits in, a partial test said as such,
 * and the result when the same test ran a second time.
 */
function ScoreCell({ score }: { score: ArmScore | null }) {
  if (score === null) return <span className="text-fg-faint">Not run</span>;
  return (
    <span className="flex flex-col items-end">
      <span className="font-mono tabular-nums text-fg">{formatRate(score)}</span>
      <span className="text-xs tabular-nums text-fg-muted">
        {score.pass} of {score.total}
        {!score.complete && ', partial'}
      </span>
      {score.range && (
        <span
          title="95% interval: the rate the test points to, allowing for chance"
          className="whitespace-nowrap text-xs tabular-nums text-fg-muted"
        >
          likely {percentOf(score.range.low)} to {percentOf(score.range.high)}%
        </span>
      )}
      {score.repeat && (
        <span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">
          tested again: {score.repeat.pass} of {score.repeat.total}
        </span>
      )}
    </span>
  );
}

/**
 * What an arm spent, one bill a line: Spark, the student's hosted copy, and compute, which is
 * the most it may cost while a training job can still run.
 */
function Costs({ spent, names, host }: { spent: Spend; names: ModelNames; host: string }) {
  const line = (label: string, amount: string) => (
    <span className="whitespace-nowrap">
      <span className="text-xs text-fg-muted">{label}</span>{' '}
      <span className="font-mono tabular-nums text-fg">{amount}</span>
    </span>
  );
  const compute = `${spent.computeSettled ? '' : 'at most '}${formatCost(spent.computeUsd)}`;
  const minutes =
    spent.computeMinutes >= 0.5
      ? ` · ${Math.round(spent.computeMinutes)} min`
      : spent.computeMinutes > 0
        ? ' · under 1 min'
        : '';
  return (
    <span className="flex flex-col items-end gap-0.5 text-sm">
      {line(names.mentor, formatCost(spent.sparkUsd))}
      {line(host, spent.studentUsd === null ? '–' : formatCost(spent.studentUsd))}
      {line('Compute', `${compute}${minutes}`)}
    </span>
  );
}

/**
 * The comparisons runner's report for the job this run belongs to (decision 045): each arm's
 * final test on the hosted copy and on this computer, the memory a meter saw here, and what it
 * spent, from the report alone. An arm that wasn't run says so, with the reason.
 */
export function ComparisonArms({
  report,
  runId,
  names,
  host,
}: {
  report: ComparisonReport;
  runId: string;
  names: ModelNames;
  /** Who serves the hosted copy of the student, as its bill names it, such as "OpenRouter". */
  host: string;
}) {
  const arms = reportArms(report, runId, names);
  return (
    <section aria-labelledby="comparisons" className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-3">
        <Heading id="comparisons">Comparisons</Heading>
        {report.dryRun && <Badge>Dry run on fakes</Badge>}
      </div>
      <div className="overflow-x-auto rounded-xl bg-panel">
        <Table aria-label="Comparisons" className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead className="whitespace-nowrap text-right">
                <EvidenceMark kind="final" className="justify-end">
                  Hosted copy
                </EvidenceMark>
              </TableHead>
              <TableHead className="whitespace-nowrap text-right">
                <EvidenceMark kind="final" className="justify-end">
                  This computer
                </EvidenceMark>
              </TableHead>
              <TableHead className="whitespace-nowrap text-right">Peak memory</TableHead>
              <TableHead className="whitespace-nowrap text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {arms.map((arm) => (
              <TableRow key={arm.arm} aria-current={arm.current ? 'true' : undefined}>
                <TableCell className="align-top">
                  <span className="flex flex-col gap-0.5">
                    <span>
                      <span className={arm.current ? 'font-medium' : undefined}>{arm.label}</span>
                      {arm.current && (
                        <span className="whitespace-nowrap text-fg-muted"> · this agent</span>
                      )}
                    </span>
                    {arm.status !== 'complete' && arm.status !== 'not_run' && (
                      <span className="text-xs text-fg-muted text-pretty">
                        {STATUS_WORDS[arm.status]}
                        {arm.reason && `: ${arm.reason}`}
                      </span>
                    )}
                  </span>
                </TableCell>
                {arm.status === 'not_run' ? (
                  <TableCell colSpan={4} className="align-top text-fg-faint text-pretty">
                    Not run{arm.reason && `: ${arm.reason}`}
                  </TableCell>
                ) : (
                  <>
                    <TableCell className="text-right align-top">
                      {arm.arm === 'repeat' ? null : <ScoreCell score={arm.hosted} />}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {arm.arm === 'repeat' ? null : <ScoreCell score={arm.local} />}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {arm.memory && (
                        <PeakMemory
                          processBytes={arm.memory.processBytes}
                          gpuBytes={arm.memory.gpuBytes}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right align-top">
                      <Costs spent={arm.spent} names={names} host={host} />
                    </TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {report.disclosures.length > 0 && (
        <Disclosure label="Notes on these numbers">
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-sm text-fg-secondary">
            {report.disclosures.map((line) => (
              <li key={line} className="text-pretty">
                {line}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}
