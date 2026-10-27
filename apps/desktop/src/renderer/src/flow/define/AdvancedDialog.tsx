import { useState } from 'react';
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
  Input,
  Segmented,
  Select,
  SettingsDialog,
  SettingsRow,
  SettingsValue,
  Switch,
  type SettingsTab,
} from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import { api, architect } from '../../api/client';
import { queryKeys, useSecretsStatus } from '../../api/hooks';
import { fetchQuery, type QueryState } from '../../api/query';
import { errorOf, QueryValue } from '../../components/QueryValue';
import { mentorName } from '../../lib/names';
import { attempt } from '../../lib/notify';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { mentorPresetOf } from './estimates';
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

const TABS: readonly SettingsTab<AdvancedTab>[] = [
  { value: 'tasks', label: 'Tasks' },
  { value: 'checker', label: 'Checker' },
  { value: 'requirements', label: 'Requirements' },
  { value: 'budget', label: 'Budget' },
  { value: 'mentor', label: 'Mentor' },
  { value: 'student', label: 'Student' },
  { value: 'harness', label: 'Starting harness' },
  { value: 'splits', label: 'Splits' },
  { value: 'evaluation', label: 'Evaluation' },
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
      title="Advanced"
      tabs={TABS}
      tab={tab}
      onTabChange={onTabChange}
    >
      <TabContent tab={tab} editor={editor} summaries={summaries} />
    </SettingsDialog>
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
      return <SplitsTab editor={editor} summaries={summaries} />;
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
        label="Tasks"
        meta="Example requests with known answers"
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
        <SettingsRow key={type.id} label={type.label} meta={type.description ?? type.id} />
      ))}
    </>
  );
}

const CHECKERS = [
  { value: 'builtin', label: 'Built in' },
  { value: 'module', label: 'Checker file' },
] as const;

function CheckerTab({ editor }: TabProps) {
  const { job, issues, change } = editor;
  const { checker } = job;
  return (
    <>
      <SettingsRow
        label="Grading"
        meta={
          checker.kind === 'builtin'
            ? 'Compares the answer line with the expected value'
            : 'A JavaScript file that checks the end state'
        }
      >
        <Segmented
          aria-label="Grading"
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
        label="Pass rate target"
        meta="Share of the final test it must get right"
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
      <SettingsRow label="Answer time limit" meta="Applies to the slowest 5% of answers">
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
          meta="95th percentile, on this computer"
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
  const budget = (patch: Partial<Job['budget']>) =>
    set((current) => ({ ...current, budget: { ...current.budget, ...patch } }));
  return (
    <>
      <NumberField
        label="Rounds"
        meta="Each round tries one change"
        unit="rounds"
        value={job.budget.maxRounds}
        issue={issues['budget.maxRounds']}
        onChange={(maxRounds) => budget({ maxRounds })}
      />
      <NumberField
        label={`${mentorName(job.mentor)} spending cap`}
        meta="A call that could cross it never starts"
        unit="dollars"
        value={job.budget.maxMentorUsd}
        issue={issues['budget.maxMentorUsd']}
        onChange={(maxMentorUsd) => budget({ maxMentorUsd })}
      />
      <NumberField
        label="Time"
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

function priceText(pricing: TokenPricing): string {
  return `$${pricing.inputPerM} in, $${pricing.outputPerM} out per million tokens`;
}

function MentorTab({ editor }: TabProps) {
  const { job, change } = editor;
  const { mentor } = job;
  if (mentor.kind !== 'model') {
    return (
      <SettingsRow label="Mentor" meta="Edits the harness folder directly">
        <SettingsValue>{mentor.label}</SettingsValue>
      </SettingsRow>
    );
  }
  const preset = mentorPresetOf(job);
  return (
    <>
      <SettingsRow label="Mentor" meta={mentor.model}>
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
      {preset && <TabNote>{preset.note}</TabNote>}
      <SettingsRow label="Price">
        <SettingsValue>{preset ? priceText(preset.pricing) : 'Not on file'}</SettingsValue>
      </SettingsRow>
      <SettingsRow label="Reasoning" meta="More reasoning costs more per round">
        <Segmented
          aria-label="Reasoning"
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
  return (
    <>
      <TextField
        label="Local model"
        meta={`Runs through Ollama on ${deviceInSentence(currentPlatform())}`}
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
        label="Context length"
        meta="How much the model reads at once"
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
        label="Hosted copy for training"
        meta={hosted ? hosted.model : 'The final test always runs here'}
        error={issues['student.hosted']}
      >
        <Select<string>
          aria-label="Hosted copy for training"
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
        <SettingsRow label="Price">
          <SettingsValue>{priceText(hostedPreset.pricing)}</SettingsValue>
        </SettingsRow>
      )}
      {hosted?.secretRef && <KeyRow secretRef={hosted.secretRef} provider={providerName(hosted)} />}
    </>
  );
}

/** Saves a provider's key in the app's encrypted store. The key is never shown again. */
function KeyRow({ secretRef, provider }: { secretRef: string; provider: string }) {
  const secrets = useSecretsStatus();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    const saved = await attempt(`Couldn't save the ${provider} key`, async () => {
      await architect().secrets.set(secretRef, value.trim());
      await fetchQuery(queryKeys.secrets, api.secretsStatus);
      return true;
    });
    setSaving(false);
    if (saved) setValue('');
  };
  const stored = secrets.status === 'success' && secrets.data[secretRef] === true;
  return (
    <SettingsRow
      label={`${provider} key`}
      meta={`Encrypted on ${deviceInSentence(currentPlatform())}`}
      error={errorOf(secrets)}
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) void save();
        }}
      >
        <Input
          type="password"
          aria-label={`${provider} key`}
          placeholder={stored ? 'Saved' : 'Paste a key'}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoComplete="off"
          className="w-44"
        />
        <Button type="submit" size="xs" loading={saving} disabled={!value.trim()}>
          {stored ? 'Replace' : 'Save'}
        </Button>
      </form>
    </SettingsRow>
  );
}

