import type { CSSProperties, ReactNode } from 'react';
import { EvidenceMark, Meter, Spinner, stepPath } from '@architect/ui';
import {
  Check,
  CircleDollarSign,
  Clock,
  Cloud,
  Repeat,
  TrendingUp,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { ROUNDS } from '../lab/data';
import { clamp, inOutCubic, mix, outQuart, span, ui } from '../lab/time';
import { TRAINING } from './data';
import { T } from './timeline';

/**
 * Train, rebuilt from the app's training screen (screens/TrainScreen.tsx, flow/train/LiveStatus.tsx,
 * TaskSuccess.tsx, Budget.tsx and Rounds.tsx, and the LineChart of packages/ui): what the run is
 * doing now, the score on the held-out checks with the time, Spark's teaching and the rounds used
 * under it, the step chart of that score against the target with the practice tasks beside it,
 * and the rounds. The academy field's first run plays out on it, every moment set from the film's
 * clock: round 1 lands before the harness drawer opens, round 2 is rolled back under the drawer
 * and shows on the chart as it closes, and round 3 reaches 35 of 36 on its word.
 */

const rate = (pass: number, of: number) => (pass / of) * 100;
const [R1, R2, R3] = TRAINING.rounds;
const SCORES = {
  start: rate(TRAINING.start, TRAINING.of),
  one: rate(R1.after, TRAINING.of),
  undone: rate(R2.after, TRAINING.of),
  three: rate(R3.after, TRAINING.of),
};
const PRACTICE = TRAINING.rounds.map((round) => rate(round.practice, TRAINING.practiceOf));

/** The run's moments, in film seconds. */
const AT = {
  /** Round 1's score lands: the step from the start up to it. */
  scored1: T.train + 1.2,
  /** Round 2 begins as the harness drawer opens; its practice is in when Spark reads the failures. */
  round2: T.harness + 0.2,
  practice2: T.harness + 1.8,
  diagnose2: T.harness + 1.9,
  /** Round 2 is undone under the drawer, and the chart shows it as the drawer goes. */
  round3: T.rolledBack + 0.1,
  undone: T.harnessOut + 0.05,
  practice3: T.harnessOut + 0.55,
  score3: T.harnessOut + 0.6,
  /** Round 3's step: along to round 3, then up to 35 of 36 on the word. */
  scored3: T.pushScore,
  rise3: T.pushScore + 0.35,
  /** Training is over; the sealed final test starts without Spark. */
  final: T.thirtyFive + 1.0,
} as const;

type Stage = 'attempting' | 'diagnosing' | 'evaluating' | 'testing';

export interface Phase {
  at: number;
  stage: Stage;
  /** Tasks done in the step, counted from `from` to `to` of `of` over `dur` seconds once it starts. */
  count?: { of: number; from: number; to: number; dur: number };
}

/** What the run does, in turn (flow/train/phase.ts names each). */
const PHASES: readonly Phase[] = [
  { at: -Infinity, stage: 'evaluating', count: { of: 36, from: 22, to: 36, dur: 1.15 } },
  { at: AT.round2, stage: 'attempting', count: { of: 12, from: 0, to: 12, dur: 1.5 } },
  { at: AT.diagnose2, stage: 'diagnosing' },
  { at: T.hypothesis, stage: 'evaluating', count: { of: 36, from: 0, to: 36, dur: 5.9 } },
  { at: AT.round3, stage: 'attempting', count: { of: 12, from: 0, to: 12, dur: 1.1 } },
  // Round 3's checks are all scored before its step rises to the score they make.
  { at: AT.score3, stage: 'evaluating', count: { of: 36, from: 0, to: 36, dur: 0.65 } },
  { at: AT.final, stage: 'testing', count: { of: 120, from: 0, to: 120, dur: 60 } },
];

/**
 * The opening's shorter telling of the same run: Spark reads the failures, then Glimmer practices
 * and its change is scored, on the same moments of the screen's clock.
 */
export const HOOK_PHASES: readonly Phase[] = [
  { at: -Infinity, stage: 'diagnosing' },
  PHASES[4]!,
  PHASES[5]!,
];

const ROUND_STAGES = ['attempting', 'diagnosing', 'evaluating'] as const;
const STAGE_LABELS: Record<Stage, string> = {
  attempting: 'Practice',
  diagnosing: 'Diagnose',
  evaluating: 'Score',
  testing: 'Sealed final test',
};

function phaseAt(phases: readonly Phase[], t: number): number {
  let found = 0;
  phases.forEach((phase, index) => {
    if (phase.at <= t) found = index;
  });
  return found;
}

/** How far a phase's count has gone, and the count itself. */
function counted(phase: Phase, t: number): { done: number; share: number } | null {
  const { count } = phase;
  if (!count) return null;
  const start = Number.isFinite(phase.at) ? phase.at + 0.1 : T.train;
  const done = Math.round(mix(count.from, count.to, span(t, start, count.dur)));
  return { done, share: done / count.of };
}

/** Each step's fill in a phase: the ones before it full, the one under way by its count. */
function shares(phase: Phase, t: number): number[] {
  const current = ROUND_STAGES.indexOf(phase.stage as (typeof ROUND_STAGES)[number]);
  return ROUND_STAGES.map((_, index) =>
    index < current ? 1 : index === current ? (counted(phase, t)?.share ?? 1) : 0,
  );
}

function Named({ stage }: { stage: Stage }) {
  switch (stage) {
    case 'attempting':
      return (
        <>
          <span className="text-student">Glimmer</span> is working through practice tasks
        </>
      );
    case 'diagnosing':
      return (
        <>
          <span className="text-mentor">Spark</span> is reading the failures
        </>
      );
    case 'evaluating':
      return <>Scoring the change on the held-out checks</>;
    case 'testing':
      return (
        <>
          Sealed final test, <span className="text-mentor">Spark</span> disconnected
        </>
      );
  }
}

/** The student's grid of points, lit as far as its score, each pinging in turn. */
function StudentMark({ t, lit }: { t: number; lit: number }) {
  return (
    <span className="grid grid-cols-[repeat(5,4px)] gap-[2px]">
      {Array.from({ length: 25 }, (_, index) => {
        const shade = frac(Math.sin(index * 12.9898) * 43758.5453);
        const order = frac(Math.sin(index * 78.233) * 12345.6789);
        const alpha = order < lit ? 0.45 + shade * 0.45 : 0.1 + shade * 0.12;
        const phase = frac(t / 5.6 + order);
        const ping = phase < 0.06 ? phase / 0.06 : phase < 0.18 ? 1 - (phase - 0.06) / 0.12 : 0;
        return (
          <span
            key={index}
            className="size-1 rounded-full"
            style={{
              backgroundColor: `color-mix(in srgb, color-mix(in srgb, var(--ui-student) ${Math.round(alpha * 100)}%, transparent), color-mix(in srgb, var(--ui-student) 35%, var(--ui-fg)) ${Math.round(ping * 100)}%)`,
            }}
          />
        );
      })}
    </span>
  );
}

const frac = (x: number) => x - Math.floor(x);

/** The mentor's rings, turning while it reads the failures. */
function MentorMark({ t }: { t: number }) {
  return (
    <svg width={32} height={32} viewBox="-16 -16 32 32" className="text-mentor">
      <circle
        r={14.5}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.3}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray="0 3.6"
        transform={`rotate(${(t / 9) * 360})`}
      />
      <circle
        r={9.5}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.55}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray="0 3"
        transform={`rotate(${(-t / 6) * 360})`}
      />
      <circle r={4.5} fill="currentColor" />
    </svg>
  );
}

