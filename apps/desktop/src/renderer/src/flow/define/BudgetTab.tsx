import { studentPricing, type Job, type StudentTarget } from '@architect/shared';
import { Button, CapMeter } from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import { modelNames } from '../names';
import {
  capShortfalls,
  capText,
  estimateTime,
  fullTrainingSeconds,
  planBills,
  roughUsd,
  shortDuration,
  sumKnown,
} from './estimates';
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
 * dollars of compute for retraining the student, and the time. The agent's online copy has no cap
 * of its own, so its expected bill stands alone, with no meter. Every cap is a hard stop, so a
 * cap the plan doesn't fit in is said under the meters, with the fix. Where the time limit cuts
 * training short, the time meter measures training with every round, so it shows past its cap.
 */
export function BudgetTab({ editor, change, testPlace }: BudgetTabProps) {
  const { job, issues } = editor;
  const { mentor, student } = modelNames(job);
  const estimate = estimateTime(job, job.student.trainOn);
  const pricing = job.student.hosted ? (studentPricing(job.student.hosted) ?? null) : null;
  const bills = planBills(job, estimate, pricing, false, testPlace).total;
  const online = sumKnown([bills.hostedUsd, bills.testUsd]);
  const shortfalls = capShortfalls(job, { mentor, student });
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
            used={
              shortfalls.some((shortfall) => shortfall.what === 'time')
                ? fullTrainingSeconds(job, estimate) / 60
                : estimate.trainingSeconds.most / 60
            }
            cap={job.budget.maxWallMinutes}
            format={(minutes) => shortDuration(minutes * 60)}
          />
          {shortfalls.map((shortfall) => (
            <div key={shortfall.what} role="note" className="flex gap-2.5 text-small text-pretty">
              <CircleAlert
                size={15}
                strokeWidth={1.8}
                className="mt-0.5 shrink-0 text-danger"
                aria-hidden
              />
              <div className="flex flex-col items-start gap-1.5">
                <span>{shortfall.line}</span>
                {shortfall.allowMinutes !== undefined && (
                  <Button
                    size="xs"
                    onClick={() => {
                      const maxWallMinutes = shortfall.allowMinutes;
                      if (maxWallMinutes === undefined) return;
                      change('Time limit', (current) => ({
                        ...current,
                        budget: { ...current.budget, maxWallMinutes },
                      }));
                    }}
                  >
                    Allow {capText(shortfall.allowMinutes)}
                  </Button>
                )}
              </div>
            </div>
          ))}
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
          label={`Retraining ${student}`}
          unit="dollars"
          value={job.budget.maxComputeUsd ?? 0}
          issue={issues['budget.maxComputeUsd']}
          onChange={(maxComputeUsd) =>
            change(
              `Retraining ${student} cap`,
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
