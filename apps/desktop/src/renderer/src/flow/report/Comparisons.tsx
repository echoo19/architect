import type { Score } from '@architect/shared';
import {
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
import { armCost, notRunReason, wasRun, type Arm, type ArmKey } from './arms';

/**
 * Each comparison named for what the student ran with, in the job's own model names. Without a
 * blank start, the student before any change still had the setup the run started from.
 */
function armLabel(key: ArmKey, { mentor, student }: ModelNames, blankStart: boolean): string {
  switch (key) {
    case 'untouched':
      return blankStart ? `${student}, untouched` : `${student} with the starting setup`;
    case 'setup':
      return `${student} with ${mentor}'s setup`;
    case 'weights':
      return `${student} with trained weights`;
    case 'both':
      return `${student} with both`;
    case 'mentor':
      return `${mentor} doing the tasks itself`;
  }
}

/**
 * "78%" over "14 of 18": rates compare across rows, the counts say what each rests on. A score
 * over more than one run of the check tasks says how many.
 */
function ScoreCell({ score, perRun }: { score: Score | null; perRun?: number | undefined }) {
  if (score === null) return <span className="text-fg-faint">Not run</span>;
  const runs = perRun && score.total > perRun ? Math.round(score.total / perRun) : 1;
  return (
    <span className="flex flex-col items-end">
      <span className="font-mono tabular-nums text-fg">{formatRate(score)}</span>
      <span className="whitespace-nowrap text-xs tabular-nums text-fg-muted">
        {score.pass} of {score.total}
        {runs > 1 && `, ${runs} runs`}
      </span>
    </span>
  );
}

/** The most memory a meter saw over a final test here, process and GPU, in a few words. */
function memoryLine(processBytes: number | null, gpuBytes: number | null): string {
  return [
    processBytes !== null && `${formatBytes(processBytes)} of RAM`,
    gpuBytes !== null && `${formatBytes(gpuBytes)} of GPU memory`,
  ]
    .filter(Boolean)
    .join(' and ');
}

/**
 * The student untouched, with the setup and trained weights it has, and Spark on the same tasks,
 * where their records exist: three rows and a cost for each that adds up. A comparison that has
 * no record is named under "Not measured" with what its records lack, never inferred.
 */
export function Comparisons({
  arms,
  names,
  blankStart,
  checkTasks,
}: {
  arms: readonly Arm[];
  names: ModelNames;
  /** The run began with no setup, so the student before any change was untouched. */
  blankStart: boolean;
  /** How many check tasks one run has, to say when a score adds up more than one. */
  checkTasks: number | undefined;
}) {
  const measured = arms.filter(wasRun);
  const unmeasured = arms.filter((arm) => !wasRun(arm));
  const metered = measured.filter((arm) => arm.memory !== null);
  return (
    <section aria-labelledby="comparisons" className="flex flex-col gap-[18px]">
      <Heading id="comparisons">Comparisons</Heading>
      <div className="rounded-xl bg-panel">
        <Table aria-label="Comparisons">
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead className="whitespace-nowrap text-right">
                <EvidenceMark kind="check" className="justify-end">
                  Check tasks
                </EvidenceMark>
              </TableHead>
              <TableHead className="whitespace-nowrap text-right">
                <EvidenceMark kind="final" className="justify-end">
                  Final test
                </EvidenceMark>
              </TableHead>
              <TableHead className="whitespace-nowrap text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {measured.map((arm) => (
              <TableRow key={arm.key} aria-current={arm.current ? 'true' : undefined}>
                <TableCell>
                  <span className={arm.current ? 'font-medium' : undefined}>
                    {armLabel(arm.key, names, blankStart)}
                  </span>
                  {arm.current && (
                    <span className="whitespace-nowrap text-fg-muted"> · this agent</span>
                  )}
                </TableCell>
                <TableCell className="text-right align-top">
                  <ScoreCell score={arm.check} perRun={checkTasks} />
                </TableCell>
                <TableCell className="text-right align-top">
                  <ScoreCell score={arm.final} />
                </TableCell>
                <TableCell className="text-right align-top font-mono tabular-nums">
                  {arm.budget ? formatCost(armCost(arm.budget)) : '–'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {(unmeasured.length > 0 || metered.length > 0) && (
        <Disclosure label="Details">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-fg-secondary">
            {metered.map((arm) => (
              <li key={arm.key} className="text-pretty">
                {armLabel(arm.key, names, blankStart)} used at most{' '}
                {memoryLine(arm.memory?.peakProcessBytes ?? null, arm.memory?.peakGpuBytes ?? null)}{' '}
                in its final test.
              </li>
            ))}
            {unmeasured.map((arm) => (
              <li key={arm.key} className="text-pretty text-fg-muted">
                {armLabel(arm.key, names, blankStart)} wasn&apos;t measured
                {notRunReason(arm.key, names.mentor) && `: ${notRunReason(arm.key, names.mentor)}`}.
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}
