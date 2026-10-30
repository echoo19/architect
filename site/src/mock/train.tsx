import { Button, cn, EvidenceMark, Heading, Meter, Panel } from '@architect/ui';
import { ArrowRight, Check, ChevronRight, Pause, Square } from 'lucide-react';
import { ChartLegend, ScoreChart, type ChartTimes } from './chart';
import { FlowBar } from './flow-bar';
import { AppWindow } from './frame';
import { at } from './motion';
import { ChapterStage } from './stage';

/**
 * Training as the Train screen shows it once the run has ended: the returns desk of comparison 2,
 * a made-up business. The figures are the run's own. Check tasks went from 31 of 45 to 44 of 45
 * over four rounds against a target of 95%; rounds 2 and 3 were not kept; the run took 28 minutes
 * and 4 of its 7 rounds, and cost Spark $0.34 of $4.92.
 */

/** When things happen in this chapter, in ms from the start. */
const TIMES: ChartTimes = {
  rise1: 600,
  hollow2: 2000,
  hollow3: 2900,
  pending: 4800,
  rise4: 5600,
};
const SCORE_STEPS = [
  { value: '69%', count: '31 of 45', at: 0 },
  { value: '93%', count: '42 of 45', at: 1350 },
  { value: '98%', count: '44 of 45', at: 6300 },
] as const;
const STATUS = [
  { text: 'Glimmer is working through practice tasks', at: 0 },
  { text: 'Spark is reading the failures', at: 3300 },
  { text: 'Scoring the change on the check tasks', at: 4800 },
  { text: 'Training is done, and Glimmer took the final test', at: 7300 },
] as const;
const STAGES = ['Practice', 'Diagnose', 'Score'] as const;
const ROUND_AT = 3300;
const DIAGNOSIS_AT = 3800;
const EXPECTED_AT = 4900;
const RESULT_AT = 6500;
const DONE_AT = 7300;

