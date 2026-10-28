import type { Score } from '@architect/shared';
import {
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
import { wasRun, type Arm, type ArmKey } from './arms';

/** Each comparison named for what the student ran with, in the job's own model names. */
function armLabel(key: ArmKey, { mentor, student }: ModelNames): string {
  switch (key) {
    case 'untouched':
      return `${student}, untouched`;
    case 'setup':
      return `${student} with the setup`;
    case 'weights':
      return `${student} with trained weights`;
    case 'both':
      return `${student} with both`;
    case 'mentor':
      return `${mentor} itself`;
  }
}

/** "78%" over "14 of 18": rates compare across rows, the counts say what each rests on. */
function ScoreCell({ score }: { score: Score | null }) {
  if (score === null) return <span className="text-fg-faint">Not run</span>;
  return (
    <span className="flex flex-col items-end">
      <span className="font-mono tabular-nums text-fg">{formatRate(score)}</span>
      <span className="text-xs tabular-nums text-fg-muted">
        {score.pass} of {score.total}
      </span>
    </span>
  );
}

/**
 * The student with and without the setup and trained weights, and Spark on the same tasks,
 * where their records exist. A comparison that wasn't run says so and shows nothing else.
 */
export function Comparisons({ arms, names }: { arms: readonly Arm[]; names: ModelNames }) {
  return (
    <section aria-labelledby="comparisons" className="flex flex-col gap-[18px]">
      <Heading id="comparisons">Comparisons</Heading>
      <div className="rounded-xl bg-panel">
        <Table aria-label="Comparisons">
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead className="text-right">
                <EvidenceMark kind="check" className="justify-end">
                  Check tasks
                </EvidenceMark>
              </TableHead>
              <TableHead className="text-right">
                <EvidenceMark kind="final" className="justify-end">
                  Final test
                </EvidenceMark>
              </TableHead>
              <TableHead className="text-right">{names.mentor}</TableHead>
              <TableHead className="text-right">Compute</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {arms.map((arm) => {
              const run = wasRun(arm);
              return (
                <TableRow key={arm.key} aria-current={arm.current ? 'true' : undefined}>
                  <TableCell>
                    <span className={arm.current ? 'font-medium' : undefined}>
                      {armLabel(arm.key, names)}
                    </span>
                    {arm.current && <span className="text-fg-muted"> · this agent</span>}
                  </TableCell>
                  {run ? (
                    <>
                      <TableCell className="text-right">
                        <ScoreCell score={arm.check} />
                      </TableCell>
                      <TableCell className="text-right">
                        <ScoreCell score={arm.final} />
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {arm.budget ? formatCost(arm.budget.mentorUsd) : '–'}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {arm.budget
                          ? `${formatCost(arm.budget.computeUsd)}${arm.budget.computeMinutes > 0 ? ` · ${Math.round(arm.budget.computeMinutes)} min` : ''}`
                          : '–'}
                      </TableCell>
                    </>
                  ) : (
                    <TableCell colSpan={4} className="text-right text-fg-faint">
                      Not run
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