/** Two states laid over each other: the one before fades quickly, the new one slides in. */
function Swap({
  t,
  at,
  before,
  after,
  dx = 24,
  className,
}: {
  t: number;
  at: number;
  before: ReactNode;
  after: ReactNode;
  dx?: number;
  className?: string;
}) {
  // The one before is gone before the new one starts: the two are never seen together.
  const gone = span(t, at, 0.1);
  const p = outQuart(span(t, at + 0.1, 0.36));
  return (
    <span className={`grid ${className ?? ''}`}>
      {gone < 1 && (
        <span className="[grid-area:1/1]" style={{ opacity: 1 - gone }}>
          {before}
        </span>
      )}
      {p > 0 && (
        <span
          className="[grid-area:1/1]"
          style={{ opacity: p, transform: `translateX(${(1 - p) * dx}px)` }}
        >
          {after}
        </span>
      )}
    </span>
  );
}

/** What the run is doing now: whoever works shows its mark, and the round's steps fill. */
function LiveStatus({ t, score, phases }: { t: number; score: number; phases: readonly Phase[] }) {
  const index = phaseAt(phases, t);
  const phase = phases[index]!;
  const before = phases[index - 1] ?? phase;
  const mark = (stage: Stage) =>
    stage === 'diagnosing' ? <MentorMark t={t} /> : <StudentMark t={t} lit={score / 100} />;
  const settle = outQuart(span(t, phase.at, 0.36));
  const now = shares(phase, t);
  const was = shares(before, phase.at);
  const testing = phase.stage === 'testing';
  const count = counted(phase, t);
  const tally = (of: Phase, at: number) => {
    const done = counted(of, at)?.done;
    return done === undefined ? null : `${done} of ${of.count?.of}`;
  };
  return (
    <section
      className="flex items-center gap-4 border-b border-line pb-6"
      data-frame="train-status"
    >
      <span className="flex size-8 shrink-0 items-center justify-center">
        <Swap
          t={t}
          at={phase.at}
          dx={0}
          before={mark(before.stage)}
          after={mark(phase.stage)}
          className="place-items-center"
        />
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 font-display text-h2 font-semibold">
          <Swap
            t={t}
            at={phase.at}
            before={<Named stage={before.stage} />}
            after={<Named stage={phase.stage} />}
          />
        </p>
      </div>
      <span className="text-ui tabular-nums">
        <Swap
          t={t}
          at={phase.at}
          dx={0}
          before={tally(before, phase.at)}
          after={tally(phase, t)}
          className="justify-items-end"
        />
      </span>
      <span className="grid">
        <ol
          className="m-0 flex list-none items-end gap-2 p-0 text-small [grid-area:1/1]"
          style={{ opacity: testing ? 1 - span(t, phase.at, 0.1) : 1 }}
        >
          {ROUND_STAGES.map((stage, i) => {
            const current = !testing && stage === phase.stage;
            const share = mix(was[i]!, now[i]!, settle);
            return (
              <li key={stage} className="flex min-w-24 flex-col gap-2">
                <span className={current ? 'whitespace-nowrap font-medium' : 'whitespace-nowrap'}>
                  {STAGE_LABELS[stage]}
                </span>
                <Meter
                  label={STAGE_LABELS[stage]}
                  value={share}
                  tone={current ? (stage === 'diagnosing' ? 'mentor' : 'student') : 'fg'}
                />
              </li>
            );
          })}
        </ol>
        {testing && (
          <ol
            className="m-0 flex list-none items-end justify-end p-0 text-small [grid-area:1/1]"
            style={{ opacity: outQuart(span(t, phase.at + 0.1, 0.36)) }}
          >
            <li className="flex min-w-24 flex-col gap-2">
              <span className="whitespace-nowrap font-medium">{STAGE_LABELS.testing}</span>
              <Meter label={STAGE_LABELS.testing} value={count?.share ?? 0} tone="student" />
            </li>
          </ol>
        )}
      </span>
      <span className="flex size-6 items-center justify-center">
        <Cloud size={16} strokeWidth={1.8} aria-hidden />
      </span>
    </section>
  );
}

