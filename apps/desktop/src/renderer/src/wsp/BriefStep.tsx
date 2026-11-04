import { useId, type ReactNode } from 'react';
import {
  WspBriefSchema,
  type WspBrief,
  type WspDecoding,
  type WspExperiment,
  type WspTarget,
} from '@architect/shared';
import {
  Button,
  DetailList,
  ErrorState,
  Field,
  IconButton,
  Input,
  Panel,
  PanelHeader,
  Segmented,
  Spinner,
  Textarea,
  ToggleRow,
} from '@architect/ui';
import { Plus, X } from 'lucide-react';
import { NumberRow } from '../experiments/NumberRow';
import { formatCost } from '../flow/format';
import { mentorName, METRIC_WORDS, minutesText } from './model';
import { StandInNote } from './StandInNote';
import { StepBody } from './parts';

const METRICS = (Object.keys(METRIC_WORDS) as WspTarget['metric'][]).map((value) => ({
  value,
  label: METRIC_WORDS[value],
}));

/** What each part of the brief is called where a missing one is named. */
const PART_WORDS: Record<string, string> = {
  objective: 'the objective',
  baseline: 'the baseline',
  investigation: 'the investigation',
  successCriteria: 'every success criterion',
  regressionChecks: 'every regression check',
  expectedOutput: 'the expected output',
  target: 'the target',
  controls: 'the controls',
};

/** Why a brief can't start as it stands, or null when it can. */
export function briefHeld(brief: WspBrief, title: string): string | null {
  if (title.trim() === '') return 'Give it a title';
  const parsed = WspBriefSchema.safeParse(brief);
  if (parsed.success) return null;
  const part = String(parsed.error.issues[0]?.path[0] ?? '');
  return `Fill in ${PART_WORDS[part] ?? 'the brief'}`;
}

/** A list of short lines, each its own field, with a way to add one and to take one out. */
function LineList({
  label,
  lines,
  onChange,
  onDone,
  max = 8,
}: {
  label: string;
  lines: readonly string[];
  onChange: (lines: string[]) => void;
  onDone: () => void;
  max?: number;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <span className="text-ui font-medium">{label}</span>
      {lines.map((line, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            aria-label={`${label} ${index + 1}`}
            value={line}
            onChange={(event) =>
              onChange(lines.map((item, at) => (at === index ? event.target.value : item)))
            }
            onBlur={onDone}
          />
          <IconButton
            label={`Remove ${label.toLowerCase()} ${index + 1}`}
            size="sm"
            onClick={() => {
              onChange(lines.filter((_, at) => at !== index));
              onDone();
            }}
          >
            <X size={14} strokeWidth={1.8} aria-hidden />
          </IconButton>
        </div>
      ))}
      {lines.length < max && (
        <Button size="sm" className="self-start" onClick={() => onChange([...lines, ''])}>
          <Plus size={14} strokeWidth={1.8} aria-hidden />
          Add
        </Button>
      )}
    </div>
  );
}

function TextPart({
  label,
  value,
  onChange,
  onDone,
  tall,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onDone: () => void;
  tall?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <Textarea
        id={id}
        value={value}
        className={tall ? 'min-h-32' : 'min-h-20'}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onDone}
      />
    </Field>
  );
}

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel aria-label={title}>
      <PanelHeader title={title} />
      <div className="flex flex-col gap-5 px-6 pb-6">{children}</div>
    </Panel>
  );
}

/** The mentor drafting, with what it is doing now. */
function Drafting({ experiment }: { experiment: WspExperiment }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 text-center">
      <Spinner tone="mentor" size={24} label="Drafting" />
      <p className="m-0 text-body font-medium">
        {mentorName(experiment.mentor)} is drafting the brief
      </p>
      {experiment.activity && <p className="m-0 text-ui">{experiment.activity}</p>}
    </div>
  );
}

export interface BriefForm {
  title: string;
  brief: WspBrief;
}

/**
 * Step four: the brief the mentor drafted, every part of it open to edit, and the budget it runs
 * under. Each edit is saved when the field is left; Start experiment approves it as it stands.
 */
