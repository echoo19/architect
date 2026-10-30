import type { Job, TaskPlan } from '@architect/shared';
import { SettingsRow, SettingsSection, SettingsValue, Skeleton } from '@architect/ui';
import { useTaskPlan } from '../../api/hooks';
import { ProblemState } from '../../components/ProblemState';
import { modelNames } from '../names';
import { TabNote } from './fields';
import { checkedAgainst, sourceText, splitsText, tasksText, totalOf } from './task-plan';

/**
 * What the job's tasks are: where they came from, and for each type the rule Architect
 * understood, how many tasks it has in each set and three examples with their expected answers.
 * The examples never come from the final test.
 */
export function TasksTab({ job }: { job: Job }) {
  const plan = useTaskPlan(job.id);
  if (plan.status === 'loading') {
    return (
      <div aria-busy="true" aria-label="Loading the tasks" className="flex flex-col gap-4 pt-4">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-4 w-48" />
      </div>
    );
  }
  if (plan.status === 'error') {
    return (
      <ProblemState
        layout="inline"
        error={plan.error}
        title="Couldn't load the tasks"
        onRetry={plan.reload}
        className="pt-4"
      />
    );
  }
  return <Plan job={job} plan={plan.data} />;
}

function Plan({ job, plan }: { job: Job; plan: TaskPlan }) {
  const { mentor } = modelNames(job);
  const total = totalOf(plan.counts);
  return (
    <>
      <SettingsRow label="Example tasks" meta={sourceText(plan.source, mentor)}>
        <SettingsValue>{tasksText(total)}</SettingsValue>
      </SettingsRow>
      <SettingsRow
        label="How they are used"
        meta={`${mentor} teaches from the practice tasks, sees only the score on the check tasks, and never sees the final test.`}
      >
        <SettingsValue>{splitsText(plan.counts)}</SettingsValue>
      </SettingsRow>
      {plan.source === 'generated' && <TabNote>{checkedAgainst(mentor)}</TabNote>}
      {plan.unresolved.length > 0 && (
        <SettingsSection title="Left open">
          {plan.unresolved.map((rule) => (
            <SettingsRow key={rule} label={rule} density="compact" />
          ))}
          <TabNote className="py-3 text-small text-fg">
            {mentor} couldn&apos;t settle these from your files and answers.
          </TabNote>
        </SettingsSection>
      )}
      {plan.types.map((type) => (
        <SettingsSection key={type.id} title={type.label}>
          <SettingsRow
            label={type.rule ?? type.description ?? 'Tasks of this type'}
            meta={splitsText(type.counts)}
          >
            <SettingsValue>{tasksText(totalOf(type.counts))}</SettingsValue>
          </SettingsRow>
          {type.examples.length > 0 && (
            <p className="m-0 border-t border-line pb-1 pt-3 text-small text-fg">
              {type.examples.length === 1 ? 'An example' : 'Examples'}
            </p>
          )}
          {type.examples.map((example) => (
            <SettingsRow
              key={example.request}
              label={example.request}
              meta={example.answer === undefined ? undefined : `Expected answer: ${example.answer}`}
              density="compact"
            />
          ))}
        </SettingsSection>
      ))}
      {plan.notes.length > 0 && (
        <SettingsSection title="What Architect assumed or left out">
          {plan.notes.map((note) => (
            <SettingsRow key={note} label={note} density="compact" />
          ))}
        </SettingsSection>
      )}
    </>
  );
}
