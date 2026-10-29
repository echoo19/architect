import { Button, cn, EvidenceMark, Heading, Panel } from '@architect/ui';
import { Check, ChevronRight, Pause, Square } from 'lucide-react';
import { ChartLegend, ScoreChart, type ChartTimes } from './chart';
import { FlowBar } from './flow-bar';
import { AppWindow } from './frame';
import { at } from './motion';
import { ChapterStage } from './stage';

/** When things happen in this chapter, in ms from the start. */
const TIMES: ChartTimes = {
  firstRise: 600,
  branch: 1500,
  flat: 2000,
  secondRise: 2400,
  pending: 3150,
  last: 4900,
};
const SCORE_STEPS = [
  { value: '40%', count: '16 of 40', at: 0 },
  { value: '65%', count: '26 of 40', at: 1350 },
  { value: '78%', count: '31 of 40', at: 3050 },
  { value: '90%', count: '36 of 40', at: 5500 },
] as const;
const STATUS = [
  { text: 'Glimmer is working through practice tasks', at: 0 },
  { text: 'Spark is reading the failures', at: 1500 },
  { text: 'Scoring the change on the check tasks', at: 3200 },
  { text: 'Wrapping up', at: 6300 },
] as const;
const STAGES = ['Practice', 'Diagnose', 'Score'] as const;
const RESULT_AT = 5700;

/** The score now, which rolls up to each new figure as the line reaches it. */
function Score() {
  return (
    <span className="grid overflow-hidden">
      {SCORE_STEPS.map((step, index) => {
        const next = SCORE_STEPS[index + 1];
        const last = index === SCORE_STEPS.length - 1;
        const row = (
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-hero font-medium leading-none tracking-tightest tabular-nums narrow:text-display">
              {step.value}
            </span>
            <EvidenceMark kind="check" className="text-md text-fg-secondary">
              on check tasks
            </EvidenceMark>
            <span className="text-sm tabular-nums text-fg-muted">{step.count}</span>
          </span>
        );
        return (
          <span
            key={step.value}
            className={cn('[grid-area:1/1]', index > 0 && 'a a-roll-in', !last && 'motion-only')}
            style={index > 0 ? at(step.at + 60, { dur: 520 }) : undefined}
          >
            {next ? (
              <span className="a a-roll-out block" style={at(next.at - 120, { dur: 300 })}>
                {row}
              </span>
            ) : (
              row
            )}
          </span>
        );
      })}
    </span>
  );
}

/** Spark's rings, still: the mentor as the Train screen draws it, without the turning. */
function Orb() {
  const ring = (r: number, opacity: number, gap: number) => (
    <circle
      r={r}
      fill="none"
      stroke="currentColor"
      strokeOpacity={opacity}
      strokeWidth={4}
      strokeLinecap="round"
      strokeDasharray={`0 ${gap}`}
    />
  );
  return (
    <svg
      width={76}
      height={76}
      viewBox="-100 -100 200 200"
      aria-hidden
      className="shrink-0 text-mentor"
    >
      <circle r={94} fill="none" stroke="currentColor" strokeOpacity={0.1} />
      {ring(80, 0.25, 15)}
      {ring(60, 0.45, 13)}
      {ring(41, 0.7, 11)}
      <circle r={25} fill="none" stroke="currentColor" strokeOpacity={0.3} />
      <circle r={15} fill="currentColor" />
    </svg>
  );
}

/** A steady spread of 0 to 1 for a point's place in the grid, the same on every machine. */
const scatter = (index: number, step: number, offset: number, modulus: number) =>
  ((index * step + offset) % modulus) / modulus;

/** Glimmer's grid of points; the share that is lit follows how well it scores. */
function Tile() {
  const cells = Array.from({ length: 81 }, (_, index) => {
    const shade = scatter(index, 7919, 13, 97);
    const order = scatter(index, 104729, 7, 89);
    const alpha = order < 0.78 ? 0.42 + shade * 0.42 : 0.08 + shade * 0.1;
    return Math.round(alpha * 100);
  });
  return (
    <span
      aria-hidden
      className="flex size-[76px] shrink-0 items-center justify-center rounded-[20px] border border-student-tile-line bg-student-tile"
    >
      <span className="grid grid-cols-[repeat(9,4px)] gap-[2.6px]">
        {cells.map((alpha, index) => (
          <span
            key={index}
            className="size-1 rounded-full"
            style={{
              backgroundColor: `color-mix(in srgb, var(--ui-student) ${alpha}%, transparent)`,
            }}
          />
        ))}
      </span>
    </span>
  );
}

