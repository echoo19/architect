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
import { formatBytes } from '../../lib/format';
import { formatCost, formatRate } from '../format';
import type { ModelNames } from '../train/phase';
import { wasRun, type Arm, type ArmKey } from './arms';

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
 * "78%" over "14 of 18, 2 runs": rates compare across rows, the counts say what each rests on.
 * A score over more than one run of the check tasks says how many.
 */
function ScoreCell({ score, perRun }: { score: Score | null; perRun?: number | undefined }) {
  if (score === null) return <span className="text-fg-faint">Not run</span>;
  const runs = perRun && score.total > perRun ? Math.round(score.total / perRun) : 1;
  return (
    <span className="flex flex-col items-end">
      <span className="font-mono tabular-nums text-fg">{formatRate(score)}</span>
      <span className="text-xs tabular-nums text-fg-muted">
        {score.pass} of {score.total}
        {runs > 1 && `, ${runs} runs`}
      </span>
    </span>
  );
}

/** The most memory a meter saw over a final test here, process and GPU; nothing where none ran. */
export function PeakMemory({
  processBytes,
  gpuBytes,
}: {
  processBytes: number | null;
  gpuBytes: number | null;
}) {
  if (processBytes === null && gpuBytes === null) return null;
  // Two different memories, each named: the model server's own, and the graphics card's.
  return (
    <span className="flex flex-col items-end gap-0.5 text-xs tabular-nums text-fg-muted">
      {processBytes !== null && (
        <span className="whitespace-nowrap">
          RAM <span className="font-mono text-sm text-fg">{formatBytes(processBytes)}</span>
        </span>
      )}
      {gpuBytes !== null && (
        <span className="whitespace-nowrap">
          GPU <span className="font-mono text-sm text-fg">{formatBytes(gpuBytes)}</span>
        </span>
      )}
    </span>
  );
}

/**
 * The student with and without the setup and trained weights, and Spark on the same tasks,
 * where their records exist. A comparison that wasn't run says so and shows nothing else.
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
  // Memory has a column only once a meter read some arm's final test here.
  const metered = arms.some((arm) => arm.memory !== null);
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
              {metered && (
                <TableHead className="whitespace-nowrap text-right">Peak memory</TableHead>
              )}
              <TableHead className="whitespace-nowrap text-right">
                {names.mentor}&apos;s cost
              </TableHead>
              <TableHead className="whitespace-nowrap text-right">Compute cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {arms.map((arm) => {
              const run = wasRun(arm);
              return (
                <TableRow key={arm.key} aria-current={arm.current ? 'true' : undefined}>
                  <TableCell>
                    <span className={arm.current ? 'font-medium' : undefined}>
                      {armLabel(arm.key, names, blankStart)}
                    </span>
                    {arm.current && (
                      <span className="whitespace-nowrap text-fg-muted"> · this agent</span>
                    )}
                  </TableCell>
                  {run ? (
                    <>
                      <TableCell className="text-right">
                        <ScoreCell score={arm.check} perRun={checkTasks} />
                      </TableCell>
                      <TableCell className="text-right">
                        <ScoreCell score={arm.final} />
                      </TableCell>
                      {metered && (
                        <TableCell className="text-right">
                          {arm.memory && (
                            <PeakMemory
                              processBytes={arm.memory.peakProcessBytes}
                              gpuBytes={arm.memory.peakGpuBytes}
                            />
                          )}
                        </TableCell>
                      )}
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
                    <TableCell colSpan={metered ? 5 : 4} className="text-fg-faint">
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
