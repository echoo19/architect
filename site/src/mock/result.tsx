import type { ReactNode } from 'react';
import { Button, EvidenceMark } from '@architect/ui';
import { Cloud, Laptop } from 'lucide-react';
import { FlowBar } from './flow-bar';
import { AppWindow } from './frame';
import { Roll } from './kit';
import { at } from './motion';
import { ChapterStage } from './stage';

/**
 * The Results screen of the returns desk's run: the final test of comparison 2, 60 requests the
 * agent had never seen, taken on an online copy of Glimmer because the build that runs on this
 * computer has not taken it. The figures are the run's own: 44 of 60 before teaching and 58 of 60
 * after, a typical answer of 17.7 s before and 3.5 s after, and 42 cents of Spark.
 */

interface TaskType {
  name: string;
  before: number;
  after: number;
}

/** What each kind of request scored out of 20, before teaching and after. */
const TYPES: readonly TaskType[] = [
  { name: 'Refunds', before: 15, after: 19 },
  { name: 'Order questions', before: 12, after: 19 },
  { name: 'Pickups', before: 17, after: 20 },
];
const OUT_OF = 20;

/** When things happen, in ms from the start. */
const HEAD = 300;
const STATS = 800;
const ROLL = 2200;
const TABLE = 2700;
const ROW_GAP = 320;
const NEXT = 4300;

function Figure({ children }: { children: string }) {
  return (
    <span className="font-display text-title font-semibold leading-none tabular-nums narrow:text-h1">
      {children}
    </span>
  );
}

function Stat({ label, start, children }: { label: string; start: number; children: ReactNode }) {
  return (
    <div className="a a-up flex flex-col gap-2.5" style={at(start, { dy: 12, dur: 600 })}>
      {children}
      <span>{label}</span>
    </div>
  );
}

export function ResultMock() {
  return (
    <ChapterStage
      id="test"
      label="The Architect Results screen for the Returns desk, which finished training and passed its final test online. Tested on 60 tasks it had never seen, it got 97 percent right, 58 of 60, up from 44 of 60 before training. A typical answer takes 3.5 seconds, down from 17.7, and Spark's cost was 42 cents. By task type it scored 19 of 20 on refunds, 19 of 20 on order questions and 20 of 20 on pickups. It offers to take the same test on this computer."
      heightWide={680}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar title="Returns desk" current={3} />
        <div className="min-h-0 flex-1 overflow-hidden px-6 pt-9 narrow:px-4 narrow:pt-6">
          <div className="mx-auto flex max-w-[760px] flex-col">
            <div className="a a-up flex flex-col gap-3" style={at(HEAD, { dy: 12, dur: 600 })}>
              <span className="flex items-center gap-2 text-small">
                <Cloud size={14} strokeWidth={1.7} aria-hidden />
                Passed online
              </span>
              <h3 className="m-0 font-display text-title font-semibold narrow:text-h1">
                Returns desk finished training
              </h3>
              <p className="m-0 text-body text-pretty">
                Tested on 60 tasks it had never seen, on an online copy of Glimmer, with Spark
                disconnected.
              </p>
            </div>

            <div className="mt-9 grid grid-cols-3 gap-6 narrow:mt-6 narrow:gap-3">
              <Stat label="of new tasks right" start={STATS}>
                <Roll
                  steps={[
                    { at: 0, content: <Figure>73%</Figure> },
                    { at: ROLL, content: <Figure>97%</Figure> },
                  ]}
                />
              </Stat>
              <Stat label="typical answer" start={STATS + 150}>
                <Roll
                  steps={[
                    { at: 0, content: <Figure>17.7 s</Figure> },
                    { at: ROLL + 150, content: <Figure>3.5 s</Figure> },
                  ]}
                />
              </Stat>
              <Stat label="Spark's cost" start={STATS + 300}>
                <Figure>$0.42</Figure>
              </Stat>
            </div>

            <section aria-label="By task type" className="mt-10 narrow:mt-7">
              <div
                className="a a-up flex items-center gap-2 pb-3"
                style={at(TABLE - 200, { dy: 8 })}
              >
                <EvidenceMark kind="final">Final test</EvidenceMark>
              </div>
              <ul className="m-0 flex list-none flex-col p-0">
                {TYPES.map((type, index) => (
                  <li
                    key={type.name}
                    className="a a-up grid min-h-14 grid-cols-[150px_minmax(0,1fr)_96px] items-center gap-x-6 border-t border-line narrow:grid-cols-[minmax(0,1fr)_auto] narrow:gap-y-2.5 narrow:py-3"
                    style={at(TABLE + index * ROW_GAP, { dy: 10, dur: 560 })}
                  >
                    <span className="font-medium">{type.name}</span>
                    <span className="col-start-3 row-start-1 text-right tabular-nums narrow:col-start-2">
                      {type.before} to {type.after} of {OUT_OF}
                    </span>
                    <span
                      aria-hidden
                      className="relative col-start-2 row-start-1 h-1 rounded-full bg-line-strong narrow:col-span-2 narrow:col-start-1 narrow:row-start-2"
                    >
                      <span
                        className="a a-bar absolute inset-y-0 left-0 rounded-full bg-student"
                        style={{
                          width: `${(type.after / OUT_OF) * 100}%`,
                          ...at(TABLE + index * ROW_GAP + 200, { dur: 1000 }),
                        }}
                      />
                      <span
                        className="absolute -top-1 h-3 w-0.5 rounded-mark bg-fg"
                        style={{ left: `${(type.before / OUT_OF) * 100}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <div
              className="a a-up mt-3 flex items-center justify-between gap-4 border-t border-line pt-5 narrow:flex-col narrow:items-start"
              style={at(NEXT, { dy: 10 })}
            >
              <span className="flex items-center gap-2.5">
                <Laptop size={18} strokeWidth={1.6} aria-hidden />
                Test it on this computer
              </span>
              <Button variant="secondary" size="md" tabIndex={-1}>
                Test on this computer
              </Button>
            </div>
          </div>
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