export function BriefStep({
  experiment,
  form,
  onChange,
  onSave,
  onRedraft,
  redrafting,
}: {
  experiment: WspExperiment;
  form: BriefForm | null;
  onChange: (form: BriefForm) => void;
  /** Saves what was edited, if anything was. */
  onSave: () => void;
  onRedraft: () => void;
  redrafting: boolean;
}) {
  if (experiment.status === 'briefing') {
    return (
      <StepBody title="The brief">
        <Drafting experiment={experiment} />
      </StepBody>
    );
  }
  if (form === null) {
    return (
      <StepBody title="The brief">
        <ErrorState
          title="The brief couldn't be drafted"
          message={experiment.error ?? `${mentorName(experiment.mentor)} gave no brief.`}
          onRetry={onRedraft}
          retryLabel={redrafting ? 'Drafting again' : 'Draft again'}
        />
      </StepBody>
    );
  }
  const { brief } = form;
  const setBrief = (patch: Partial<WspBrief>) =>
    onChange({ ...form, brief: { ...brief, ...patch } });
  const setDecoding = <K extends keyof WspDecoding>(key: K, value: number | undefined) => {
    if (value === undefined) return;
    setBrief({
      controls: { ...brief.controls, decoding: { ...brief.controls.decoding, [key]: value } },
    });
  };
  const { limits } = experiment;
  return (
    <StepBody title="The brief">
      {experiment.mentor.standIn && <StandInNote />}
      <div className="flex flex-col gap-4">
        <Field label="Title" htmlFor="wsp-brief-title">
          <Input
            id="wsp-brief-title"
            value={form.title}
            maxLength={120}
            onChange={(event) => onChange({ ...form, title: event.target.value })}
            onBlur={onSave}
          />
        </Field>
      </div>

      <Part title="Plan">
        <TextPart
          label="Objective"
          value={brief.objective}
          onChange={(objective) => setBrief({ objective })}
          onDone={onSave}
        />
        <TextPart
          label="Baseline"
          value={brief.baseline}
          onChange={(baseline) => setBrief({ baseline })}
          onDone={onSave}
        />
        <TextPart
          label="Investigation"
          value={brief.investigation}
          onChange={(investigation) => setBrief({ investigation })}
          onDone={onSave}
          tall
        />
        <TextPart
          label="Expected output"
          value={brief.expectedOutput}
          onChange={(expectedOutput) => setBrief({ expectedOutput })}
          onDone={onSave}
        />
      </Part>

      <Part title="Success">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-ui font-medium">Target</span>
          <Segmented
            aria-label="Target metric"
            options={METRICS}
            value={brief.target.metric}
            onValueChange={(metric) => {
              setBrief({ target: { ...brief.target, metric } });
              onSave();
            }}
          />
        </div>
        <div className="-mt-3 max-w-[480px]">
          <NumberRow
            label={brief.target.metric === 'pass_rate' ? 'Least gain on dev' : 'Least cut on dev'}
            unit="points"
            value={brief.target.minPoints}
            min={0}
            max={100}
            onChange={(minPoints) => {
              if (minPoints !== undefined) setBrief({ target: { ...brief.target, minPoints } });
            }}
          />
        </div>
        <LineList
          label="Success criteria"
          lines={brief.successCriteria}
          onChange={(successCriteria) => setBrief({ successCriteria })}
          onDone={onSave}
        />
        <LineList
          label="Regression checks"
          lines={brief.regressionChecks}
          onChange={(regressionChecks) => setBrief({ regressionChecks })}
          onDone={onSave}
        />
      </Part>

      <Part title="Controls">
        <div className="flex max-w-[480px] flex-col" onBlur={onSave}>
          <span className="pb-1 text-ui font-medium">Decoding control</span>
          <NumberRow
            label="Temperature"
            value={brief.controls.decoding.temperature}
            min={0}
            max={2}
            onChange={(value) => setDecoding('temperature', value)}
          />
          <NumberRow
            label="Top p"
            value={brief.controls.decoding.topP}
            min={0.01}
            max={1}
            onChange={(value) => setDecoding('topP', value)}
          />
          <NumberRow
            label="Repetition penalty"
            value={brief.controls.decoding.repetitionPenalty}
            min={1}
            max={2}
            onChange={(value) => setDecoding('repetitionPenalty', value)}
          />
          <NumberRow
            label="Max new tokens"
            value={brief.controls.decoding.maxNewTokens}
            integer
            min={8}
            max={4096}
            onChange={(value) => setDecoding('maxNewTokens', value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <ToggleRow
            label="Instructions control"
            type="Text"
            checked={brief.controls.instructions !== null}
            onCheckedChange={(on) => {
              setBrief({
                controls: {
                  ...brief.controls,
                  instructions: on ? (brief.controls.instructions ?? '') : null,
                },
              });
              if (!on) onSave();
            }}
          />
          {brief.controls.instructions !== null && (
            <Textarea
              aria-label="System instruction"
              value={brief.controls.instructions}
              placeholder="A system instruction the base model is given instead of an edit"
              onChange={(event) =>
                setBrief({ controls: { ...brief.controls, instructions: event.target.value } })
              }
              onBlur={onSave}
            />
          )}
        </div>
      </Part>

      <Part title="Budget">
        <DetailList
          valueFont="text"
          items={[
            { label: 'Programs', value: limits.programs },
            { label: 'Forward passes', value: limits.forwardPasses },
            { label: 'Wall time', value: minutesText(limits.wallMinutes) },
            { label: 'Mentor spend', value: `Up to ${formatCost(limits.mentorUsd)}` },
            { label: 'Per program', value: `${limits.programSeconds} s` },
            {
              label: 'Weights changed',
              value: `At most ${Number((limits.maxChangedFraction * 100).toPrecision(3))}%`,
            },
            { label: 'Worker memory', value: `${limits.memoryGb} GB` },
          ]}
        />
      </Part>
    </StepBody>
  );
}