/* The chart, drawn as packages/ui's LineChart draws it at the screen's size, set from the film's clock. */

const CHART = { width: 540, height: 300 } as const;
const PAD = { left: 48, right: 12, top: 24, bottom: 38 } as const;
const Y_RANGE = [40, 100] as const;
const UNIT = (CHART.width - PAD.left - PAD.right) / TRAINING.caps.rounds;
const BOTTOM = CHART.height - PAD.bottom;
const px = (x: number) => PAD.left + x * UNIT;
const py = (value: number) =>
  BOTTOM - ((value - Y_RANGE[0]) / (Y_RANGE[1] - Y_RANGE[0])) * (BOTTOM - PAD.top);
const valueAt = (y: number) =>
  Y_RANGE[0] + ((BOTTOM - y) / (BOTTOM - PAD.top)) * (Y_RANGE[1] - Y_RANGE[0]);

type Point = { x: number; y: number };

/** A step from one point to the next as it is drawn: along at the old level, then up to the new. */
function step(t: number, from: Point, to: Point, at: number, along: number, rise: number): Point {
  const flat = inOutCubic(span(t, at, along));
  const up = outQuart(span(t, at + along, rise));
  return { x: mix(from.x, to.x, flat), y: mix(from.y, to.y, up) };
}

/** Where the main line has got to, and where its head is: the score the agent has now. */
function curve(t: number) {
  const start = { x: px(0), y: py(SCORES.start) };
  const one = { x: px(1), y: py(SCORES.one) };
  const three = { x: px(3), y: py(SCORES.three) };
  const tip1 = step(t, start, one, AT.scored1, 0.3, 0.6);
  const points: Point[] = [start];
  if (t > AT.scored1) {
    points.push({ x: tip1.x, y: start.y });
    if (tip1.y !== start.y) points.push(tip1);
  }
  // Round 2 keeps nothing, so the kept score is carried on flat to it; round 3 goes on from there.
  const held = mix(one.x, px(2), inOutCubic(span(t, AT.undone, 0.35)));
  const tip3 = step(t, one, three, AT.scored3, 0.35, T.thirtyFive - AT.rise3);
  const flatEnd = Math.max(held, tip3.x);
  if (t > AT.undone || t > AT.scored3) points.push({ x: flatEnd, y: one.y });
  if (tip3.y !== one.y) points.push(tip3);
  const head = t < AT.scored3 ? (t < AT.scored1 + 0.9 ? tip1 : one) : tip3;
  return { points, head, start, one, three };
}

