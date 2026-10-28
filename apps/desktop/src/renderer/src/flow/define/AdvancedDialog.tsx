import type { ReactNode } from 'react';
import {
  studentPricing,
  type Job,
  type JobSummary,
  type ReasoningEffort,
  type StartingHarness,
  type TokenPricing,
} from '@architect/shared';
import {
  Button,
  DialogClose,
  Segmented,
  Select,
  SettingsDialog,
  SettingsRow,
  SettingsValue,
  Spinner,
  Switch,
  type SettingsTab,
} from '@architect/ui';
import { Check, CircleAlert } from 'lucide-react';
import type { QueryState } from '../../api/query';
import { KeyRow } from '../../components/KeyRow';
import { errorOf, QueryValue } from '../../components/QueryValue';
import { mentorNote, mentorProvider } from '../../onboarding/mentor';
import {
  hostedFromChoice,
  localModelName,
  mentorFromChoice,
  studentFromChoice,
} from '../../settings/models/connections';
import { ModelPicker } from '../../settings/models/ModelPicker';
import { PriceRow } from '../../settings/models/PriceRow';
import { modelNames } from '../names';
import { aboutUsd, estimateMentorUsd, mentorPresetOf, mentorPriceOf } from './estimates';
import { NumberField, PathField, TabNote } from './fields';
import { presetOf, providerName } from './hosted';
import { TYPING_PAUSE_MS, type JobEditor } from './use-job-editor';
import type { JobIssues } from './validate';

export type AdvancedTab =
  | 'tasks'
  | 'checker'
  | 'requirements'
  | 'budget'
  | 'mentor'
  | 'student'
  | 'harness'
  | 'splits'
  | 'evaluation';

const EXPERIMENTS = 'Rarely changed';

const TABS: readonly SettingsTab<AdvancedTab>[] = [
  { value: 'tasks', label: 'Example tasks' },
  { value: 'requirements', label: 'Ready when' },
  { value: 'budget', label: 'Time and budget' },
  { value: 'mentor', label: 'Teacher' },
  { value: 'student', label: "Agent's model" },
  { value: 'harness', label: 'Starting instructions' },
  { value: 'checker', label: 'Grading', group: EXPERIMENTS },
  { value: 'splits', label: 'Task sets', group: EXPERIMENTS },
  { value: 'evaluation', label: 'When a change stays', group: EXPERIMENTS },
];

const TAB_OF_FIELD: readonly [string, AdvancedTab][] = [
  ['checker', 'checker'],
  ['requirements', 'requirements'],
  ['budget', 'budget'],
  ['mentor', 'mentor'],
  ['student', 'student'],
  ['startingHarness', 'harness'],
  ['splits', 'splits'],
  ['evaluation', 'evaluation'],
];

/** The first tab holding a problem, so Start training can open it. */
export function tabWithIssue(issues: JobIssues): AdvancedTab | null {
  for (const path of Object.keys(issues)) {
    const match = TAB_OF_FIELD.find(([prefix]) => path === prefix || path.startsWith(`${prefix}.`));
    if (match) return match[1];
  }
  return null;
}

function tabLabel(tab: AdvancedTab): string {
  return TABS.find((item) => item.value === tab)?.label ?? tab;
}

interface AdvancedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: AdvancedTab;
  onTabChange: (tab: AdvancedTab) => void;
  editor: JobEditor;
  summaries: QueryState<JobSummary[]>;
}

/** Every field of the job, in the settings modal's layout. Changes save as they're made. */
export function AdvancedDialog({
  open,
  onOpenChange,
  tab,
  onTabChange,
  editor,
  summaries,
}: AdvancedDialogProps) {
  return (
    <SettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Advanced settings"
      tabs={TABS}
      tab={tab}
      onTabChange={onTabChange}
      footer={
        <>
          <SaveIndicator editor={editor} />
          <DialogClose asChild>
            <Button variant="primary" size="md">
              Done
            </Button>
          </DialogClose>
        </>
      }
    >
      <TabContent tab={tab} editor={editor} summaries={summaries} />
    </SettingsDialog>
  );
}

