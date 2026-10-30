import type { ReactNode } from 'react';
import { Button, cn } from '@architect/ui';
import { ArrowRight, Check, EyeOff, Pause, Square, Undo2 } from 'lucide-react';
import { FlowBar } from './flow-bar';
import { AppWindow } from './frame';
import { Insert, Model, Roll, Swap } from './kit';
import { at } from './motion';
import { ScoreChart, type ChartTimes } from './score-chart';
import { ChapterStage } from './stage';

/**
 * Training as the Train screen shows it: the returns desk of comparison 2, a made-up business with
 * a real run. Check tasks went from 31 of 45 to 44 of 45 over four rounds against a target of 95%.
 * Round 1 and round 4 were kept; rounds 2 and 3 gained too little and were reverted. The run took 28
 * minutes and 4 of its 7 rounds, and cost Spark $0.34 of $4.92. The rounds' names and the
 * check-task changes are the run's own record.
 */

/** When things happen in this chapter, in ms from the start. */
const R1 = 500;
const R1_DONE = 1500;
const R2 = 2500;
const R2_DONE = 3200;
const R3 = 3800;
const R3_DONE = 4500;
const R4 = 5100;
const DIAGNOSIS = 5600;
const EXPECTED = 7000;
const R4_DONE = 7900;
const DONE = 8900;

const TIMES: ChartTimes = {
  rise1: R1_DONE,
  hollow2: R2_DONE,
  hollow3: R3_DONE,
  rise4: R4_DONE,
};

const SCORES = [
  { at: 0, value: '69%', count: '31 of 45' },
  { at: R1_DONE + 450, value: '93%', count: '42 of 45' },
  { at: R4_DONE + 450, value: '98%', count: '44 of 45' },
] as const;

/** The score now, which rolls up to each new figure as the line reaches it. */
function Score() {
  return (
    <Roll
      steps={SCORES.map((score) => ({
        at: score.at,
        content: (
          <span className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <span className="font-display text-hero font-semibold leading-none tabular-nums narrow:text-title">
              {score.value}
            </span>
            <span className="flex items-center gap-2 tabular-nums">
              <EyeOff size={15} strokeWidth={1.7} aria-hidden />
              <span>
                {score.count} check tasks
                <span className="hidden narrow:inline">, target 95%</span>
              </span>
            </span>
          </span>
        ),
      }))}
    />
  );
}

/** One of the run's limits: what it has used of what it was allowed. */
function Limit({ label, used, max }: { label: string; used: string; max: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-small">{label}</span>
      <span className="whitespace-nowrap tabular-nums">
        {used} / {max}
      </span>
    </div>
  );
}

function Kept() {
  return (
    <span className="flex items-center gap-1.5 text-small font-medium text-student">
      <Check size={14} strokeWidth={2} aria-hidden />
      Kept
    </span>
  );
}

function Reverted() {
  return (
    <span className="flex items-center gap-1.5 text-small">
      <Undo2 size={14} strokeWidth={1.8} aria-hidden />
      Reverted
    </span>
  );
}

/** One round: when it starts, what Spark changed, and how many more check tasks it passed. */
function Round({
  n,
  title,
  gained,
  kept,
  start,
  done,
  children,
}: {
  n: number;
  title: string;
  gained: string;
  kept: boolean;
  start: number;
  done: number;
  children?: ReactNode;
}) {
  return (
    <li className="list-none">
      <Insert start={start} dur={640}>
        <div className="border-t border-line px-6 py-4 narrow:px-4">
          <div className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-3">
            <span className="font-medium tabular-nums">{String(n).padStart(2, '0')}</span>
            <span className="text-pretty">{title}</span>
            <span
              className="a a-up flex min-w-[64px] flex-col items-end gap-1 tabular-nums"
              style={at(done, { dy: 8, dur: 480 })}
            >
              <span className="font-medium">{gained}</span>
              {kept ? <Kept /> : <Reverted />}
            </span>
          </div>
          {children}
        </div>
      </Insert>
    </li>
  );
}

