import { useMemo, type CSSProperties } from 'react';
import { cn, Panel } from '@architect/ui';
import { ChevronRight } from 'lucide-react';
import { capitalized, MENTOR_ROLE, STUDENT_ROLE } from '../../lib/names';
import {
  motionCaption,
  ROUND_STAGES,
  STAGE_LABELS,
  type Motion,
  type PhaseView,
  type Stage,
} from './phase';
import type { EvalProgress } from './run-state';
import './apprenticeship.css';

const CYCLE_S = 5.6;
const GRID = 9;

/** Which flow pills drop at the gate, in the order they're chosen as more tasks fail. */
const REJECT_ORDER = [3, 0, 4, 1, 5, 2];

type PillKind = 'pass' | 'reject' | 'return';

interface Pill {
  kind: PillKind;
  /** Where in the cycle the pill is at time zero, 0 to 1. */
  offset: number;
}

const frac = (x: number) => x - Math.floor(x);

/**
 * The student's grid of points, the same scatter as the design. The share of lit points follows
 * the current pass rate, so the grid fills in as the student improves.
 */
function gridCells(litShare: number): CSSProperties[] {
  return Array.from({ length: GRID * GRID }, (_, index) => {
    const shade = frac(Math.sin(index * 12.9898) * 43758.5453);
    const order = frac(Math.sin(index * 78.233) * 12345.6789);
    const alpha = order < litShare ? 0.42 + shade * 0.42 : 0.08 + shade * 0.1;
    return {
      '--arch-cell': `color-mix(in srgb, var(--ui-student) ${Math.round(alpha * 100)}%, transparent)`,
      animationDelay: `${(-order * CYCLE_S).toFixed(2)}s`,
    } as CSSProperties;
  });
}

function pillsFor(motion: Motion, passRate: number | null): Pill[] {
  if (motion === 'returning') {
    return [0, 1, 2].map((slot) => ({ kind: 'return', offset: (slot + 0.5) / 3 }));
  }
  if (motion !== 'practising' && motion !== 'checking') return [];
  const failing = Math.min(5, Math.max(1, Math.round((1 - (passRate ?? 0.8)) * 6)));
  const rejects = new Set(REJECT_ORDER.slice(0, failing));
  return Array.from({ length: 6 }, (_, slot) => ({
    kind: rejects.has(slot) ? 'reject' : 'pass',
    offset: (slot + 0.5) / 6,
  }));
}

/** The pill's place in a still frame, for people who prefer reduced motion. */
function stillStyle({ kind, offset }: Pill): Record<string, string> {
  const along = (share: number) =>
    `calc(${(share * 100).toFixed(1)}% - ${(share * 20).toFixed(1)}px)`;
  if (kind === 'return') {
    return {
      '--arch-still-left': along(1 - offset),
      '--arch-still-color': offset > 0.6 ? 'var(--ui-mentor)' : 'var(--ui-fg-faint)',
    };
  }
  const crossed = offset >= 0.56;
  if (kind === 'reject' && crossed) {
    return {
      '--arch-still-left': '54.5%',
      '--arch-still-color': 'var(--ui-fg-faint)',
      '--arch-still-drop': '16px',
    };
  }
  return {
    '--arch-still-left': along(offset),
    '--arch-still-color': crossed ? 'var(--ui-student)' : 'var(--arch-from)',
    '--arch-still-fill': crossed ? 'var(--ui-student)' : 'transparent',
  };
}

interface ApprenticeshipProps {
  mentor: string;
  student: string;
  /** Where the student runs right now: a hosted copy while practicing there, else this computer. */
  studentPlace: string;
  view: PhaseView;
  /** The current round writes the first full draft rather than one watched change. */
  drafting: boolean;
  /** The current pass rate on check tasks, 0 to 1, once measured. */
  passRate: number | null;
  progress: EvalProgress | null;
}

