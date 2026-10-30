import { FileChip, IconButton } from '@architect/ui';
import { ArrowUp, ChevronDown, Cloud, Paperclip } from 'lucide-react';
import { FlowBar } from './flow-bar';
import { AppWindow } from './frame';
import { Model, Swap, Typed } from './kit';
import { at } from './motion';
import { noop } from './noop';
import { ChapterStage } from './stage';

/**
 * The Describe screen: one question, a box for the answer and the files the job works from. The
 * words and files are the repair shop's, a bike shop's counter: three files and a sentence.
 */

const JOB =
  'Answer questions about the tickets of our bike repair shop: what a ticket costs under our policy, and who a customer is.';

const FILES = ['customers.csv', 'tickets.csv', 'policy.md'] as const;

/** When things happen, in ms from the start. */
const ATTACH = 450;
const ATTACH_STEP = 150;
const TYPE = 1250;
const TYPE_STEP = 58;
const READY = TYPE + JOB.split(' ').length * TYPE_STEP + 250;
const SEND = READY + 900;

const sendButton = (variant: 'muted' | 'primary') => (
  <IconButton label="Send" variant={variant} shape="round" size="lg" tabIndex={-1}>
    <ArrowUp size={18} strokeWidth={2} aria-hidden />
  </IconButton>
);

export function DescribeMock() {
  return (
    <ChapterStage
      id="describe"
      label="The Architect Describe screen. Under the question what should your agent do, the person has written that they want questions answered about the tickets of their bike repair shop, what a ticket costs under their policy and who a customer is. They have attached three files, customers.csv, tickets.csv and policy.md, and the teacher is Spark."
      heightWide={500}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar title="New agent" current={0} />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-8 px-6 pb-14 narrow:gap-6 narrow:px-4 narrow:pb-8">
          <h3 className="m-0 text-balance text-center font-display text-h1 font-semibold narrow:text-h2">
            What should your agent do?
          </h3>
          <div className="flex w-full max-w-[680px] flex-col gap-3.5">
            <div className="flex w-full flex-col gap-2 rounded-card bg-raised pb-3.5 pl-[22px] pr-3.5 pt-[18px] shadow-edge-strong">
              <p className="m-0 min-h-[74px] pr-2 text-body narrow:min-h-[124px]">
                <Typed text={JOB} start={TYPE} step={TYPE_STEP} />
              </p>
              <div className="flex items-center justify-between gap-2">
                <div className="-ml-2.5">
                  <IconButton label="Attach files" tabIndex={-1}>
                    <Paperclip size={18} strokeWidth={1.6} aria-hidden />
                  </IconButton>
                </div>
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-small">
                    <Cloud size={14} strokeWidth={1.6} aria-hidden />
                    <Model name="Spark" />
                    <ChevronDown size={13} strokeWidth={1.8} aria-hidden />
                  </span>
                  <span className="a a-press inline-flex" style={at(SEND, { dur: 320 })}>
                    <Swap at={READY} before={sendButton('muted')} after={sendButton('primary')} />
                  </span>
                </div>
              </div>
            </div>
            <ul aria-label="Attached files" className="m-0 flex list-none flex-wrap gap-2 p-0">
              {FILES.map((name, index) => (
                <li
                  key={name}
                  className="a a-up min-w-0"
                  style={at(ATTACH + index * ATTACH_STEP, { dy: 10, dur: 520 })}
                >
                  <FileChip name={name} onRemove={noop} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