export function TrainMock() {
  return (
    <ChapterStage
      id="train"
      label="The Architect Train screen for the Returns desk. A chart of the score on check tasks, which Spark never sees, climbs from 69 percent, 31 of 45, to 98 percent, 44 of 45, over four rounds against a target of 95 percent. Round 1 gained 11 tasks and was kept. Rounds 2 and 3 gained 1 and 0 and were reverted. In round 4 Spark found that Glimmer's helpers misread money written as $74.95 or 74.95 USD, expected 2 to 4 more tasks, and gained 2, so the change was kept. The run took 28 minutes and 4 of 7 rounds, and cost Spark 34 cents of 4 dollars 92."
      heightWide={610}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar
          title="Returns desk"
          current={2}
          actions={
            <Swap
              at={DONE}
              className="justify-items-end"
              before={
                <span className="flex gap-2">
                  <Button variant="secondary" size="sm" tabIndex={-1}>
                    <Pause size={13} fill="currentColor" strokeWidth={0} aria-hidden />
                    Pause
                  </Button>
                  <Button variant="secondary" size="sm" tabIndex={-1}>
                    <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden />
                    Stop
                  </Button>
                </span>
              }
              after={
                <Button variant="primary" size="sm" tabIndex={-1}>
                  See the results
                  <ArrowRight size={15} strokeWidth={2} aria-hidden />
                </Button>
              }
            />
          }
        />
        <div className="min-h-0 flex-1 overflow-hidden p-6 narrow:p-4">
          <div className="grid grid-cols-[minmax(0,11fr)_minmax(0,9fr)] gap-5 narrow:grid-cols-1">
            <section
              aria-label="Score on the check tasks"
              className="flex min-w-0 flex-col gap-3 rounded-card bg-card px-7 pb-6 pt-7 shadow-edge narrow:px-5 narrow:pb-5 narrow:pt-5"
            >
              <Score />
              <ScoreChart times={TIMES} />
              <div className="mt-8 grid grid-cols-[auto_auto_auto] justify-between gap-4 border-t border-line pt-5">
                <Limit label="Time" used="28 min" max="12 h" />
                <Limit label="Spark" used="$0.34" max="$4.92" />
                <Limit label="Rounds" used="4" max="7" />
              </div>
            </section>
            <section
              aria-label="Rounds"
              className="flex min-w-0 flex-col overflow-hidden rounded-card bg-card shadow-edge"
            >
              <div className="flex min-h-14 items-center justify-between gap-3 px-6 narrow:px-4">
                <h4 className="m-0 font-display text-h2 font-semibold">Rounds</h4>
                <span className="text-small">Check tasks</span>
              </div>
              <ol className="m-0 flex list-none flex-col p-0">
                <Round
                  n={1}
                  title="Normalize dirty values in helpers"
                  gained="+11"
                  kept
                  start={R1}
                  done={R1_DONE}
                />
                <Round
                  n={2}
                  title="Strip currency symbols in money parsing helpers"
                  gained="+1"
                  kept={false}
                  start={R2}
                  done={R2_DONE}
                />
                <Round
                  n={3}
                  title="Strip currency symbols in money parsing"
                  gained="0"
                  kept={false}
                  start={R3}
                  done={R3_DONE}
                />
                <Round
                  n={4}
                  title="Parse dirty money with numeric extraction in helpers"
                  gained="+2"
                  kept
                  start={R4}
                  done={R4_DONE}
                >
                  <div className="mt-3 flex flex-col gap-2 pl-10 narrow:pl-0">
                    <span className="a a-up font-medium" style={at(DIAGNOSIS - 150, { dy: 8 })}>
                      <Model name="Spark" />
                    </span>
                    <p className="a a-wipe m-0 text-pretty" style={at(DIAGNOSIS, { dur: 1300 })}>
                      Glimmer&apos;s helpers misread money written as &quot;$74.95&quot; or
                      &quot;74.95 USD&quot;.
                    </p>
                    <p
                      className={cn('a a-up m-0 flex justify-between gap-4 tabular-nums')}
                      style={at(EXPECTED, { dy: 8 })}
                    >
                      <span>Spark expected</span>
                      <span>+2 to +4</span>
                    </p>
                  </div>
                </Round>
              </ol>
            </section>
          </div>
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
