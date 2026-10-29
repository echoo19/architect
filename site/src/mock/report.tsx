import type { CSSProperties } from 'react';
import { Badge, cn, EvidenceMark, EvidenceMeter, Heading, Stat } from '@architect/ui';
import { Check } from 'lucide-react';
import { FlowBar } from './flow-bar';
import { AppWindow } from './frame';
import { at } from './motion';
import { ChapterStage } from './stage';

interface Capability {
  label: string;
  pass: number;
  total: number;
  /** Spark's own count on the same tasks, where it was measured. */
  spark?: number;
}

/** The final test, by kind of request. */
const CAPABILITIES: readonly Capability[] = [
  { label: 'Invoices', pass: 19, total: 20, spark: 20 },
  { label: 'Overdue balances', pass: 20, total: 20, spark: 20 },
  { label: 'Scheduling', pass: 16, total: 20, spark: 18 },
];

const ROW_START = 2500;
const ROW_STEP = 520;

/** The key to the amber mark on a bar: where Spark did the same tasks itself. */
function SparkKey({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={cn('flex items-center gap-2 text-sm text-mentor', className)} style={style}>
      <span aria-hidden className="h-4 w-[3px] rounded-full bg-mentor" />
      Spark doing the tasks itself
    </span>
  );
}

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
 * The finished agent's report: the final test was taken once, offline, with Spark disconnected,
 * and its result is shown by kind of request, with a mark where Spark did the same tasks itself.
 */
export function ReportMock() {
  return (
    <ChapterStage
      id="test"
      label="The Architect report for the Service desk agent, marked Ready. The agent took a final test of unseen tasks, offline, with Spark disconnected. Its results are shown by kind of request as bars, with an amber mark where Spark did the same tasks itself."
      heightWide={700}
      heightCompact={680}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar title="Service desk" current={3} />
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
                Service desk graduated
              </Heading>
              <p
                className="a a-up m-0 max-w-[660px] text-lg text-fg-secondary text-pretty narrow:hidden"
                style={at(1000, { dy: 12 })}
              >
                Final test of 60 unseen tasks, offline on this computer, with Spark disconnected.
              </p>
            </div>

            <div
              className="a a-up grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line-card bg-line-card narrow:hidden"
              style={at(1400, { dy: 18, dur: 700 })}
            >
              <Stat
                className="bg-panel p-5 narrow:p-4"
                size="md"
                value="92%"
                label="of new tasks right"
                note={<Lines lines={['55 of 60']} />}
                noteFont="text"
              />
              <Stat
                className="bg-panel p-5 narrow:hidden"
                size="md"
                value="32 s"
                label="Typical answer"
                note={<Lines lines={['95% within 57 s']} />}
                noteFont="text"
              />
              <Stat
                className="bg-panel p-5 narrow:hidden"
                size="md"
                value="Glimmer"
                label="Model"
                note={<Lines lines={['4-bit']} />}
                noteFont="text"
              />
            </div>

            <section aria-label="Capabilities" className="flex flex-col gap-4">
              <div
                className="a a-up flex flex-wrap items-baseline justify-between gap-3"
                style={at(1900, { dy: 12 })}
              >
                <Heading as="h3">Capabilities</Heading>
                <SparkKey className="narrow:hidden" />
              </div>
              <div className="flex flex-col">
                <div
                  className="a a-up grid grid-cols-[28%_1fr] gap-x-6 pb-3 narrow:grid-cols-1"
                  style={at(2100, { dy: 10 })}
                >
                  <span className="narrow:hidden" />
                  <span className="flex flex-col gap-0.5">
                    <EvidenceMark kind="final">Final test</EvidenceMark>
                    <span className="text-sm text-fg-muted">Unseen until the end</span>
                  </span>
                </div>
                {CAPABILITIES.map((capability, index) => {
                  const start = ROW_START + index * ROW_STEP;
                  return (
                    <div
                      key={capability.label}
                      className="grid grid-cols-[28%_1fr] items-start gap-x-6 gap-y-2 border-t border-line-card py-3 narrow:grid-cols-1"
                    >
                      <span className="a a-up" style={at(start - 150, { dy: 10 })}>
                        {capability.label}
                      </span>
                      <span className="flex flex-col gap-2">
                        <span
                          className="a a-up font-mono text-sm tabular-nums text-fg-secondary"
                          style={at(start, { dy: 8 })}
                        >
                          <span className="text-fg">{capability.pass}</span> of {capability.total}
                        </span>
                        <span className="a a-wipe block" style={at(start + 80, { dur: 1000 })}>
                          <EvidenceMeter
                            kind="final"
                            value={capability.pass / capability.total}
                            label={`${capability.label}, final test`}
                            valueText={`${capability.pass} of ${capability.total} passed; Spark ${capability.spark} of ${capability.total} passed`}
                            {...(capability.spark === undefined
                              ? {}
                              : { marker: capability.spark / capability.total })}
                          />
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <SparkKey
                className="a a-up hidden narrow:flex"
                style={at(ROW_START + CAPABILITIES.length * ROW_STEP, { dy: 8 })}
              />
            </section>
          </div>
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