const STARTS = [
  { value: 'blank', label: 'Blank' },
  { value: 'template', label: 'Template' },
  { value: 'import', label: 'Existing' },
] as const satisfies readonly { value: StartingHarness['kind']; label: string }[];

const TEMPLATES = [{ value: 'ops-analyst', label: 'Ops analyst' }] as const;

function HarnessTab({ editor }: TabProps) {
  const { job, issues, change } = editor;
  const { startingHarness } = job;
  const setHarness = (next: StartingHarness) =>
    change((current) => ({ ...current, startingHarness: next }));
  return (
    <>
      <SettingsRow label="Start from" meta="What the mentor starts improving from">
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
        <SettingsRow label="Template" error={issues['startingHarness.template']}>
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
          label="Harness folder"
          kind="folder"
          path={startingHarness.path}
          issue={issues['startingHarness.path']}
          onPick={(path) => setHarness({ kind: 'import', path })}
        />
      )}
    </>
  );
}

function SplitsTab({ editor, summaries }: TabProps & { summaries: QueryState<JobSummary[]> }) {
  const { job, issues } = editor;
  const set = typed(editor);
  const splits = (patch: Partial<Job['splits']>) =>
    set((current) => ({ ...current, splits: { ...current.splits, ...patch } }));
  const { calibration, train, dev, test } = job.splits;
  const total = summaries.data?.find((summary) => summary.id === job.id)?.taskCount;
  return (
    <>
      <NumberField
        label="Calibration"
        meta="Runs first, to see how much results vary"
        unit="tasks"
        value={calibration}
        issue={issues['splits.calibration']}
        onChange={(value) => splits({ calibration: value })}
      />
      <NumberField
        label="Practice"
        meta="The mentor sees these attempts"
        unit="tasks"
        value={train}
        issue={issues['splits.train']}
        onChange={(value) => splits({ train: value })}
      />
      <NumberField
        label="Check"
        meta="Decides each change; the mentor sees only scores"
        unit="tasks"
        value={dev}
        issue={issues['splits.dev']}
        onChange={(value) => splits({ dev: value })}
      />
      <NumberField
        label="Final test"
        meta="Locked away until training ends"
        unit="tasks"
        value={test}
        issue={issues['splits.test']}
        onChange={(value) => splits({ test: value })}
      />
      <NumberField
        label="Seed"
        meta="The same seed gives the same split"
        value={job.splits.seed}
        issue={issues['splits.seed']}
        onChange={(seed) => splits({ seed })}
      />
      <SettingsRow label="In all">
        <SettingsValue>
          {total === undefined
            ? plural(calibration + train + dev + test, 'task')
            : `${calibration + train + dev + test} of ${plural(total, 'task')}`}
        </SettingsValue>
      </SettingsRow>
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
        label="Practice batch"
        meta="Attempted each round before the mentor looks"
        unit="tasks"
        value={job.evaluation.trainBatch}
        issue={issues['evaluation.trainBatch']}
        onChange={(trainBatch) => evaluation({ trainBatch })}
      />
      <NumberField
        label="Keep a change when it gains"
        meta="More check tasks right than before"
        unit="tasks"
        value={job.evaluation.minDevGain}
        issue={issues['evaluation.minDevGain']}
        onChange={(minDevGain) => evaluation({ minDevGain })}
      />
      <NumberField
        label="And no task type loses more than"
        meta="Protects one kind of task from another's gain"
        unit="tasks"
        value={job.evaluation.maxTypeRegression}
        issue={issues['evaluation.maxTypeRegression']}
        onChange={(maxTypeRegression) => evaluation({ maxTypeRegression })}
      />
      <NumberField
        label="Stop after"
        meta="Rounds in a row without a kept change"
        unit="rounds"
        value={job.evaluation.patience}
        issue={issues['evaluation.patience']}
        onChange={(patience) => evaluation({ patience })}
      />
    </>
  );
}
