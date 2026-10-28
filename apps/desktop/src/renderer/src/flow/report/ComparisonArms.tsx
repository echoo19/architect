import type { ComparisonReport, Spend, StudentTarget } from '@architect/shared';
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
import { formatBytes } from '../../lib/format';
import { formatCost, formatRate } from '../format';
import type { ModelNames } from '../train/phase';
import { reportArms, type ArmScore, type ReportArm } from './comparison-report';

const percentOf = (share: number) => Math.round(share * 100);

/** The score on the same kind of copy as the report's own final test, else the other one. */
function scoreOn(
  arm: ReportArm,
  testedOn: StudentTarget,
): { score: ArmScore; where: string } | null {
  const own = testedOn === 'hosted' ? arm.hosted : arm.local;
  const other = testedOn === 'hosted' ? arm.local : arm.hosted;
  if (own) return { score: own, where: '' };
  if (other) return { score: other, where: testedOn === 'hosted' ? 'on this computer' : 'online' };
  return null;
}

/** What an arm spent in all, with "at most" while a training job could still cost more. */
function costOf(spent: Spend): string {
  const total = spent.sparkUsd + (spent.studentUsd ?? 0) + spent.computeUsd;
  return `${spent.computeSettled ? '' : 'at most '}${formatCost(total)}`;
}

/** "58 of 60", said as partial when fewer tasks ran than the test holds. */
function counts(score: ArmScore): string {
  return `${score.pass} of ${score.total}${score.complete ? '' : ', partial'}`;
}

/**
 * What an arm's row leaves out of the table, said once under Details: how sure the score is, the
 * same test run again, the other copy's result, the same setup without its trained weights, and
 * the memory a meter saw.
 */
function extras(arm: ReportArm, testedOn: StudentTarget): string[] {
  const shown = scoreOn(arm, testedOn);
  const other = testedOn === 'hosted' ? arm.local : arm.hosted;
  const facts = [
    shown?.score.range &&
      `likely ${percentOf(shown.score.range.low)} to ${percentOf(shown.score.range.high)}%`,
    shown &&
      other &&
      shown.where === '' &&
      `${testedOn === 'hosted' ? 'on this computer' : 'online'}: ${counts(other)}`,
    shown?.score.repeat &&
      `tested again: ${shown.score.repeat.pass} of ${shown.score.repeat.total}${shown.score.repeat.complete ? '' : ', partial'}`,
    shown?.score.without &&
      `without the weights: ${shown.score.without.pass} of ${shown.score.without.total}`,
    arm.memory &&
      [
        arm.memory.processBytes !== null && `${formatBytes(arm.memory.processBytes)} of RAM`,
        arm.memory.gpuBytes !== null && `${formatBytes(arm.memory.gpuBytes)} of GPU memory`,
      ]
        .filter(Boolean)
        .join(' and '),
  ].filter((fact): fact is string => typeof fact === 'string' && fact !== '');
  return facts;
}

/** The arms a first look needs: the untouched student, this agent and Spark doing the tasks itself. */
function isHeadline(arm: ReportArm): boolean {
  return arm.arm === 'bare' || arm.arm === 'reference' || arm.current;
}

function Rows({
  arms,
  testedOn,
  label,
}: {
  arms: readonly ReportArm[];
  testedOn: StudentTarget;
  label: string;
}) {
  return (
    <div className="rounded-xl bg-panel">
      <Table aria-label={label}>
        <TableHeader>
          <TableRow>
            <TableHead />
            <TableHead className="whitespace-nowrap text-right">
              <EvidenceMark kind="final" className="justify-end">
                Final test
              </EvidenceMark>
            </TableHead>
            <TableHead className="whitespace-nowrap text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {arms.map((arm) => {
            const shown = scoreOn(arm, testedOn);
            return (
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
                        {arm.status === 'stopped' ? 'Stopped' : 'Not finished'}
                        {arm.reason && `: ${arm.reason}`}
                      </span>
                    )}
                  </span>
                </TableCell>
                {arm.status === 'not_run' ? (
                  <TableCell colSpan={2} className="align-top text-fg-faint text-pretty">
                    Not run{arm.reason && `: ${arm.reason}`}
                  </TableCell>
                ) : (
                  <>
                    <TableCell className="text-right align-top">
                      {shown === null ? (
                        <span className="text-fg-faint">Not run</span>
                      ) : (
                        <span className="flex flex-col items-end">
                          <span className="font-mono tabular-nums text-fg">
                            {formatRate(shown.score)}
                          </span>
                          <span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">
                            {counts(shown.score)}
                            {shown.where && `, ${shown.where}`}
                          </span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right align-top font-mono tabular-nums">
                      {costOf(arm.spent)}
                    </TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * The comparisons runner's report for the job this run belongs to (decision 045), in a table that
 * fits its page: the untouched student, this agent and Spark doing the tasks itself, each with its
 * final test and what it cost in all. The other arms, how sure each score is, a test run again
 * and the memory a meter saw wait under their own disclosures. An arm that wasn't run says so with
 * its reason. A dry run on fakes keeps its label, since that is what it is.
 */
export function ComparisonArms({
  report,
  runId,
  names,
  testedOn,
}: {
  report: ComparisonReport;
  runId: string;
  names: ModelNames;
  /** Where this run's own final test ran, so its row reads the same figure as the stats above. */
  testedOn: StudentTarget;
}) {
  const arms = reportArms(report, runId, names);
  const main = arms.filter(isHeadline);
  const more = arms.filter((arm) => !isHeadline(arm));
  const notes = arms
    .map((arm) => ({ arm, facts: extras(arm, testedOn) }))
    .filter(({ facts }) => facts.length > 0);
  return (
    <section aria-labelledby="comparisons" className="flex flex-col gap-[18px]">
      <div className="flex flex-wrap items-center gap-3">
        <Heading id="comparisons">Comparisons</Heading>
        {report.dryRun && <Badge>Dry run on fakes, no model called</Badge>}
      </div>
      <Rows arms={main} testedOn={testedOn} label="Comparisons" />
      {more.length > 0 && (
        <Disclosure
          label={`${more.length} more ${more.length === 1 ? 'comparison' : 'comparisons'}`}
        >
          <Rows arms={more} testedOn={testedOn} label="More comparisons" />
        </Disclosure>
      )}
      {(notes.length > 0 || report.disclosures.length > 0) && (
        <Disclosure label="Details">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-fg-secondary">
            {notes.map(({ arm, facts }) => (
              <li key={arm.arm} className="text-pretty">
                {arm.label}: {facts.join(', ')}.
              </li>
            ))}
            {report.disclosures.map((line) => (
              <li key={line} className="text-pretty text-fg-muted">
                {line}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}