/** Whether the latest edit has saved; edits save on their own. */
function SaveIndicator({ editor }: { editor: JobEditor }) {
  const { issues, saveStatus, flush } = editor;
  const problem = tabWithIssue(issues);
  let state: ReactNode;
  if (Object.keys(issues).length > 0) {
    state = (
      <>
        <CircleAlert size={14} className="shrink-0 text-danger" aria-hidden />
        Not saved: fix the marked field{problem ? ` in ${tabLabel(problem)}` : ''}
      </>
    );
  } else if (saveStatus === 'saving') {
    state = (
      <>
        <Spinner size={13} />
        Saving
      </>
    );
  } else if (saveStatus === 'failed') {
    state = (
      <>
        <CircleAlert size={14} className="shrink-0 text-danger" aria-hidden />
        Couldn&apos;t save.
        <button
          type="button"
          onClick={() => void flush()}
          className="rounded-xs text-fg underline underline-offset-4"
        >
          Try again
        </button>
      </>
    );
  } else {
    state = (
      <>
        <Check size={14} strokeWidth={2} className="shrink-0 text-student" aria-hidden />
        Saved
      </>
    );
  }
  return (
    <p
      role="status"
      className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-fg-secondary"
    >
      {state}
    </p>
  );
}

interface TabProps {
  editor: JobEditor;
}

function TabContent({
  tab,
  editor,
  summaries,
}: {
  tab: AdvancedTab;
  editor: JobEditor;
  summaries: QueryState<JobSummary[]>;
}) {
  switch (tab) {
    case 'tasks':
      return <TasksTab editor={editor} summaries={summaries} />;
    case 'checker':
      return <CheckerTab editor={editor} />;
    case 'requirements':
      return <RequirementsTab editor={editor} />;
    case 'budget':
      return <BudgetTab editor={editor} />;
    case 'mentor':
      return <MentorTab editor={editor} />;
    case 'student':
      return <StudentTab editor={editor} />;
    case 'harness':
      return <HarnessTab editor={editor} />;
    case 'splits':
      return <SplitsTab editor={editor} />;
    case 'evaluation':
      return <EvaluationTab editor={editor} />;
  }
}

