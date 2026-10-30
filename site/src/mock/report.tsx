import { Badge, Button, EvidenceMark, EvidenceMeter, Heading, Stat } from '@architect/ui';
import { Cloud, Laptop } from 'lucide-react';
import { FlowBar } from './flow-bar';
import { AppWindow } from './frame';
import { at } from './motion';
import { ChapterStage } from './stage';

interface TaskType {
  label: string;
  pass: number;
  total: number;
}

/** The final test of comparison 2, by type of task: 58 of 60 in all. */
const TASK_TYPES: readonly TaskType[] = [
  { label: 'Refunds', pass: 19, total: 20 },
  { label: 'Order questions', pass: 19, total: 20 },
  { label: 'Pickups', pass: 20, total: 20 },
];

/** When the screen's parts arrive, in ms from the start. */
const SAYS_AT = 1000;
const OFFER_AT = 1750;
const FIGURES_AT = 2300;
const TYPES_AT = 2800;
const ROW_START = 3400;
const ROW_STEP = 520;

function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <span className="flex flex-col gap-1.5 text-small text-fg">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

/**
 * The finished agent's results: the returns desk of comparison 2, a made-up business, on the
 * final test it took once with Spark disconnected. The figures are the run's own: 58 of 60 on an
 * online copy of Glimmer, against 44 of 60 for Glimmer untouched. The test ran online, so the app
 * says it passed online and offers the test on this computer, as it does for any such run.
 */
export function ReportMock() {
  return (
    <ChapterStage
      id="test"
      label="The Architect results for the Returns desk agent, marked Passed online. It was tested on 60 tasks it had never seen, on an online copy of Glimmer, with Spark disconnected, and got 58 of 60, up from 44 of 60 before training, with a typical answer in 3.5 seconds. It is marked ready once it passes on this computer too, and the screen offers that test, which takes about 2.5 hours. By type of task: refunds 19 of 20, order questions 19 of 20, pickups 20 of 20."
      heightWide={940}
      heightCompact={1190}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar title="Returns desk" current={3} />
        <div className="min-h-0 flex-1 overflow-hidden bg-ground">
          <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-8 pt-7 narrow:gap-5 narrow:px-4 narrow:pt-5">
            <div className="flex flex-col gap-2.5">
              <div className="a a-pop self-start" style={at(250, { dur: 420 })}>
                <Badge
                  tone="neutral"
                  icon={<Cloud size={14} strokeWidth={1.8} aria-hidden />}
                  className="self-start"
                >
                  Passed online
                </Badge>
              </div>
              <Heading
                as="h3"
                size="display"
                className="a a-wipe narrow:text-h1"
                style={at(450, { dur: 800 })}
              >
                Returns desk finished training
              </Heading>
              <p
                className="a a-up m-0 max-w-[660px] text-body text-fg text-pretty narrow:text-body"
                style={at(SAYS_AT, { dy: 12 })}
              >
                Tested on 60 tasks it had never seen, on an online copy of Glimmer, with Spark
                disconnected.
              </p>
              <p
                className="a a-up m-0 max-w-[620px] text-fg text-pretty"
                style={at(SAYS_AT + 300, { dy: 12 })}
              >
                It got 58 of 60 there, and is marked ready once it passes on this computer too.
              </p>
            </div>

            <section
              aria-label="Test on this computer"
              className="a a-up flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-card bg-card px-[22px] py-5 shadow-edge"
              style={at(OFFER_AT, { dy: 14, dur: 600 })}
            >
              <div className="flex min-w-0 flex-[1_1_360px] items-start gap-3.5">
                <span className="mt-0.5 flex shrink-0">
                  <Laptop size={18} strokeWidth={1.6} className="text-fg" aria-hidden />
                </span>
                <div className="flex min-w-0 flex-col gap-1">
                  <Heading as="h3">Test it on this computer</Heading>
                  <p className="m-0 text-fg text-pretty">
                    Run its final test here to see how the agent does on its own. It takes about 2.5
                    hours for 60 tasks and uses the graphics card.
                  </p>
                </div>
              </div>
              <Button size="md" tabIndex={-1}>
                Test on this computer
              </Button>
            </section>

            <div
              className="a a-up grid grid-cols-2 gap-px overflow-hidden rounded-card bg-line-strong narrow:grid-cols-1 shadow-edge"
              style={at(FIGURES_AT, { dy: 18, dur: 700 })}
            >
              <Stat
                className="bg-card p-5 narrow:p-4"
                size="md"
                value="97%"
                label="of new tasks right"
                note={<Lines lines={['58 of 60', 'Up from 44 of 60 before training']} />}
                noteFont="text"
              />
              <Stat
                className="bg-card p-5 narrow:hidden"
                size="md"
                value="3.5 s"
                label="Typical answer time"
                note={<Lines lines={['95% within 4.8 s']} />}
                noteFont="text"
              />
            </div>

            <section aria-label="Results by task type" className="flex flex-col gap-4">
              <div className="a a-up" style={at(TYPES_AT, { dy: 12 })}>
                <Heading as="h3">By task type</Heading>
              </div>
              <div className="flex flex-col">
                <div
                  className="a a-up grid grid-cols-[28%_1fr] gap-x-6 pb-3 narrow:grid-cols-1"
                  style={at(TYPES_AT + 200, { dy: 10 })}
                >
                  <span className="narrow:hidden" />
                  <span className="flex flex-col gap-0.5">
                    <EvidenceMark kind="final">Final test</EvidenceMark>
                    <span className="text-small text-fg">Opened once, at the end</span>
                  </span>
                </div>
                {TASK_TYPES.map((type, index) => {
                  const start = ROW_START + index * ROW_STEP;
                  return (
                    <div
                      key={type.label}
                      className="grid grid-cols-[28%_1fr] items-start gap-x-6 gap-y-2 border-t border-line py-3 narrow:grid-cols-1"
                    >
                      <span className="a a-up" style={at(start - 150, { dy: 10 })}>
                        {type.label}
                      </span>
                      <span className="flex flex-col gap-2">
                        <span
                          className="a a-up font-mono text-small tabular-nums text-fg"
                          style={at(start, { dy: 8 })}
                        >
                          <span className="text-fg">{type.pass}</span> of {type.total}
                        </span>
                        <span className="a a-wipe block" style={at(start + 80, { dur: 1000 })}>
                          <EvidenceMeter
                            kind="final"
                            value={type.pass / type.total}
                            label={`${type.label}, final test`}
                            valueText={`${type.pass} of ${type.total} passed`}
                          />
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