/** The score now, which rolls up to each new figure as the line reaches it. */
function Score() {
  return (
    <span className="grid overflow-hidden">
      {SCORE_STEPS.map((step, index) => {
        const next = SCORE_STEPS[index + 1];
        const last = index === SCORE_STEPS.length - 1;
        const row = (
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-hero font-semibold leading-none tabular-nums narrow:text-title">
              {step.value}
            </span>
            <EvidenceMark kind="check" className="text-body text-fg">
              on check tasks
            </EvidenceMark>
            <span className="text-small tabular-nums text-fg">{step.count}</span>
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
    const alpha = order < 0.9 ? 0.42 + shade * 0.42 : 0.08 + shade * 0.1;
    return Math.round(alpha * 100);
  });
  return (
    <span
      aria-hidden
      className="flex size-[76px] shrink-0 items-center justify-center rounded-card bg-field shadow-edge"
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

/** What the run is doing now, rolling up to the next line as the round moves on. */
function Status({ className }: { className?: string }) {
  return (
    <span
      role="status"
      className={cn(
        'relative grid justify-items-center text-center text-body text-pretty',
        className,
      )}
    >
      {STATUS.map((status, index) => {
        const next = STATUS[index + 1];
        const last = index === STATUS.length - 1;
        const line = <span>{status.text}</span>;
        return (
          <span
            key={status.text}
            className={cn('[grid-area:1/1]', index > 0 && 'a a-roll-in', !last && 'motion-only')}
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
  );
}

/** What a model is doing under its name while the run goes; once it has ended, nothing. */
function Role({ children }: { children: string }) {
  return (
    <span
      className="a a-exit-up motion-only text-small text-fg"
      style={at(DONE_AT - 100, { dur: 240, dy: 0 })}
    >
      {children}
    </span>
  );
}

/** The panel that shows the two models at work, and which step of the round it is. */
function Apprenticeship() {
  return (
    <Panel aria-label="Spark is mentoring Glimmer" className="narrow:hidden">
      <div className="flex flex-1 items-center gap-4 px-7 py-6">
        <div className="flex w-[132px] shrink-0 flex-col items-center gap-3 text-center">
          <Orb />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-mentor">Spark</span>
            <Role>Teaching</Role>
          </span>
        </div>
        <Status className="min-w-0 flex-1" />
        <div className="flex w-[132px] shrink-0 flex-col items-center gap-3 text-center">
          <Tile />
          <span className="flex flex-col gap-0.5">
            <span className="font-medium text-student">Glimmer</span>
            <Role>Learning online</Role>
          </span>
        </div>
      </div>
      <div className="flex min-h-12 items-center gap-4 border-t border-line bg-card px-7 py-2 text-small">
        <span aria-hidden className="flex items-center gap-4 text-fg">
          Each round
          <span className="h-4 w-px bg-line" />
        </span>
        <ol aria-label="Each round" className="m-0 flex list-none items-center gap-2 p-0">
          {STAGES.map((stage, index) => {
            const starts = STATUS[index]?.at ?? 0;
            const ends = STATUS[index + 1]?.at ?? 0;
            return (
              <li key={stage} className="flex items-center gap-2">
                {index > 0 && (
                  <ChevronRight size={13} strokeWidth={1.8} aria-hidden className="text-fg" />
                )}
                <span className="relative pb-0.5 text-fg">
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

/** The round Spark is on: what Glimmer is doing, what Spark makes of it, and what it expects. */
function RoundCard() {
  return (
    <Panel
      padded
      aria-label="Current round"
      className="a a-up min-w-0 gap-4 p-6 narrow:order-3 narrow:gap-3 narrow:p-4"
      style={at(ROUND_AT, { dy: 18, dur: 600 })}
    >
      <Heading as="h3">Round 4: Parse dirty money with numeric extraction in helpers</Heading>
      <div className="flex flex-col gap-1.5">
        <span className="text-mentor">Spark</span>
        <p
          className="a a-wipe m-0 text-body text-fg text-pretty"
          style={at(DIAGNOSIS_AT, { dur: 1300 })}
        >
          Glimmer&apos;s helpers misread money written as &quot;$74.95&quot; or &quot;74.95
          USD&quot;.
        </p>
      </div>
      <div className="mt-auto flex flex-col gap-3 border-t border-line pt-4">
        <div
          className="a a-up flex items-baseline justify-between gap-3"
          style={at(EXPECTED_AT, { dy: 10 })}
        >
          <span className="grid text-fg">
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
            <span className="font-mono tabular-nums">+2 to +4</span>{' '}
            <span className="text-fg">check tasks</span>
          </span>
        </div>
        <div
          className="a a-unfold flex items-baseline justify-between gap-3"
          style={at(RESULT_AT, { dur: 520 })}
        >
          <span className="text-fg">Result</span>
          <span className="flex items-center gap-2">
            <Check size={14} strokeWidth={2} aria-hidden className="shrink-0 text-student" />
            <span className="text-student">Kept</span>
          </span>
        </div>
      </div>
    </Panel>
  );
}

/** The score on check tasks, and the chart of it round by round. */
function ScorePanel() {
  return (
    <Panel
      aria-label="Score on the check tasks"
      className="min-w-0 gap-2.5 px-8 pb-2 pt-6 narrow:order-2 narrow:px-5 narrow:pt-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Score />
        <ChartLegend />
      </div>
      <ScoreChart times={TIMES} className="narrow:hidden" />
      <ScoreChart times={TIMES} compact className="hidden narrow:block" />
    </Panel>
  );
}

/** One of the run's limits: what it has used of what it was allowed, and a bar of the share. */
function Budget({
  label,
  used,
  max,
  fraction,
  order,
}: {
  label: string;
  used: string;
  max: string;
  fraction: number;
  order: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-fg">{label}</span>
        <span className="font-mono tabular-nums">
          {used} <span className="text-fg">/ {max}</span>
        </span>
      </div>
      <span className="a a-wipe block" style={at(DONE_AT + 300 + order * 160, { dur: 700 })}>
        <Meter label={label} value={fraction} valueText={`${used} of ${max}`} />
      </span>
    </div>
  );
}

/** Time, money and rounds used against the job's caps, and the changes kept of those tried. */
function Resources() {
  return (
    <Panel
      padded
      aria-label="Resources"
      className="a a-up min-w-0 justify-between gap-[18px] p-6 narrow:hidden"
      style={at(DONE_AT, { dy: 18, dur: 600 })}
    >
      <Budget label="Time" used="28 min" max="12 h" fraction={28 / 720} order={0} />
      <Budget label="Spark's cost" used="$0.34" max="$4.92" fraction={0.34 / 4.92} order={1} />
      <Budget label="Rounds" used="4" max="7" fraction={4 / 7} order={2} />
      <div className="flex items-baseline justify-between gap-3 border-t border-line pt-[18px]">
        <span className="text-fg">Changes kept</span>
        <span className="font-mono tabular-nums">
          2 <span className="text-fg">/ 4</span>
        </span>
      </div>
    </Panel>
  );
}

/** The run's limits as a phone has room for them: the same four figures, without the bars. */
function CompactResources() {
  const facts = [
    ['Time', '28 min', '12 h'],
    ["Spark's cost", '$0.34', '$4.92'],
    ['Rounds', '4', '7'],
    ['Changes kept', '2', '4'],
  ] as const;
  return (
    <Panel
      aria-label="Resources"
      className="a a-up hidden grid-cols-2 gap-x-4 gap-y-3 p-4 narrow:order-4 narrow:grid"
      style={at(DONE_AT, { dy: 18, dur: 600 })}
    >
      {facts.map(([label, used, max]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <span className="text-small text-fg">{label}</span>
          <span className="whitespace-nowrap font-mono text-small tabular-nums">
            {used} <span className="text-fg">/ {max}</span>
          </span>
        </div>
      ))}
    </Panel>
  );
}

/**
 * Watching it learn: the returns desk of comparison 2, from 31 of 45 check tasks to 44 of 45.
 * Spark reads where Glimmer went wrong and makes one change a round, and a change stays only if
 * the score goes up on check tasks Spark never sees. Two changes were tried and not kept.
 */
export function TrainMock() {
  return (
    <ChapterStage
      id="train"
      label="The Architect Train screen for the Returns desk, when training is done. A chart of the score on check tasks, which Spark sees only the score of, climbs from 69 percent, 31 of 45, to 98 percent, 44 of 45, over four rounds against a target of 95 percent. Rounds 2 and 3 were tried and not kept. In round 4 Spark found that Glimmer's helpers misread money written as $74.95 or 74.95 USD, and its change was kept. The run took 28 minutes and 4 of 7 rounds, and cost Spark 34 cents."
      heightWide={735}
      heightCompact={960}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar
          title="Returns desk"
          current={2}
          actions={
            <span className="grid justify-items-end [&>*]:[grid-area:1/1]">
              <span
                className="a a-exit-up motion-only flex gap-2"
                style={at(DONE_AT - 100, { dur: 240, dy: 0 })}
              >
                <Button variant="secondary" size="sm" tabIndex={-1}>
                  <Pause size={13} fill="currentColor" strokeWidth={0} aria-hidden />
                  Pause
                </Button>
                <Button variant="secondary" size="sm" tabIndex={-1}>
                  <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden />
                  Stop
                </Button>
              </span>
              <span className="a a-pop" style={at(DONE_AT, { dur: 320 })}>
                <Button variant="primary" size="sm" tabIndex={-1}>
                  See the results
                  <ArrowRight size={15} strokeWidth={2} aria-hidden />
                </Button>
              </span>
            </span>
          }
        />
        <div className="min-h-0 flex-1 overflow-hidden bg-ground p-6 narrow:p-4">
          <div className="flex flex-col gap-4 narrow:gap-4">
            <Status className="hidden narrow:grid" />
            <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-5 narrow:grid-cols-1 narrow:gap-4">
              <Apprenticeship />
              <RoundCard />
              <ScorePanel />
              <Resources />
              <CompactResources />
            </div>
          </div>
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