/** The mentor teaching the student, animated by what the run is doing now. */
export function Apprenticeship({
  mentor,
  student,
  studentPlace,
  view,
  drafting,
  passRate,
  progress,
}: ApprenticeshipProps) {
  const cells = useMemo(() => gridCells(passRate ?? 0.35), [passRate]);
  const pills = pillsFor(view.motion, passRate);
  const caption = motionCaption(view.motion, { mentor, student }, drafting);
  // A draft round makes no practice attempts: Spark writes the draft, then it is checked.
  const stages: readonly Stage[] =
    view.stage === 'testing' ? ['testing'] : drafting ? ['diagnosing', 'evaluating'] : ROUND_STAGES;
  const label =
    view.motion === 'testing'
      ? `${student} is taking the final test`
      : `${mentor} is mentoring ${student}`;

  return (
    <Panel aria-label={label} className="min-w-0 flex-[7_1_560px]">
      <div
        className="arch-stage flex min-h-[320px] flex-1 items-center px-11 py-9"
        data-motion={view.motion}
        data-frozen={view.frozen || undefined}
      >
        <div className="arch-mentor flex flex-none flex-col items-center gap-4">
          <svg
            width={150}
            height={150}
            viewBox="-100 -100 200 200"
            aria-hidden
            className="text-mentor"
          >
            <circle r={94} fill="none" stroke="currentColor" strokeOpacity={0.08} />
            <Ring className="arch-ring-outer" r={80} opacity={0.22} gap={7.5} />
            <Ring className="arch-ring-middle" r={60} opacity={0.42} gap={6.5} />
            <Ring className="arch-ring-inner" r={41} opacity={0.68} gap={5.5} />
            <circle r={25} fill="none" stroke="currentColor" strokeOpacity={0.25} />
            <circle r={15} fill="currentColor" />
          </svg>
          <ModelName
            name={mentor}
            tone="text-mentor"
            role={`${capitalized(MENTOR_ROLE)}, in the cloud`}
          />
        </div>

        <div className="arch-track">
          <span className="arch-line arch-line-mentor" aria-hidden />
          <span className="arch-line arch-line-student" aria-hidden />
          <span className="arch-gate" aria-hidden />
          {pills.map((pill, index) => (
            <span
              key={`${view.motion}-${index}`}
              aria-hidden
              className="arch-pill"
              data-kind={pill.kind}
              style={
                {
                  animationDelay: `${(-pill.offset * CYCLE_S).toFixed(2)}s`,
                  ...stillStyle(pill),
                } as CSSProperties
              }
            />
          ))}
          {caption && <p className="arch-caption text-sm text-fg-muted text-balance">{caption}</p>}
        </div>

        <div className="flex flex-none flex-col items-center gap-4">
          <div className="flex size-[150px] items-center justify-center rounded-[32px] border border-student-tile-line bg-student-tile">
            <div className="grid grid-cols-[repeat(9,7px)] gap-2" aria-hidden>
              {cells.map((style, index) => (
                <span key={index} className="arch-cell" style={style} />
              ))}
            </div>
          </div>
          <ModelName
            name={student}
            tone="text-student"
            role={`${capitalized(STUDENT_ROLE)}, ${studentPlace}`}
          />
        </div>
      </div>

      <div className="flex min-h-14 flex-wrap items-center gap-x-5 gap-y-1 border-t border-line-row-strong bg-aside px-7 py-2">
        <ol
          aria-label={view.stage === 'testing' ? 'After training' : 'Steps of a round'}
          className="m-0 flex list-none items-center gap-2 p-0 text-sm"
        >
          {stages.map((stage, index) => (
            <li
              key={stage}
              aria-current={stage === view.stage ? 'step' : undefined}
              className="flex items-center gap-2"
            >
              {index > 0 && (
                <ChevronRight size={13} strokeWidth={1.8} aria-hidden className="text-fg-ghost" />
              )}
              <span
                className={cn(
                  'border-b-2 pb-0.5',
                  stage === view.stage
                    ? 'border-fg font-medium text-fg'
                    : 'border-transparent text-fg-muted',
                )}
              >
                {drafting && stage === 'diagnosing' ? 'Write first draft' : STAGE_LABELS[stage]}
              </span>
            </li>
          ))}
        </ol>
        <span role="status" className="min-w-0 flex-1 truncate text-md">
          {view.text}
        </span>
        {progress && (
          <span className="shrink-0 font-mono text-sm tabular-nums text-fg-muted">
            {progress.done} of {progress.total}
          </span>
        )}
      </div>
    </Panel>
  );
}

/** A model's name in its color, and its role under it. */
function ModelName({ name, tone, role }: { name: string; tone: string; role: string }) {
  return (
    <div className="flex max-w-[180px] flex-col items-center gap-0.5 text-center">
      <span className={cn('font-medium', tone)}>{name}</span>
      <span className="text-sm text-fg-muted text-balance">{role}</span>
    </div>
  );
}

function Ring({
  className,
  r,
  opacity,
  gap,
}: {
  className: string;
  r: number;
  opacity: number;
  gap: number;
}) {
  return (
    <circle
      className={cn('arch-ring', className)}
      r={r}
      fill="none"
      stroke="currentColor"
      strokeOpacity={opacity}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeDasharray={`0 ${gap}`}
    />
  );
}
