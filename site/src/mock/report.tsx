import { Badge, EvidenceMark, EvidenceMeter, Heading, Stat } from '@architect/ui';
import { Check } from 'lucide-react';
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

const ROW_START = 2500;
const ROW_STEP = 520;

function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <span className="flex flex-col gap-1.5 text-sm text-fg-muted">
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

/**
 * The finished agent's results: the returns desk of comparison 2, a made-up business, on the
 * final test it took once with Spark disconnected. The figures are the run's own: 58 of 60 on an
 * online copy of Glimmer, against 44 of 60 for Glimmer untouched.
 */
export function ReportMock() {
  return (
    <ChapterStage
      id="test"
      label="The Architect results for the Returns desk agent, marked Ready. It was tested on 60 tasks it had never seen, on an online copy of Glimmer, with Spark disconnected: 58 of 60 right, up from 44 of 60 before training, with a typical answer in 3.5 seconds. By type of task: refunds 19 of 20, order questions 19 of 20, pickups 20 of 20."
      heightWide={760}
      heightCompact={850}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar title="Returns desk" current={3} />
        <div className="min-h-0 flex-1 overflow-hidden bg-ground-flow bg-dot-grid">
          <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-8 pt-7 narrow:gap-5 narrow:px-4 narrow:pt-5">
            <div className="flex flex-col gap-2.5">
              <div className="a a-pop self-start" style={at(250, { dur: 420 })}>
                <Badge
                  tone="student"
                  icon={<Check size={14} strokeWidth={2} aria-hidden />}
                  className="self-start"
                >
                  Ready
                </Badge>
              </div>
              <Heading
                as="h3"
                size="display"
                className="a a-wipe narrow:text-display-sm"
                style={at(450, { dur: 800 })}
              >
                Returns desk graduated
              </Heading>
              <p
                className="a a-up m-0 max-w-[660px] text-lg text-fg-secondary text-pretty narrow:text-md"
                style={at(1000, { dy: 12 })}
              >
                Tested on 60 tasks it had never seen, on an online copy of Glimmer, with Spark
                disconnected.
              </p>
            </div>

            <div
              className="a a-up grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line-card bg-line-card narrow:grid-cols-1"
              style={at(1400, { dy: 18, dur: 700 })}
            >
              <Stat
                className="bg-panel p-5 narrow:p-4"
                size="md"
                value="97%"
                label="of new tasks right"
                note={<Lines lines={['58 of 60', 'Up from 44 of 60 before training']} />}
                noteFont="text"
              />
              <Stat
                className="bg-panel p-5 narrow:hidden"
                size="md"
                value="3.5 s"
                label="Typical answer"
                note={<Lines lines={['95% within 4.8 s']} />}
                noteFont="text"
              />
            </div>

            <section aria-label="Results by task type" className="flex flex-col gap-4">
              <div className="a a-up" style={at(1900, { dy: 12 })}>
                <Heading as="h3">By task type</Heading>
              </div>
              <div className="flex flex-col">
                <div
                  className="a a-up grid grid-cols-[28%_1fr] gap-x-6 pb-3 narrow:grid-cols-1"
                  style={at(2100, { dy: 10 })}
                >
                  <span className="narrow:hidden" />
                  <span className="flex flex-col gap-0.5">
                    <EvidenceMark kind="final">Final test</EvidenceMark>
                    <span className="text-sm text-fg-muted">Opened once, at the end</span>
                  </span>
                </div>
                {TASK_TYPES.map((type, index) => {
                  const start = ROW_START + index * ROW_STEP;
                  return (
                    <div
                      key={type.label}
                      className="grid grid-cols-[28%_1fr] items-start gap-x-6 gap-y-2 border-t border-line-card py-3 narrow:grid-cols-1"
                    >
                      <span className="a a-up" style={at(start - 150, { dy: 10 })}>
                        {type.label}
                      </span>
                      <span className="flex flex-col gap-2">
                        <span
                          className="a a-up font-mono text-sm tabular-nums text-fg-secondary"
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
