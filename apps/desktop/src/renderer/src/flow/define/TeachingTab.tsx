import type { Job, StartingHarness, StudentTarget } from '@architect/shared';
import { Segmented, Select } from '@architect/ui';
import { useHubToken } from '../../api/hooks';
import { useUi } from '../../state/ui';
import { kindLabel, modelNames } from '../names';
import { Group, InspectorRow, NumberField, PathField } from './fields';
import type { InspectorTabProps } from './inspector-tabs';
import { TeacherMenu } from './TeacherMenu';
import { tokenState, withIntervention } from './teacher-menu';
import { TYPING_PAUSE_MS } from './use-job-editor';

interface TeachingTabProps extends InspectorTabProps {
  /** Where the run's final test will run, which decides whether weights can be trained. */
  testPlace: StudentTarget;
}

/**
 * How the teacher teaches: what it may change, how many rounds it has and when it gives up, the
 * rule a change must pass to stay, and the instructions the agent starts from.
 */
export function TeachingTab({ editor, change, testPlace }: TeachingTabProps) {
  const { job, issues } = editor;
  const { student } = modelNames(job);
  const token = useHubToken();
  const openSettings = useUi((state) => state.openSettings);
  const typed = (what: string, recipe: (current: Job) => Job) =>
    change(what, recipe, TYPING_PAUSE_MS);
  const evaluation = (what: string, patch: Partial<Job['evaluation']>) =>
    typed(what, (current) => ({ ...current, evaluation: { ...current.evaluation, ...patch } }));
  return (
    <div className="flex flex-col gap-6">
      <TeacherMenu
        job={job}
        facts={{ token: tokenState(token), testPlace }}
        issue={issues['interventions']}
        onToggle={(type, on) =>
          change(kindLabel(type, student), (current) => withIntervention(current, type, on))
        }
        // Settings opens over this screen; the edits so far are saved first.
        onAddKey={() => {
          void editor.flush();
          openSettings('models', 'huggingface');
        }}
      />
      <Group title="Rounds">
        <NumberField
          label="Rounds at most"
          unit="rounds"
          value={job.budget.maxRounds}
          issue={issues['budget.maxRounds']}
          onChange={(maxRounds) =>
            typed('Rounds', (current) => ({
              ...current,
              budget: { ...current.budget, maxRounds },
            }))
          }
        />
        <NumberField
          label="Practice tasks a round"
          unit="tasks"
          value={job.evaluation.trainBatch}
          issue={issues['evaluation.trainBatch']}
          onChange={(trainBatch) => evaluation('Practice tasks a round', { trainBatch })}
        />
        <NumberField
          label="Stop after rounds without a gain"
          unit="rounds"
          value={job.evaluation.patience}
          issue={issues['evaluation.patience']}
          onChange={(patience) => evaluation('Patience', { patience })}
        />
      </Group>
      <Group title="A change stays when">
        <NumberField
          label="Check tasks gain at least"
          unit="tasks"
          value={job.evaluation.minDevGain}
          issue={issues['evaluation.minDevGain']}
          onChange={(minDevGain) => evaluation('Keep rule', { minDevGain })}
        />
        <NumberField
          label="No skill loses more than"
          unit="tasks"
          value={job.evaluation.maxTypeRegression}
          issue={issues['evaluation.maxTypeRegression']}
          onChange={(maxTypeRegression) => evaluation('Keep rule', { maxTypeRegression })}
        />
        <NumberField
          label="Measured again on new seeds"
          unit="times"
          value={job.evaluation.devRepeats}
          issue={issues['evaluation.devRepeats']}
          onChange={(devRepeats) => evaluation('Keep rule', { devRepeats })}
        />
      </Group>
      <Start editor={editor} change={change} />
    </div>
  );
}

const STARTS = [
  { value: 'blank', label: 'Blank' },
  { value: 'template', label: 'Template' },
  { value: 'import', label: 'Agent' },
] as const satisfies readonly { value: StartingHarness['kind']; label: string }[];

const TEMPLATES = [{ value: 'ops-analyst', label: 'Ops analyst' }] as const;

/** The instructions the agent starts from: none, a template, or an agent already made. */
function Start({ editor, change }: InspectorTabProps) {
  const { job, issues } = editor;
  const { startingHarness } = job;
  const set = (next: StartingHarness) =>
    change('Starting instructions', (current) => ({ ...current, startingHarness: next }));
  return (
    <Group title="Starting instructions">
      <InspectorRow label="Start from">
        <Segmented
          aria-label="Start from"
          options={STARTS}
          value={startingHarness.kind}
          onValueChange={(kind) =>
            set(
              kind === 'blank'
                ? { kind }
                : kind === 'template'
                  ? { kind, template: TEMPLATES[0].value }
                  : { kind, path: '' },
            )
          }
        />
      </InspectorRow>
      {startingHarness.kind === 'template' && (
        <InspectorRow label="Template" error={issues['startingHarness.template']}>
          <Select<string>
            aria-label="Template"
            options={TEMPLATES}
            value={startingHarness.template}
            onValueChange={(template) => set({ kind: 'template', template })}
            className="w-40"
          />
        </InspectorRow>
      )}
      {startingHarness.kind === 'import' && (
        <PathField
          label="Agent folder"
          kind="folder"
          path={startingHarness.path}
          issue={issues['startingHarness.path']}
          onPick={(path) => set({ kind: 'import', path })}
        />
      )}
    </Group>
  );
}
