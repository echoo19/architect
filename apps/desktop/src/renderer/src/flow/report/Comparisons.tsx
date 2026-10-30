import type { Score } from '@architect/shared';
import { Disclosure, EvidenceMark } from '@architect/ui';
import { formatBytes } from '../../lib/format';
import { formatCost, formatRate } from '../format';
import { Section } from '../ledger';
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
 * "78%" and "14 of 18" on one line: rates compare across rows, the counts say what each rests on.
 * A score over more than one run of the check tasks says how many.
 */
function ScoreCell({ score, perRun }: { score: Score | null; perRun?: number | undefined }) {
  if (score === null) return <span>Not run</span>;
  const runs = perRun && score.total > perRun ? Math.round(score.total / perRun) : 1;
  return (
    <span className="inline-flex items-baseline justify-end gap-3 whitespace-nowrap tabular-nums">
      <span className="font-mono font-medium">{formatRate(score)}</span>
      <span className="text-small">
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
    <Section title="Comparisons" id="comparisons">
      <div className="overflow-x-auto border-b border-line">
        <table aria-label="Comparisons" className="w-full min-w-[560px] border-collapse text-ui">
          <thead>
            <tr className="text-small">
              <th className="pb-3" />
              <th className="whitespace-nowrap pb-3 pl-6 text-right font-normal">
                <EvidenceMark kind="check" className="justify-end">
                  Check tasks
                </EvidenceMark>
              </th>
              <th className="whitespace-nowrap pb-3 pl-6 text-right font-normal">
                <EvidenceMark kind="final" className="justify-end">
                  Final test
                </EvidenceMark>
              </th>
              <th className="whitespace-nowrap pb-3 pl-6 text-right font-normal">Cost</th>
            </tr>
          </thead>
          <tbody>
            {measured.map((arm) => (
              <tr
                key={arm.key}
                aria-current={arm.current ? 'true' : undefined}
                className="border-t border-line"
              >
                <th scope="row" className="py-3.5 pr-4 text-left font-normal">
                  <span className={arm.current ? 'font-medium' : undefined}>
                    {armLabel(arm.key, names, blankStart)}
                  </span>
                  {arm.current && <span className="whitespace-nowrap"> · this agent</span>}
                </th>
                <td className="py-3.5 pl-6 text-right align-middle">
                  <ScoreCell score={arm.check} perRun={checkTasks} />
                </td>
                <td className="py-3.5 pl-6 text-right align-middle">
                  <ScoreCell score={arm.final} />
                </td>
                <td className="py-3.5 pl-6 text-right align-middle font-mono tabular-nums">
                  {arm.budget ? formatCost(armCost(arm.budget)) : '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(unmeasured.length > 0 || metered.length > 0) && (
        <Disclosure label="Details" className="pt-2">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small">
            {metered.map((arm) => (
              <li key={arm.key} className="text-pretty">
                {armLabel(arm.key, names, blankStart)} used at most{' '}
                {memoryLine(arm.memory?.peakProcessBytes ?? null, arm.memory?.peakGpuBytes ?? null)}{' '}
                in its final test.
              </li>
            ))}
            {unmeasured.map((arm) => (
              <li key={arm.key} className="text-pretty">
                {armLabel(arm.key, names, blankStart)} wasn&apos;t measured
                {notRunReason(arm.key, names.mentor) && `: ${notRunReason(arm.key, names.mentor)}`}.
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </Section>
  );
}
