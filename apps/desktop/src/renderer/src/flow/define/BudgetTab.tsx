import { studentPricing, type Job, type StudentTarget } from '@architect/shared';
import { CapMeter } from '@architect/ui';
import { formatUsd } from '../../lib/format';
import { modelNames } from '../names';
import { estimateTime, planBills, roughUsd, shortDuration, sumKnown } from './estimates';
import { Group, NumberField } from './fields';
import type { InspectorTabProps } from './inspector-tabs';
import { TYPING_PAUSE_MS } from './use-job-editor';

interface BudgetTabProps extends InspectorTabProps {
  /** Where the run's final test will run, which decides whether the online copy bills it. */
  testPlace: StudentTarget;
}

/** An estimate as the meters show it, rounded as the page's estimate is. */
const usd = (amount: number) => formatUsd(roughUsd(amount));

/**
 * What the run is expected to spend against each cap, and the caps: the teacher's dollars, the
 * dollars of training compute, and the time. The agent's online copy has no cap of its own, so
 * its expected bill stands alone, with no meter. Every cap is a hard stop.
 */
export function BudgetTab({ editor, change, testPlace }: BudgetTabProps) {
  const { job, issues } = editor;
  const { mentor, student } = modelNames(job);
  const estimate = estimateTime(job, job.student.trainOn);
  const pricing = job.student.hosted ? (studentPricing(job.student.hosted) ?? null) : null;
  const bills = planBills(job, estimate, pricing, false, testPlace).total;
  const online = sumKnown([bills.hostedUsd, bills.testUsd]);
  const budget = (what: string, patch: Partial<Job['budget']>) =>
    change(
      what,
      (current) => ({ ...current, budget: { ...current.budget, ...patch } }),
      TYPING_PAUSE_MS,
    );
  return (
    <div className="flex flex-col gap-6">
      <Group title="Expected">
        <div className="flex flex-col gap-5 pt-2">
          {bills.mentorUsd === null ? (
            <CapMeter label={mentor} used={0} format={() => 'No price on file'} tone="mentor" />
          ) : (
            <CapMeter
              label={mentor}
              used={roughUsd(bills.mentorUsd)}
              cap={job.budget.maxMentorUsd}
              format={formatUsd}
              tone="mentor"
            />
          )}
          <CapMeter
            label={`${student} online`}
            used={online ?? 0}
            format={(amount) => (online === null ? 'None' : usd(amount))}
            tone="student"
          />
          <CapMeter
            label="Training time"
            used={estimate.trainingSeconds.most / 60}
            cap={job.budget.maxWallMinutes}
            format={(minutes) => shortDuration(minutes * 60)}
          />
        </div>
      </Group>
      <Group title="Caps">
        <NumberField
          label={`${mentor} spending`}
          unit="dollars"
          value={job.budget.maxMentorUsd}
          issue={issues['budget.maxMentorUsd']}
          onChange={(maxMentorUsd) => budget(`${mentor} spending cap`, { maxMentorUsd })}
        />
        <NumberField
          label="Training compute"
          unit="dollars"
          value={job.budget.maxComputeUsd ?? 0}
          issue={issues['budget.maxComputeUsd']}
          onChange={(maxComputeUsd) =>
            change(
              'Training compute cap',
              (current) => {
                const { maxComputeUsd: _before, ...rest } = current.budget;
                return {
                  ...current,
                  budget: maxComputeUsd === 0 ? rest : { ...rest, maxComputeUsd },
                };
              },
              TYPING_PAUSE_MS,
            )
          }
        />
        <NumberField
          label="Training time"
          unit="minutes"
          value={job.budget.maxWallMinutes}
          issue={issues['budget.maxWallMinutes']}
          onChange={(maxWallMinutes) => budget('Time limit', { maxWallMinutes })}
        />
      </Group>
    </div>
  );
}