/** Saves typed values once the user pauses. */
function typed(editor: JobEditor) {
  return (recipe: (job: Job) => Job) => editor.change(recipe, TYPING_PAUSE_MS);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function TasksTab({ editor, summaries }: TabProps & { summaries: QueryState<JobSummary[]> }) {
  const { job } = editor;
  return (
    <>
      <SettingsRow
        label="Example tasks"
        meta="From the tasks you attached"
        error={errorOf(summaries)}
      >
        <QueryValue query={summaries}>
          {(list) => {
            const count = list.find((summary) => summary.id === job.id)?.taskCount;
            return count === undefined ? 'Not counted yet' : plural(count, 'task');
          }}
        </QueryValue>
      </SettingsRow>
      {job.taskTypes.map((type) => (
        <SettingsRow key={type.id} label={type.label} meta={type.description} />
      ))}
    </>
  );
}

const CHECKERS = [
  { value: 'builtin', label: 'Answer line' },
  { value: 'module', label: 'Checker file' },
] as const;

function CheckerTab({ editor }: TabProps) {
  const { job, issues, change } = editor;
  const { checker } = job;
  const { mentor } = modelNames(job);
  return (
    <>
      <SettingsRow
        label="How answers are graded"
        meta={
          checker.kind === 'builtin'
            ? 'Compares the final answer line with the expected answer'
            : `A JavaScript file checks the end result. ${mentor} can't change it.`
        }
      >
        <Segmented
          aria-label="How answers are graded"
          options={CHECKERS}
          value={checker.kind}
          onValueChange={(kind) =>
            change((current) => ({
              ...current,
              checker: kind === 'builtin' ? { kind } : { kind, path: '' },
            }))
          }
        />
      </SettingsRow>
      {checker.kind === 'module' && (
        <PathField
          label="Checker file"
          kind="file"
          extensions={['js', 'mjs']}
          path={checker.path}
          issue={issues['checker.path']}
          onPick={(path) =>
            change((current) => ({ ...current, checker: { kind: 'module', path } }))
          }
        />
      )}
    </>
  );
}

function RequirementsTab({ editor }: TabProps) {
  const { job, issues, change } = editor;
  const set = typed(editor);
  const { p95LatencyMs } = job.requirements;
  return (
    <>
      <NumberField
        label="Share of new tasks right"
        meta="Training stops early once check tasks reach it"
        unit="%"
        value={Math.round(job.requirements.passRate * 100)}
        issue={issues['requirements.passRate']}
        onChange={(percent) =>
          set((current) => ({
            ...current,
            requirements: { ...current.requirements, passRate: percent / 100 },
          }))
        }
      />
      <SettingsRow label="Answer time limit" meta="Optional, for the slowest 5% of answers">
        <Switch
          aria-label="Answer time limit"
          checked={p95LatencyMs !== undefined}
          onCheckedChange={(on) =>
            change((current) => ({
              ...current,
              requirements: on
                ? { ...current.requirements, p95LatencyMs: 8000 }
                : { passRate: current.requirements.passRate },
            }))
          }
        />
      </SettingsRow>
      {p95LatencyMs !== undefined && (
        <NumberField
          label="Slowest answer"
          unit="seconds"
          value={p95LatencyMs / 1000}
          issue={issues['requirements.p95LatencyMs']}
          onChange={(seconds) =>
            set((current) => ({
              ...current,
              requirements: { ...current.requirements, p95LatencyMs: Math.round(seconds * 1000) },
            }))
          }
        />
      )}
    </>
  );
}

function BudgetTab({ editor }: TabProps) {
  const { job, issues } = editor;
  const set = typed(editor);
  const { mentor } = modelNames(job);
  const budget = (patch: Partial<Job['budget']>) =>
    set((current) => ({ ...current, budget: { ...current.budget, ...patch } }));
  return (
    <>
      <NumberField
        label="Rounds"
        meta="One change per round"
        unit="rounds"
        value={job.budget.maxRounds}
        issue={issues['budget.maxRounds']}
        onChange={(maxRounds) => budget({ maxRounds })}
      />
      <NumberField
        label={`${mentor} spending cap`}
        meta="Training stops before going over"
        unit="dollars"
        value={job.budget.maxMentorUsd}
        issue={issues['budget.maxMentorUsd']}
        onChange={(maxMentorUsd) => budget({ maxMentorUsd })}
      />
      <NumberField
        label="Training time"
        meta="Paused time doesn't count"
        unit="minutes"
        value={job.budget.maxWallMinutes}
        issue={issues['budget.maxWallMinutes']}
        onChange={(maxWallMinutes) => budget({ maxWallMinutes })}
      />
    </>
  );
}

const EFFORTS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const satisfies readonly { value: ReasoningEffort; label: string }[];

/** "$1.25 to read, $4.25 to write, per million tokens", or "Free" for a model on this computer. */
function priceText(pricing: TokenPricing): string {
  if (pricing.inputPerM === 0 && pricing.outputPerM === 0) return 'Free';
  return `$${pricing.inputPerM} to read, $${pricing.outputPerM} to write, per million tokens`;
}

function MentorTab({ editor }: TabProps) {
  const { job, issues, change } = editor;
  const { mentor } = job;
  const name = modelNames(job).mentor;
  if (mentor.kind !== 'model') {
    return (
      <SettingsRow label="Teacher" meta="Edits the agent's instructions, skills and tools directly">
        <SettingsValue>{mentor.label}</SettingsValue>
      </SettingsRow>
    );
  }
  const preset = mentorPresetOf(job);
  const pricing = mentorPriceOf(job);
  const usual = estimateMentorUsd(job);
  const billed = pricing !== null && pricing.inputPerM + pricing.outputPerM > 0;
  return (
    <>
      <SettingsRow label="Teacher" meta={mentor.model} metaFont="code">
        <ModelPicker
          role="mentor"
          aria-label="Teacher"
          current={mentor}
          onChoose={(choice) =>
            change((current) => ({
              ...current,
              mentor: mentorFromChoice(choice, mentor.reasoningEffort),
            }))
          }
          className="w-64"
        >
          <span className="truncate">{mentor.label}</span>
          <span className="shrink-0 text-fg-muted">{mentorProvider(mentor)}</span>
        </ModelPicker>
      </SettingsRow>
      {preset && <TabNote>{mentorNote(preset)}</TabNote>}
      {mentor.secretRef !== undefined && (
        <KeyRow secretRef={mentor.secretRef} provider={mentorProvider(mentor)} />
      )}
      {pricing ? (
        <SettingsRow
          label="Price"
          meta={
            billed && mentor.provider !== 'meta' ? `Billed by ${mentorProvider(mentor)}` : undefined
          }
        >
          <SettingsValue>{priceText(pricing)}</SettingsValue>
        </SettingsRow>
      ) : (
        <PriceRow
          error={issues['mentor.pricing']}
          onSave={(saved) =>
            change((current) =>
              current.mentor.kind === 'model'
                ? { ...current, mentor: { ...current.mentor, pricing: saved } }
                : current,
            )
          }
        />
      )}
      {usual !== null && (
        <SettingsRow label="Usual cost" meta={`For ${job.budget.maxRounds} rounds`}>
          <SettingsValue>{aboutUsd(usual)}</SettingsValue>
        </SettingsRow>
      )}
      <SettingsRow label={`How hard ${name} thinks`} meta="Higher costs more per round">
        <Segmented
          aria-label={`How hard ${name} thinks`}
          options={EFFORTS}
          value={mentor.reasoningEffort}
          onValueChange={(reasoningEffort) =>
            change((current) =>
              current.mentor.kind === 'model'
                ? { ...current, mentor: { ...current.mentor, reasoningEffort } }
                : current,
            )
          }
        />
      </SettingsRow>
    </>
  );
}

function StudentTab({ editor }: TabProps) {
  const { job, issues, change } = editor;
  const set = typed(editor);
  const { local, hosted } = job.student;
  const hostedPreset = hosted ? presetOf(hosted) : undefined;
  const hostedPrice = hosted ? studentPricing(hosted) : undefined;
  return (
    <>
      <SettingsRow
        label="Model"
        meta={local.model}
        metaFont="code"
        error={issues['student.local.model']}
      >
        <ModelPicker
          role="student"
          aria-label="Model"
          current={local}
          onChoose={(choice) =>
            change((current) => ({
              ...current,
              student: {
                ...current.student,
                local: studentFromChoice(choice, current.student.local.contextLength),
              },
            }))
          }
          className="w-64"
        >
          <span className="truncate">{localModelName(local.model)}</span>
        </ModelPicker>
      </SettingsRow>
      <NumberField
        label="Context size"
        meta="Tokens it reads at once"
        unit="tokens"
        value={local.contextLength}
        issue={issues['student.local.contextLength']}
        onChange={(contextLength) =>
          set((current) => ({
            ...current,
            student: { ...current.student, local: { ...current.student.local, contextLength } },
          }))
        }
      />
      <SettingsRow
        label="Online copy for practice"
        meta={hosted ? hosted.model : 'Optional, for faster practice'}
        metaFont={hosted ? 'code' : 'text'}
        error={issues['student.hosted']}
      >
        <ModelPicker
          role="hosted"
          aria-label="Online copy for practice"
          current={hosted ?? null}
          none={{
            label: 'None',
            onChoose: () =>
              change((current) => {
                const { hosted: _previous, ...student } = current.student;
                return { ...current, student: { ...student, trainOn: 'local' } };
              }),
          }}
          onChoose={(choice) =>
            change((current) => ({
              ...current,
              student: {
                ...current.student,
                hosted: hostedFromChoice(choice, current.student.local.contextLength),
              },
            }))
          }
          className="w-64"
        >
          <span className="truncate">
            {hosted
              ? (hostedPreset?.label ?? `${hosted.model} on ${providerName(hosted)}`)
              : 'None'}
          </span>
        </ModelPicker>
      </SettingsRow>
      {hostedPreset && <TabNote>{hostedPreset.note}</TabNote>}
      {hostedPrice && (
        <SettingsRow label="Price">
          <SettingsValue>{priceText(hostedPrice)}</SettingsValue>
        </SettingsRow>
      )}
      {hosted?.secretRef && <KeyRow secretRef={hosted.secretRef} provider={providerName(hosted)} />}
    </>
  );
}

const STARTS = [
  { value: 'blank', label: 'Blank' },
  { value: 'template', label: 'Template' },
  { value: 'import', label: 'Existing agent' },
] as const satisfies readonly { value: StartingHarness['kind']; label: string }[];

const TEMPLATES = [{ value: 'ops-analyst', label: 'Ops analyst' }] as const;

function HarnessTab({ editor }: TabProps) {
  const { job, issues, change } = editor;
  const { startingHarness } = job;
  const setHarness = (next: StartingHarness) =>
    change((current) => ({ ...current, startingHarness: next }));
  return (
    <>
      <SettingsRow label="Start from" meta="Blank suits most jobs">
        <Segmented
          aria-label="Start from"
          options={STARTS}
          value={startingHarness.kind}
          onValueChange={(kind) =>
            setHarness(
              kind === 'blank'
                ? { kind }
                : kind === 'template'
                  ? { kind, template: TEMPLATES[0].value }
                  : { kind, path: '' },
            )
          }
        />
      </SettingsRow>
      {startingHarness.kind === 'template' && (
        <SettingsRow
          label="Template"
          meta="A general setup to start from"
          error={issues['startingHarness.template']}
        >
          <Select<string>
            aria-label="Template"
            options={TEMPLATES}
            value={startingHarness.template}
            onValueChange={(template) => setHarness({ kind: 'template', template })}
            className="w-52"
          />
        </SettingsRow>
      )}
      {startingHarness.kind === 'import' && (
        <PathField
          label="Agent folder"
          kind="folder"
          path={startingHarness.path}
          issue={issues['startingHarness.path']}
          onPick={(path) => setHarness({ kind: 'import', path })}
        />
      )}
    </>
  );
}

function SplitsTab({ editor }: TabProps) {
  const { job, issues } = editor;
  const set = typed(editor);
  const { mentor, student } = modelNames(job);
  const splits = (patch: Partial<Job['splits']>) =>
    set((current) => ({ ...current, splits: { ...current.splits, ...patch } }));
  const { train, dev, test } = job.splits;
  return (
    <>
      <NumberField
        label="Practice tasks"
        meta={`${mentor} teaches ${student} from these`}
        unit="tasks"
        value={train}
        issue={issues['splits.train']}
        onChange={(value) => splits({ train: value })}
      />
      <NumberField
        label="Check tasks"
        meta={`${mentor} sees only the score. It decides which changes stay.`}
        unit="tasks"
        value={dev}
        issue={issues['splits.dev']}
        onChange={(value) => splits({ dev: value })}
      />
      <NumberField
        label="Final test"
        meta="Opened once, at the end"
        unit="tasks"
        value={test}
        issue={issues['splits.test']}
        onChange={(value) => splits({ test: value })}
      />
      {issues.splits && (
        <p role="alert" className="m-0 flex items-start gap-1.5 pb-2 text-sm text-fg-muted">
          <CircleAlert size={13} className="mt-[3px] shrink-0 text-danger" aria-hidden />
          {issues.splits}
        </p>
      )}
    </>
  );
}

function EvaluationTab({ editor }: TabProps) {
  const { job, issues } = editor;
  const set = typed(editor);
  const evaluation = (patch: Partial<Job['evaluation']>) =>
    set((current) => ({ ...current, evaluation: { ...current.evaluation, ...patch } }));
  return (
    <>
      <NumberField
        label="Practice tasks per round"
        meta="Tried before each diagnosis"
        unit="tasks"
        value={job.evaluation.trainBatch}
        issue={issues['evaluation.trainBatch']}
        onChange={(trainBatch) => evaluation({ trainBatch })}
      />
      <NumberField
        label="Keep a change that gains at least"
        meta="Check tasks, in one measurement"
        unit="tasks"
        value={job.evaluation.minDevGain}
        issue={issues['evaluation.minDevGain']}
        onChange={(minDevGain) => evaluation({ minDevGain })}
      />
      <NumberField
        label="As long as no task type loses more than"
        meta="Check tasks, in one measurement"
        unit="tasks"
        value={job.evaluation.maxTypeRegression}
        issue={issues['evaluation.maxTypeRegression']}
        onChange={(maxTypeRegression) => evaluation({ maxTypeRegression })}
      />
      <NumberField
        label="Run the check tasks"
        meta="Times per measurement"
        unit="times"
        value={job.evaluation.devRepeats}
        issue={issues['evaluation.devRepeats']}
        onChange={(devRepeats) => evaluation({ devRepeats })}
      />
      <NumberField
        label="Give up after"
        meta="Rounds in a row without a gain"
        unit="rounds"
        value={job.evaluation.patience}
        issue={issues['evaluation.patience']}
        onChange={(patience) => evaluation({ patience })}
      />
    </>
  );
}
