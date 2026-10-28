import type { ReactNode } from 'react';
import {
  MENTOR_PRESETS,
  type Job,
  type JobSummary,
  type MentorPresetKey,
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
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { mentorNote, mentorProvider } from '../../onboarding/mentor';
import { modelNames } from '../names';
import { aboutUsd, estimateMentorUsd, mentorPresetOf } from './estimates';
import { NumberField, PathField, TabNote, TextField } from './fields';
import { HOSTED_PRESETS, hostedEndpoint, presetOf, providerName } from './hosted';
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
  { value: 'mentor', label: 'Mentor' },
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

/** Says that edits save on their own, and whether the latest one has. */
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
    <p role="status" className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="text-fg-muted">Changes save as you edit.</span>
      <span className="flex items-center gap-1.5 text-fg-secondary">{state}</span>
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

/** The opening line of a tab for experiments: what it changes and that the defaults are safe. */
function ExperimentNote({ children }: { children: ReactNode }) {
  return (
    <TabNote className="border-t-0 pt-0">
      {children} The defaults suit most jobs. Change them and this job&apos;s later runs can&apos;t
      be compared fairly with earlier ones.
    </TabNote>
  );
}

function TasksTab({ editor, summaries }: TabProps & { summaries: QueryState<JobSummary[]> }) {
  const { job } = editor;
  return (
    <>
      <SettingsRow
        label="Example tasks"
        meta="Requests with known answers, from the tasks you attached. Architect divides them into the task sets."
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
      <ExperimentNote>How each answer is marked right or wrong.</ExperimentNote>
      <SettingsRow
        label="How answers are graded"
        meta={
          checker.kind === 'builtin'
            ? "Compares the agent's final answer line with each task's expected answer."
            : `A JavaScript file you provide checks the end result. ${mentor} can never change it.`
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
        meta="Training ends early once the check tasks reach it. The report says whether the final test did."
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
      <SettingsRow
        label="Answer time limit"
        meta="Optional. The report checks it against the slowest 5% of answers."
      >
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
          meta={`Timed on ${deviceInSentence(currentPlatform())} during the final test.`}
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
        meta={`Each round, ${mentor} tries one change. More rounds can help, and take longer.`}
        unit="rounds"
        value={job.budget.maxRounds}
        issue={issues['budget.maxRounds']}
        onChange={(maxRounds) => budget({ maxRounds })}
      />
      <NumberField
        label={`${mentor} spending cap`}
        meta={`A call to ${mentor} that could go over it never starts.`}
        unit="dollars"
        value={job.budget.maxMentorUsd}
        issue={issues['budget.maxMentorUsd']}
        onChange={(maxMentorUsd) => budget({ maxMentorUsd })}
      />
      <NumberField
        label="Training time"
        meta="Training stops here and the final test runs. Paused time doesn't count."
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

/** "$1.25 to read, $4.25 to write, per million tokens". */
function priceText(pricing: TokenPricing): string {
  return `$${pricing.inputPerM} to read, $${pricing.outputPerM} to write, per million tokens`;
}

const TOKEN_NOTE = 'A token is about three quarters of a word.';

function MentorTab({ editor }: TabProps) {
  const { job, change } = editor;
  const { mentor } = job;
  const name = modelNames(job).mentor;
  if (mentor.kind !== 'model') {
    return (
      <SettingsRow label="Mentor" meta="Edits the agent's instructions, skills and tools directly">
        <SettingsValue>{mentor.label}</SettingsValue>
      </SettingsRow>
    );
  }
  const preset = mentorPresetOf(job);
  const usual = estimateMentorUsd(job);
  return (
    <>
      <TabNote className="border-t-0 pt-0">
        {name}, the mentor, is a cloud model that coaches during training only. Your agent never
        calls it once it&apos;s trained.
      </TabNote>
      <SettingsRow label="Mentor" meta={mentor.model} metaFont="code">
        <Select<MentorPresetKey>
          aria-label="Mentor"
          placeholder={mentor.label}
          options={MENTOR_PRESETS.map((option) => ({ value: option.key, label: option.label }))}
          value={preset?.key}
          onValueChange={(key) => {
            const next = MENTOR_PRESETS.find((option) => option.key === key);
            if (!next) return;
            change((current) => ({
              ...current,
              mentor: {
                kind: 'model',
                provider: next.provider,
                label: next.label,
                baseUrl: next.baseUrl,
                model: next.model,
                reasoningEffort: mentor.reasoningEffort,
                secretRef: next.provider,
              },
            }));
          }}
          className="w-64"
        />
      </SettingsRow>
      {preset && <TabNote>{mentorNote(preset)}</TabNote>}
      <KeyRow secretRef={mentor.secretRef} provider={mentorProvider(mentor)} />
      <SettingsRow
        label="Price"
        meta={
          preset && preset.provider !== 'meta'
            ? `Billed by ${mentorProvider(mentor)}. ${TOKEN_NOTE}`
            : TOKEN_NOTE
        }
      >
        <SettingsValue>{preset ? priceText(preset.pricing) : 'Not on file'}</SettingsValue>
      </SettingsRow>
      {usual !== null && (
        <SettingsRow label="Usual cost" meta={`For this job's ${job.budget.maxRounds} rounds`}>
          <SettingsValue>{aboutUsd(usual)}</SettingsValue>
        </SettingsRow>
      )}
      <SettingsRow
        label={`How hard ${name} thinks`}
        meta="More thinking can find subtler fixes but costs more per round. Medium suits most jobs."
      >
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

const NO_HOST = 'none';

function StudentTab({ editor }: TabProps) {
  const { job, issues, change } = editor;
  const set = typed(editor);
  const { local, hosted } = job.student;
  const hostedPreset = hosted ? presetOf(hosted) : undefined;
  const device = deviceInSentence(currentPlatform());
  const { student } = modelNames(job);
  return (
    <>
      <TextField
        label="Model"
        meta={`Your agent runs on this model, through Ollama on ${device}.`}
        value={local.model}
        issue={issues['student.local.model']}
        onChange={(model) =>
          set((current) => ({
            ...current,
            student: { ...current.student, local: { ...current.student.local, model } },
          }))
        }
      />
      <NumberField
        label="Context size"
        meta={`How much text it reads at once, in tokens. ${TOKEN_NOTE} The default suits ${student}.`}
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
        label="Hosted copy for practice"
        meta={
          hosted
            ? hosted.model
            : `Optional. Practice rounds run faster there; the final test always runs on ${device}.`
        }
        metaFont={hosted ? 'code' : 'text'}
        error={issues['student.hosted']}
      >
        <Select<string>
          aria-label="Hosted copy for practice"
          options={[
            { value: NO_HOST, label: 'None' },
            ...HOSTED_PRESETS.map((preset) => ({ value: preset.key, label: preset.label })),
          ]}
          value={hosted ? hostedPreset?.key : NO_HOST}
          placeholder={hosted ? providerName(hosted) : undefined}
          onValueChange={(key) => {
            const preset = HOSTED_PRESETS.find((option) => option.key === key);
            change((current) => {
              const { hosted: _previous, ...student } = current.student;
              return preset
                ? {
                    ...current,
                    student: { ...student, hosted: hostedEndpoint(preset, local.contextLength) },
                  }
                : { ...current, student: { ...student, trainOn: 'local' } };
            });
          }}
          className="w-64"
        />
      </SettingsRow>
      {hostedPreset && <TabNote>{hostedPreset.note}</TabNote>}
      {hosted && hostedPreset?.pricing && (
        <SettingsRow label="Price" meta={TOKEN_NOTE}>
          <SettingsValue>{priceText(hostedPreset.pricing)}</SettingsValue>
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
  const { mentor } = modelNames(job);
  const setHarness = (next: StartingHarness) =>
    change((current) => ({ ...current, startingHarness: next }));
  return (
    <>
      <SettingsRow
        label="Start from"
        meta={`What ${mentor} builds the agent's instructions, skills and tools on. Blank suits most jobs.`}
      >
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
          meta="A general setup to improve on"
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
      <ExperimentNote>
        Architect divides the example tasks you attached into these sets. Each round, {mentor} makes
        one change, and the check tasks decide whether it stays.
      </ExperimentNote>
      <NumberField
        label="Practice tasks"
        meta={`${student} practices on these, and ${mentor} studies its mistakes.`}
        unit="tasks"
        value={train}
        issue={issues['splits.train']}
        onChange={(value) => splits({ train: value })}
      />
      <NumberField
        label="Check tasks"
        meta={`Decide whether each of ${mentor}'s changes stays. ${mentor} only ever sees the score.`}
        unit="tasks"
        value={dev}
        issue={issues['splits.dev']}
        onChange={(value) => splits({ dev: value })}
      />
      <NumberField
        label="Final test"
        meta="Locked away until training ends, then run once."
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
  const { mentor, student } = modelNames(job);
  const evaluation = (patch: Partial<Job['evaluation']>) =>
    set((current) => ({ ...current, evaluation: { ...current.evaluation, ...patch } }));
  return (
    <>
      <ExperimentNote>
        When a change {mentor} makes stays, and when training gives up. A change that clears these
        limits is measured a second time, and stays only if it clears twice the limits over both
        measurements.
      </ExperimentNote>
      <NumberField
        label="Practice tasks per round"
        meta={`${student} tries these before ${mentor} looks for mistakes.`}
        unit="tasks"
        value={job.evaluation.trainBatch}
        issue={issues['evaluation.trainBatch']}
        onChange={(trainBatch) => evaluation({ trainBatch })}
      />
      <NumberField
        label="Keep a change that gains at least"
        meta="More check tasks right than before, in one measurement. Lower keeps more changes, lucky ones too."
        unit="tasks"
        value={job.evaluation.minDevGain}
        issue={issues['evaluation.minDevGain']}
        onChange={(minDevGain) => evaluation({ minDevGain })}
      />
      <NumberField
        label="As long as no task type loses more than"
        meta="In one measurement. Stops one kind of task from paying for another's gain."
        unit="tasks"
        value={job.evaluation.maxTypeRegression}
        issue={issues['evaluation.maxTypeRegression']}
        onChange={(maxTypeRegression) => evaluation({ maxTypeRegression })}
      />
      <NumberField
        label="Run the check tasks"
        meta="Times per measurement. More runs take longer but keep fewer lucky changes."
        unit="times"
        value={job.evaluation.devRepeats}
        issue={issues['evaluation.devRepeats']}
        onChange={(devRepeats) => evaluation({ devRepeats })}
      />
      <NumberField
        label="Give up after"
        meta="This many rejected changes in a row ends training early."
        unit="rounds"
        value={job.evaluation.patience}
        issue={issues['evaluation.patience']}
        onChange={(patience) => evaluation({ patience })}
      />
    </>
  );
}
