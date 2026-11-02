import { Fragment, useMemo, type CSSProperties } from 'react';
import type { RunStatus } from '@architect/shared';
import { cn, Meter, NumberTicker, StepTransition, Tooltip } from '@architect/ui';
import { Check, CircleAlert, Cloud, Laptop, Square } from 'lucide-react';
import { useWords } from '../../shell/edition';
import { Counted } from '../counted';
import { ROUND_STAGES, STAGE_LABELS, type PhaseView, type Stage } from './phase';
import type { EvalProgress } from './run-state';
import './live-status.css';

const CYCLE_S = 5.6;
const GRID = 5;

const frac = (x: number) => x - Math.floor(x);

/**
 * The student's grid of points. The share of lit points follows the current pass rate, so the grid
 * fills in as the student improves.
 */
function gridCells(litShare: number): CSSProperties[] {
  return Array.from({ length: GRID * GRID }, (_, index) => {
    const shade = frac(Math.sin(index * 12.9898) * 43758.5453);
    const order = frac(Math.sin(index * 78.233) * 12345.6789);
    const alpha = order < litShare ? 0.45 + shade * 0.45 : 0.1 + shade * 0.12;
    return {
      '--live-cell': `color-mix(in srgb, var(--ui-student) ${Math.round(alpha * 100)}%, transparent)`,
      animationDelay: `${(-order * CYCLE_S).toFixed(2)}s`,
    } as CSSProperties;
  });
}

interface LiveStatusProps {
  mentor: string;
  student: string;
  /** Where the student runs right now, in a sentence: "online" or "on this computer". */
  studentPlace: string;
  /** The student runs online rather than on this computer. */
  hosted: boolean;
  status: RunStatus;
  view: PhaseView;
  /** The current round writes the first full draft rather than one watched change. */
  drafting: boolean;
  /** A round has begun; before it, scoring the start has no steps before it. */
  inRound: boolean;
  /** The current pass rate on check tasks, 0 to 1, once measured. */
  passRate: number | null;
  progress: EvalProgress | null;
  /** Practice tasks answered so far in the round, while the student practices. */
  practice: { done: number; total: number } | null;
}

/**
 * What the run is doing now, in one line: whoever is working shows its mark, the line says what it
 * is doing, and the steps of a round show where in it the run is.
 */
export function LiveStatus({
  mentor,
  student,
  studentPlace,
  hosted,
  status,
  view,
  drafting,
  inRound,
  passRate,
  progress,
  practice,
}: LiveStatusProps) {
  const w = useWords();
  // A draft round makes no practice attempts: the mentor writes the draft, then it is checked.
  const stages: readonly Stage[] =
    view.stage === 'testing' ? ['testing'] : drafting ? ['diagnosing', 'evaluating'] : ROUND_STAGES;
  const label =
    view.motion === 'testing'
      ? `${student} is taking the ${w.finalTest}`
      : `${mentor} is teaching ${student}`;
  const stepsLabel = view.stage === 'testing' ? 'After training' : 'Each round';
  const counted = progress ?? (view.stage === 'attempting' ? practice : null);
  const stepShare = counted && counted.total > 0 ? counted.done / counted.total : null;
  const place =
    view.motion === 'testing'
      ? `taking the ${w.finalTest} ${studentPlace}`
      : `learning ${studentPlace}`;

  return (
    <section
      aria-label={label}
      data-motion={view.motion}
      data-frozen={view.frozen || undefined}
      className="live-status flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line pb-6"
    >
      <Mark view={view} status={status} passRate={passRate} />
      <div role="status" className="min-w-0 flex-1 basis-64">
        {/* The run moves from one step to the next, so the line says so by moving too. */}
        <StepTransition transitionKey={view.text}>
          <p className="m-0 font-display text-h2 font-semibold text-balance">
            <Named text={view.text} mentor={mentor} student={student} />
          </p>
        </StepTransition>
      </div>
      {counted && (
        <span className="text-ui tabular-nums">
          <Counted said={`${counted.done} of ${counted.total}`}>
            <NumberTicker value={counted.done} /> of <NumberTicker value={counted.total} />
          </Counted>
        </span>
      )}
      {/* A run that has ended has no step under way, so its steps go with it. */}
      {view.motion !== 'still' && (
        <ol aria-label={stepsLabel} className="m-0 flex list-none items-end gap-2 p-0 text-small">
          {stages.map((stage, index) => {
            const reached = view.stage === null || !inRound ? -1 : stages.indexOf(view.stage);
            const current = stage === view.stage;
            const name =
              drafting && stage === 'diagnosing'
                ? 'Write first draft'
                : stage === 'testing'
                  ? w.FinalTest
                  : STAGE_LABELS[stage];
            // The step under way fills as its tasks are done, in the color of whoever does it;
            // the steps before it are full.
            const share = current ? (stepShare ?? 1) : index < reached ? 1 : 0;
            return (
              <li
                key={stage}
                aria-current={current ? 'step' : undefined}
                className="flex min-w-24 flex-col gap-2"
              >
                <span className={cn('whitespace-nowrap', current && 'font-medium')}>{name}</span>
                <Meter
                  label={name}
                  value={share}
                  valueText={current ? 'Under way' : index < reached ? 'Done' : 'Not yet'}
                  tone={current ? stageTone(stage) : 'fg'}
                />
              </li>
            );
          })}
        </ol>
      )}
      {view.motion !== 'still' && (
        <Tooltip content={`${student} is ${place}`}>
          <span
            tabIndex={0}
            role="img"
            aria-label={`${student} is ${place}`}
            className="flex size-6 items-center justify-center rounded-mark"
          >
            {hosted ? (
              <Cloud size={16} strokeWidth={1.8} aria-hidden />
            ) : (
              <Laptop size={16} strokeWidth={1.8} aria-hidden />
            )}
          </span>
        </Tooltip>
      )}
    </section>
  );
}