/** The score the screen shows: the main line's head, read off the chart. */
function scoreAt(t: number): number {
  return valueAt(curve(t).head.y);
}

const grow = (t: number, at: number, dur = 0.3) => outQuart(span(t, at, dur));

function ScoreChart({ t }: { t: number }) {
  const { points, head, start, one, three } = curve(t);
  const last = points.at(-1)!;
  const band = 1 + ui(t, AT.scored1 + 0.6, 0.35) + ui(t, AT.undone + 0.2, 0.35);
  const bandShown = 1 - ui(t, T.thirtyFive - 0.3, 0.3);
  const practice = PRACTICE.map((value, index) => ({ x: px(index + 1), y: py(value) }));
  const practice2 = grow(t, AT.practice2, 0.3);
  const practice3 = grow(t, AT.practice3, 0.3);
  const practiceLine = [
    practice[0]!,
    ...(practice2 > 0
      ? [
          {
            x: mix(practice[0]!.x, practice[1]!.x, practice2),
            y: mix(practice[0]!.y, practice[1]!.y, practice2),
          },
        ]
      : []),
    ...(practice3 > 0
      ? [
          {
            x: mix(practice[1]!.x, practice[2]!.x, practice3),
            y: mix(practice[1]!.y, practice[2]!.y, practice3),
          },
        ]
      : []),
  ];
  const practiceDots = [1, grow(t, AT.practice2 + 0.2), grow(t, AT.practice3 + 0.2)];
  const drop = outQuart(span(t, AT.undone + 0.15, 0.4));
  const ring = { x: px(2), y: mix(py(SCORES.one), py(SCORES.undone), drop) };
  const ringShown = grow(t, AT.undone + 0.15, 0.25);
  const keptOne = grow(t, AT.scored1 + 0.85);
  const keptThree = grow(t, T.thirtyFive - 0.05);
  const reached = Math.min(3, Math.floor(band + 0.5));
  return (
    <svg
      width={CHART.width}
      height={CHART.height}
      viewBox={`0 0 ${CHART.width} ${CHART.height}`}
      className="block overflow-visible"
    >
      {[40, 60, 80, 100].map((value) => (
        <g key={value}>
          <line
            x1={PAD.left}
            x2={CHART.width - PAD.right}
            y1={py(value)}
            y2={py(value)}
            className="stroke-line"
          />
          <text
            x={PAD.left - 12}
            y={py(value) + 4.5}
            textAnchor="end"
            className="fill-fg text-small tabular-nums"
          >
            {value}%
          </text>
        </g>
      ))}
      <line
        x1={PAD.left}
        x2={CHART.width - PAD.right}
        y1={BOTTOM}
        y2={BOTTOM}
        className="stroke-line-strong"
      />
      {[0, 1, 2, 3].map((round) => {
        const live = clamp(1 - Math.abs(band - round)) * bandShown;
        const label = round === 0 ? 'Start' : String(round);
        const weight = round <= reached ? 'font-medium' : '';
        return (
          <g key={round}>
            <line
              x1={px(round)}
              x2={px(round)}
              y1={BOTTOM}
              y2={BOTTOM + 4}
              className="stroke-line-strong"
            />
            <text
              x={px(round)}
              y={BOTTOM + 25}
              textAnchor="middle"
              className={`fill-fg text-small tabular-nums ${weight}`}
              opacity={1 - live}
            >
              {label}
            </text>
            {live > 0 && (
              <text
                x={px(round)}
                y={BOTTOM + 25}
                textAnchor="middle"
                className="fill-mentor text-small font-medium tabular-nums"
                opacity={live}
              >
                {label}
              </text>
            )}
          </g>
        );
      })}
      {bandShown > 0 && (
        <rect
          x={px(band) - 20}
          y={PAD.top}
          width={40}
          height={BOTTOM - PAD.top}
          rx={8}
          className="fill-mentor/10"
          opacity={bandShown}
        />
      )}
      {/* The target, labelled at its left: round 3's step rises past its right end. */}
      <line
        x1={PAD.left}
        x2={CHART.width - PAD.right}
        y1={py(TRAINING.target)}
        y2={py(TRAINING.target)}
        className="stroke-fg/50"
        strokeDasharray="3 5"
      />
      <text
        x={PAD.left + 8}
        y={py(TRAINING.target) - 8}
        className="fill-fg text-small font-medium tabular-nums"
      >
        Target {TRAINING.target}%
      </text>
      {points.length > 1 && (
        <path
          d={`${stepPath(points.map(({ x, y }) => ({ x, y })))}V${BOTTOM}H${start.x}Z`}
          className="fill-student/10"
        />
      )}
      {bandShown > 0 && px(band) > last.x + 1 && (
        <line
          x1={last.x}
          x2={px(band)}
          y1={last.y}
          y2={last.y}
          className="stroke-mentor"
          strokeWidth={1.75}
          strokeDasharray="2 5"
          strokeLinecap="round"
          opacity={bandShown}
        />
      )}
      {practiceLine.length > 1 && (
        <polyline
          points={practiceLine.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          className="stroke-fg opacity-55"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
      )}
      {practice.map((point, index) =>
        practiceDots[index]! > 0 ? (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={2.75 * practiceDots[index]!}
            className="fill-fg opacity-80"
          />
        ) : null,
      )}
      {points.length > 1 && (
        <path
          d={stepPath(points)}
          fill="none"
          className="stroke-student"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {ringShown > 0 && (
        <g>
          <line
            x1={ring.x}
            x2={ring.x}
            y1={py(SCORES.one)}
            y2={ring.y}
            className="stroke-fg/60"
            strokeWidth={1.5}
            strokeDasharray="2 3"
          />
          <circle
            cx={ring.x}
            cy={ring.y}
            r={4.5 * ringShown}
            strokeWidth={1.75}
            className="fill-ground stroke-fg"
          />
        </g>
      )}
      {[
        { point: start, p: 1 },
        { point: one, p: keptOne },
        { point: three, p: keptThree },
      ].map(({ point, p }, index) =>
        p > 0 ? (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={4 * p}
            strokeWidth={2}
            className="fill-student stroke-ground"
          />
        ) : null,
      )}
      <circle
        cx={head.x}
        cy={head.y}
        r={10}
        fill="none"
        className="stroke-student opacity-35"
        strokeWidth={1.5}
      />
      <circle cx={head.x} cy={head.y} r={5.5} className="fill-student" />
    </svg>
  );
}

function Swatch({ kind }: { kind: 'main' | 'line' | 'ring' }) {
  return (
    <svg width={18} height={10} viewBox="0 0 18 10" aria-hidden className="shrink-0">
      {kind === 'main' && (
        <line
          x1={1}
          x2={17}
          y1={5}
          y2={5}
          strokeWidth={2.5}
          strokeLinecap="round"
          className="stroke-student"
        />
      )}
      {kind === 'line' && (
        <>
          <line x1={1} x2={17} y1={5} y2={5} strokeWidth={1.5} className="stroke-fg opacity-55" />
          <circle cx={9} cy={5} r={2.75} className="fill-fg opacity-80" />
        </>
      )}
      {kind === 'ring' && (
        <circle cx={9} cy={5} r={3.75} strokeWidth={1.5} className="fill-ground stroke-fg" />
      )}
    </svg>
  );
}

function Legend({ t }: { t: number }) {
  const notKept = grow(t, AT.undone + 0.3, 0.4);
  const items = [
    { label: 'Held-out checks', kind: 'main', p: 1 },
    { label: 'Practice tasks', kind: 'line', p: 1 },
    { label: 'Not kept', kind: 'ring', p: notKept },
  ] as const;
  return (
    <ul className="m-0 flex list-none items-center gap-x-6 p-0 pl-12 text-small">
      {items.map((item) => (
        <li
          key={item.label}
          className="flex items-center gap-2"
          style={{ opacity: item.p, transform: `translateY(${(1 - item.p) * 6}px)` }}
        >
          <Swatch kind={item.kind} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function BudgetMeter({
  icon: Icon,
  label,
  used,
  max,
  share,
  tone = 'fg',
}: {
  icon: LucideIcon;
  label: string;
  used: string;
  max: string;
  share: number;
  tone?: 'fg' | 'mentor';
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Icon size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
        <span className="ml-auto shrink-0 tabular-nums">
          <span className="font-medium">{used}</span> <span>/ {max}</span>
        </span>
      </div>
      <Meter label={label} value={share} tone={tone} thickness={4} />
    </div>
  );
}

/** Spark's spend so far: each round's cost comes in while Spark reads that round's failures. */
function sparkCost(t: number): number {
  return (
    R1.cost +
    R2.cost * outQuart(span(t, AT.diagnose2, 1.5)) +
    R3.cost * outQuart(span(t, AT.score3 - 0.2, 0.5))
  );
}

function roundsUsed(t: number): number {
  return 1 + ui(t, AT.round2, 0.36) + ui(t, AT.round3, 0.36);
}

function Budget({ t }: { t: number }) {
  const minutes = Math.round(mix(3, TRAINING.minutes, span(t, T.train, T.thirtyFive - T.train)));
  const cost = sparkCost(t);
  const rounds = roundsUsed(t);
  const { caps } = TRAINING;
  return (
    <section className="flex flex-col gap-5 border-t border-line pt-6">
      <BudgetMeter
        icon={Clock}
        label="Time"
        used={`${minutes} min`}
        max={`${caps.minutes / 60} h`}
        share={minutes / caps.minutes}
      />
      <BudgetMeter
        icon={CircleDollarSign}
        label="Spark teaching"
        used={`$${cost.toFixed(2)}`}
        max={`$${caps.usd}`}
        share={cost / caps.usd}
        tone="mentor"
      />
      <BudgetMeter
        icon={Repeat}
        label="Rounds"
        used={String(Math.round(rounds))}
        max={String(caps.rounds)}
        share={rounds / caps.rounds}
      />
    </section>
  );
}

/** The score, its count of the held-out checks and the gain since the start, then the budget. */
function Score({ t }: { t: number }) {
  const score = scoreAt(t);
  const shown = Math.round(score);
  const gain = shown - Math.round(SCORES.start);
  const passed = Math.round((score / 100) * TRAINING.of);
  return (
    <div className="flex flex-col gap-6">
      <span
        className="w-fit font-display text-hero font-semibold leading-none tabular-nums"
        data-frame="train-score"
      >
        {shown}%
      </span>
      <div className="flex flex-col gap-2">
        <EvidenceMark kind="check" className="text-ui font-medium">
          Held-out checks
        </EvidenceMark>
        <span className="text-ui tabular-nums">
          {passed} of {TRAINING.of}
        </span>
        <span
          className="flex items-center gap-2 text-ui tabular-nums"
          style={{ opacity: ui(t, AT.scored1 + 0.3, 0.3) }}
        >
          <TrendingUp size={16} strokeWidth={1.8} aria-hidden className="text-student" />+{gain}{' '}
          points from {Math.round(SCORES.start)}%
        </span>
      </div>
      <Budget t={t} />
    </div>
  );
}

/** How a round ended, as the Rounds list says it. */
function Outcome({ kept, p }: { kept: boolean; p: number }) {
  const style: CSSProperties = { opacity: p, transform: `translateX(${(1 - p) * 8}px)` };
  return kept ? (
    <span
      className="flex w-[128px] items-center justify-end gap-2 text-small text-student"
      style={style}
    >
      <Check size={14} strokeWidth={2} aria-hidden />
      Kept
    </span>
  ) : (
    <span className="flex w-[128px] items-center justify-end gap-2 text-small" style={style}>
      <Undo2 size={14} strokeWidth={2} aria-hidden />
      No gain
    </span>
  );
}

/** Every round, newest first, with what it did to the held-out checks and how it ended. */
function Rounds({ t }: { t: number }) {
  const decided = [AT.scored1 + 0.9, T.rolledBack, T.thirtyFive];
  const begun = [-Infinity, AT.round2, AT.round3];
  const tried = decided.filter((at) => t >= at).length;
  const kept = [decided[0]!, decided[2]!].filter((at) => t >= at).length;
  return (
    <section className="flex min-w-0 flex-col">
      <header
        className="flex min-h-10 items-center justify-between gap-4 pb-3"
        data-frame="train-rounds"
      >
        <h2 className="m-0 font-display text-h2 font-semibold">Rounds</h2>
        {tried > 0 && (
          <span className="text-small tabular-nums">
            {kept} kept of {tried} {tried === 1 ? 'change' : 'changes'}
          </span>
        )}
      </header>
      <ol className="m-0 list-none border-b border-line p-0">
        {[...ROUNDS].reverse().map((round) => {
          const index = Number(round.number) - 1;
          if (t < begun[index]!) return null;
          const done = grow(t, decided[index]!);
          return (
            <li key={round.number} className="border-t border-line" style={rise(t, begun[index]!)}>
              <div className="grid min-h-12 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-4 py-2 text-ui">
                <span className="font-mono text-small tabular-nums">{round.number}</span>
                <span className="truncate">{round.title}</span>
                <span className="grid justify-items-end">
                  {done < 1 && (
                    <span
                      className="flex w-[128px] items-center justify-end gap-2 text-small [grid-area:1/1]"
                      style={{ opacity: 1 - done }}
                    >
                      In progress
                      <Spinner tone="mentor" />
                    </span>
                  )}
                  {done > 0 && (
                    <span className="flex items-center justify-end gap-6 [grid-area:1/1]">
                      <span
                        className="w-[112px] text-right font-mono text-small tabular-nums"
                        style={{ opacity: done }}
                      >
                        {round.before}% → {round.after}%
                      </span>
                      <Outcome kept={round.kept} p={done} />
                    </span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function rise(t: number, at: number): CSSProperties {
  if (!Number.isFinite(at)) return {};
  const p = outQuart(span(t, at, 0.45));
  return { opacity: p, transform: `translateY(${(1 - p) * 8}px)` };
}

/** The training screen at a moment of the film, telling its run as `phases` do. */
export function TrainPage({ t, phases = PHASES }: { t: number; phases?: readonly Phase[] }) {
  return (
    <div className="mx-auto flex w-[860px] flex-col gap-10 pt-8">
      <LiveStatus t={t} score={scoreAt(t)} phases={phases} />
      <section className="grid grid-cols-[264px_minmax(0,1fr)] items-start gap-x-14">
        <Score t={t} />
        <figure className="m-0 flex min-w-0 flex-col gap-3">
          <ScoreChart t={t} />
          <Legend t={t} />
        </figure>
      </section>
      <Rounds t={t} />
    </div>
  );
}
