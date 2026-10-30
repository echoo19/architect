import { useId } from 'react';
import { MENTOR_PRESETS, type MentorPreset, type ReasoningEffort } from '@architect/shared';
import { ChoiceTiles, NumberTicker, Segmented, Slider, type ChoiceTile } from '@architect/ui';
import { Cloud, Server } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import { mentorFromPreset, mentorNote, mentorProvider } from '../../onboarding/mentor';
import { mentorFromChoice } from '../../settings/models/connections';
import { ModelPicker, priceText } from '../../settings/models/ModelPicker';
import { PriceRow } from '../../settings/models/PriceRow';
import { modelNames } from '../names';
import {
  aboutUsd,
  estimateTime,
  expectedMentorUsd,
  mentorPresetOf,
  mentorPriceOf,
} from './estimates';
import { InspectorRow, Issue, KeyIfMissing } from './fields';
import type { InspectorTabProps } from './inspector-tabs';

/** The teacher's models as tiles: open weights on a host you pick are marked as a server. */
const OPEN_HOSTS: readonly MentorPreset['provider'][] = ['baseten', 'modal'];

/**
 * "Spark 1.3", "Spark 1.3 contributor", "Claude Opus 5.5": a preset's name short enough for a
 * tile, without the family every Spark shares or the word "tier".
 */
function tileName(preset: MentorPreset): string {
  return preset.label
    .replace(/^Muse\s+/, '')
    .replace(/,\s*/, ' ')
    .replace(/\s+tier$/, '');
}

const TILES: readonly ChoiceTile<string>[] = MENTOR_PRESETS.map((preset) => ({
  value: preset.key,
  label: tileName(preset),
  icon: OPEN_HOSTS.includes(preset.provider) ? (
    <Server strokeWidth={1.7} />
  ) : (
    <Cloud strokeWidth={1.7} />
  ),
}));

/** A value no tile has: the teacher came from a connection rather than a preset. */
const ELSEWHERE = 'elsewhere';

const EFFORTS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const satisfies readonly { value: ReasoningEffort; label: string }[];

/** The teacher: its model as tiles, any other model a click away, how hard it thinks, its cap. */
export function TeacherTab({ editor, change }: InspectorTabProps) {
  const { job, issues } = editor;
  const { mentor } = job;
  const name = modelNames(job).mentor;
  const preset = mentorPresetOf(job);
  const note = preset ? mentorNote(preset) : undefined;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <ChoiceTiles
          aria-label="Teacher"
          columns={3}
          options={TILES}
          value={preset?.key ?? ELSEWHERE}
          onValueChange={(key) => {
            const chosen = MENTOR_PRESETS.find((candidate) => candidate.key === key);
            if (chosen) {
              change('Teacher', (current) => ({
                ...current,
                mentor: mentorFromPreset(chosen, current.mentor),
              }));
            }
          }}
        />
        <ModelPicker
          role="mentor"
          aria-label="Another model"
          current={mentor.kind === 'model' ? mentor : null}
          onChoose={(choice) =>
            change('Teacher', (current) => ({
              ...current,
              mentor: mentorFromChoice(
                choice,
                current.mentor.kind === 'model' ? current.mentor.reasoningEffort : 'medium',
              ),
            }))
          }
          className="w-full"
        >
          <span className="truncate">{preset ? 'Another model' : mentor.label}</span>
        </ModelPicker>
        {note && <p className="m-0 pt-1 text-small text-pretty">{note}</p>}
      </div>
      {mentor.kind === 'model' && (
        <div className="flex flex-col">
          <InspectorRow label={`How hard ${name} thinks`}>
            <Segmented
              aria-label={`How hard ${name} thinks`}
              options={EFFORTS}
              value={mentor.reasoningEffort}
              onValueChange={(reasoningEffort) =>
                change(`How hard ${name} thinks`, (current) =>
                  current.mentor.kind === 'model'
                    ? { ...current, mentor: { ...current.mentor, reasoningEffort } }
                    : current,
                )
              }
            />
          </InspectorRow>
          <PriceLine editor={editor} change={change} />
          {mentor.secretRef !== undefined && (
            <KeyIfMissing secretRef={mentor.secretRef} provider={mentorProvider(mentor)} />
          )}
        </div>
      )}
      <SpendingCap editor={editor} change={change} />
      <Issue error={issues['mentor']} />
    </div>
  );
}

/** What the teacher costs per million tokens, or a place to enter it when nothing knows it. */
function PriceLine({ editor, change }: InspectorTabProps) {
  const { job, issues } = editor;
  const pricing = mentorPriceOf(job);
  if (pricing) {
    return (
      <InspectorRow label="Price per million tokens">
        <span className="text-ui tabular-nums">{priceText(pricing)}</span>
      </InspectorRow>
    );
  }
  return (
    <PriceRow
      error={issues['mentor.pricing']}
      onSave={(saved) =>
        change('Price', (current) =>
          current.mentor.kind === 'model'
            ? { ...current, mentor: { ...current.mentor, pricing: saved } }
            : current,
        )
      }
    />
  );
}

/** The most the teacher may cost, on a slider, with what it is expected to cost under it. */
export function SpendingCap({ editor, change }: InspectorTabProps) {
  const { job, issues } = editor;
  const id = useId();
  const { mentor } = modelNames(job);
  const cap = job.budget.maxMentorUsd;
  const expected = expectedMentorUsd(job, estimateTime(job, job.student.trainOn));
  const max = Math.max(20, Math.ceil(cap), Math.ceil((expected ?? 0) * 3));
  const label = `${mentor} spending cap`;
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-ui">
          {label}
        </label>
        <span aria-hidden className="font-display text-h2 font-semibold tabular-nums">
          <NumberTicker value={cap} kind="currency" />
        </span>
      </div>
      <Slider
        id={id}
        min={Math.min(1, Math.floor(cap))}
        max={max}
        step={1}
        value={cap}
        onValueChange={(maxMentorUsd) =>
          change(
            label,
            (current) => ({ ...current, budget: { ...current.budget, maxMentorUsd } }),
            400,
          )
        }
        aria-label={label}
        aria-valuetext={formatUsd(cap)}
      />
      <span className="text-small text-pretty">
        {expected === null
          ? `No price on file for ${mentor}`
          : expected < cap
            ? `${aboutUsd(expected)} expected`
            : `${aboutUsd(expected)} expected, more than the cap, so training may stop early`}
      </span>
      <Issue error={issues['budget.maxMentorUsd']} />
    </section>
  );
}