/** The panel that shows the two models at work, and which step of the round it is. */
function Apprenticeship() {
  return (
    <Panel aria-label="Spark is mentoring Glimmer" className="narrow:hidden">
      <div className="flex items-center gap-5 px-7 py-5">
        <div className="flex w-[260px] shrink-0 items-center gap-4">
          <Orb />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-mentor">Spark</span>
            <span className="text-sm text-fg-muted">Teaching</span>
          </span>
        </div>
        <span className="relative grid min-w-0 flex-1 justify-items-center text-center text-lg text-pretty">
          {STATUS.map((status, index) => {
            const next = STATUS[index + 1];
            const last = index === STATUS.length - 1;
            const line = <span>{status.text}</span>;
            return (
              <span
                key={status.text}
                className={cn(
                  '[grid-area:1/1]',
                  index > 0 && 'a a-roll-in',
                  !last && 'motion-only',
                )}
                style={index > 0 ? at(status.at + 40, { dur: 440 }) : undefined}
              >
                {next ? (
                  <span className="a a-roll-out block" style={at(next.at - 100, { dur: 300 })}>
                    {line}
                  </span>
                ) : (
                  line
                )}
              </span>
            );
          })}
        </span>
        <div className="flex w-[260px] shrink-0 items-center justify-end gap-4">
          <span className="flex flex-col items-end gap-0.5 text-right">
            <span className="font-medium text-student">Glimmer</span>
            <span className="text-sm text-fg-muted">Learning on this computer</span>
          </span>
          <Tile />
        </div>
      </div>
      <div className="flex min-h-12 items-center gap-4 border-t border-line-row-strong bg-aside px-7 py-2 text-sm">
        <span aria-hidden className="flex items-center gap-4 text-fg-faint">
          Each round
          <span className="h-4 w-px bg-line-row-strong" />
        </span>
        <ol aria-label="Each round" className="m-0 flex list-none items-center gap-2 p-0">
          {STAGES.map((stage, index) => {
            const starts = STATUS[index]?.at ?? 0;
            const ends = STATUS[index + 1]?.at ?? 0;
            return (
              <li key={stage} className="flex items-center gap-2">
                {index > 0 && (
                  <ChevronRight size={13} strokeWidth={1.8} aria-hidden className="text-fg-ghost" />
                )}
                <span className="relative pb-0.5 text-fg-muted">
                  {stage}
                  {/* The line under the step the round is on, passed from one step to the next. */}
                  {index === 0 && (
                    <span aria-hidden className="motion-only absolute inset-x-0 bottom-0 h-0.5">
                      <span
                        className="a a-unwipe block h-full bg-fg"
                        style={at(ends - 20, { dur: 320 })}
                      />
                    </span>
                  )}
                  {index > 0 && (
                    <span aria-hidden className="motion-only absolute inset-x-0 bottom-0 h-0.5">
                      <span className="a a-wipe block h-full" style={at(starts, { dur: 360 })}>
                        <span
                          className="a a-unwipe block h-full bg-fg"
                          style={at(ends - 20, { dur: 320 })}
                        />
                      </span>
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}

/** The round Spark is on: what Glimmer got wrong, what Spark makes of it, and what it expects. */
function RoundCard() {
  return (
    <Panel
      padded
      aria-label="Current round"
      className="min-w-0 flex-[5_1_0%] gap-4 p-6 narrow:flex-none narrow:gap-3 narrow:p-4"
    >
      <Heading as="h3">Round 4: Allow for zone travel time</Heading>
      <div className="flex flex-col gap-1.5 narrow:hidden">
        <span className="text-student">Glimmer</span>
        <p className="a a-wipe m-0 text-md text-fg-soft text-pretty" style={at(700, { dur: 1300 })}>
          Booked an urgent repair in zone C for 08:00, but the technician first has to drive 90
          minutes from zone A.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-mentor">Spark</span>
        <p
          className="a a-wipe m-0 text-md text-fg-soft text-pretty"
          style={at(2200, { dur: 1300 })}
        >
          <span className="narrow:hidden">Glimmer books slots too early. It ignores</span>
          <span className="hidden narrow:inline">Glimmer ignores</span> the drive between zones, so
          3 of 4 scheduling failures pick a slot nobody can reach in time.
        </p>
      </div>
      <div className="mt-auto flex flex-col gap-3 border-t border-line-row-strong pt-4">
        <div
          className="a a-up flex items-baseline justify-between gap-3 narrow:hidden"
          style={at(3300, { dy: 10 })}
        >
          <span className="grid text-fg-secondary">
            <span
              className="a a-exit-up motion-only [grid-area:1/1]"
              style={at(RESULT_AT - 60, { dur: 200, dy: 0 })}
            >
              Spark expects
            </span>
            <span
              className="a a-up [grid-area:1/1]"
              style={at(RESULT_AT - 60, { dur: 260, dy: 6 })}
            >
              Spark expected
            </span>
          </span>
          <span>
            <span className="font-mono tabular-nums">+3 to +6</span>{' '}
            <span className="text-fg-secondary">check tasks</span>
          </span>
        </div>
        <div
          className="a a-unfold flex items-baseline justify-between gap-3"
          style={at(RESULT_AT, { dur: 520 })}
        >
          <span className="text-fg-secondary">Result</span>
          <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-2">
            <Check size={14} strokeWidth={2} aria-hidden className="shrink-0 text-student" />
            <span className="text-student">Kept</span>
            <span className="text-fg-secondary">
              · 5 more <span className="narrow:hidden">check tasks </span>passed
            </span>
          </span>
        </div>
      </div>
    </Panel>
  );
}

/**
 * Watching it learn: Spark reads where Glimmer went wrong, makes one change, and the change is
 * scored on check tasks Spark never sees. The line climbs for a change that is kept; a change that
 * was tried and not kept leaves a hollow point and no climb.
 */
export function TrainMock() {
  return (
    <ChapterStage
      id="train"
      label="The Architect Train screen. Spark, the large model, has read where Glimmer, the small model, went wrong in round 4 and made one change. A chart of the score on check tasks Spark never sees climbs over four rounds; one change that was tried and not kept leaves a hollow point. Round 4 is kept and the score reaches the 90 percent target."
      heightWide={700}
      heightCompact={760}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar
          title="Service desk"
          current={2}
          actions={
            <>
              <Button variant="secondary" size="sm" tabIndex={-1}>
                <Pause size={13} fill="currentColor" strokeWidth={0} aria-hidden />
                Pause
              </Button>
              <Button variant="secondary" size="sm" tabIndex={-1}>
                <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden />
                Stop
              </Button>
            </>
          }
        />
        <div className="min-h-0 flex-1 overflow-hidden bg-ground-flow bg-dot-grid p-6 narrow:p-4">
          <div className="flex flex-col gap-5 narrow:gap-4">
            <Apprenticeship />
            <p className="m-0 hidden flex-wrap gap-x-5 gap-y-0.5 px-1 text-sm text-fg-muted narrow:flex">
              <span>
                <span className="font-medium text-mentor">Spark</span> teaching
              </span>
              <span>
                <span className="font-medium text-student">Glimmer</span> learning on this computer
              </span>
            </p>
            <div className="flex items-stretch gap-5 narrow:flex-col narrow:gap-4">
              <Panel
                aria-label="Score on the check tasks"
                className="min-w-0 flex-[7_1_0%] gap-2.5 px-8 pb-2 pt-6 narrow:flex-none narrow:px-5 narrow:pt-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Score />
                  <ChartLegend />
                </div>
                <ScoreChart times={TIMES} className="narrow:hidden" />
                <ScoreChart times={TIMES} compact className="hidden narrow:block" />
              </Panel>
              <RoundCard />
            </div>
          </div>
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