/** Whoever does a step: the student answers tasks, the mentor reads what went wrong. */
function stageTone(stage: Stage): 'student' | 'mentor' {
  return stage === 'diagnosing' ? 'mentor' : 'student';
}

/** A line with each model's name in its own color, so who does what reads at a glance. */
function Named({ text, mentor, student }: { text: string; mentor: string; student: string }) {
  const pattern = new RegExp(`(${[mentor, student].map(escape).join('|')})`);
  return (
    <>
      {text.split(pattern).map((part, index) => (
        <Fragment key={index}>
          {part === mentor ? (
            <span className="text-mentor">{part}</span>
          ) : part === student ? (
            <span className="text-student">{part}</span>
          ) : (
            part
          )}
        </Fragment>
      ))}
    </>
  );
}

function escape(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whoever is working: the mentor's rings while it reads, the student's points while it answers. */
function Mark({
  view,
  status,
  passRate,
}: {
  view: PhaseView;
  status: RunStatus;
  passRate: number | null;
}) {
  const cells = useMemo(() => gridCells(passRate ?? 0.35), [passRate]);
  if (view.motion === 'still') return <EndMark status={status} />;
  const student =
    view.motion === 'practising' || view.motion === 'checking' || view.motion === 'testing';
  return (
    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center">
      {student ? (
        <span className="grid grid-cols-[repeat(5,4px)] gap-[2px]">
          {cells.map((style, index) => (
            <span key={index} className="live-cell" style={style} />
          ))}
        </span>
      ) : (
        <svg width={32} height={32} viewBox="-16 -16 32 32" className="live-mentor text-mentor">
          <circle
            r={14.5}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray="0 3.6"
            className="live-ring live-ring-outer"
          />
          <circle
            r={9.5}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.55}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray="0 3"
            className="live-ring live-ring-inner"
          />
          <circle r={4.5} fill="currentColor" />
        </svg>
      )}
    </span>
  );
}

/** How a run that has ended ended, as a mark: done, stopped, or on an error. */
function EndMark({ status }: { status: RunStatus }) {
  const Icon = status === 'failed' ? CircleAlert : status === 'stopped' ? Square : Check;
  const tone = status === 'failed' ? 'text-danger' : status === 'stopped' ? '' : 'text-student';
  return (
    <span aria-hidden className="flex size-8 shrink-0 items-center justify-center">
      <Icon
        size={status === 'stopped' ? 16 : 22}
        strokeWidth={status === 'stopped' ? 0 : 2}
        {...(status === 'stopped' ? { fill: 'currentColor' } : {})}
        className={tone}
      />
    </span>
  );
}
