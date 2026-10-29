import { Button, cn, FileChip, Heading, IconButton, ReplyComposer } from '@architect/ui';
import { ArrowRight, ArrowUp, Check, Cloud, ListChecks, Paperclip } from 'lucide-react';
import { FlowBar } from './flow-bar';
import { AppWindow } from './frame';
import { at } from './motion';
import { noop } from './noop';
import { ChapterStage } from './stage';

const JOB =
  'Close out the day for our home-services office: price the visits the technicians finished, find customers with overdue balances, and book the earliest technician for urgent calls.';

const FILES = [
  'jobs.csv',
  'invoices.csv',
  'technicians.csv',
  'bookings.csv',
  'policy.md',
  'tasks.jsonl',
] as const;

/** How many of the files a phone's narrow bubble names before it counts the rest. */
const SHOWN_ON_NARROW = 2;

/** Example tasks with their answers are marked apart from the data, as the product marks them. */
function Attached({ name }: { name: string }) {
  const tasks = name.endsWith('.jsonl');
  return (
    <FileChip
      name={name}
      icon={tasks ? <ListChecks size={14} strokeWidth={1.6} aria-hidden /> : undefined}
    />
  );
}

/** When the chapter's moments happen, in ms from the start. */
const TYPE_AT = 450;
const READY_AT = 2200;
const SEND_AT = 3000;
const HAND_OVER = 3400;
const ASKED = HAND_OVER + 1100;
const CHOSEN = 6300;

/** The job in the person's words, arriving a word at a time. */
function Typed({ text }: { text: string }) {
  return (
    <>
      {text.split(' ').map((word, index) => (
        <span
          key={index}
          className="a a-up inline-block"
          style={at(TYPE_AT + index * 52, { dy: 5, dur: 260 })}
        >
          {word}
          {' '}
        </span>
      ))}
    </>
  );
}

/** The Describe screen: one question, the message box, and the files the job works from. */
function DescribeScreen() {
  return (
    <div
      className="a a-exit-up motion-only absolute inset-0 flex flex-col items-center justify-center gap-7 px-6 pb-8"
      style={at(HAND_OVER, { dur: 380, dy: 30 })}
    >
      <Heading as="h3" size="display-sm" className="text-center narrow:text-[28px]">
        What should your agent do?
      </Heading>
      <div className="flex w-full max-w-[680px] flex-col gap-3">
        <div className="flex w-full flex-col gap-2 rounded-4xl border border-line-control bg-field pb-3.5 pl-[22px] pr-3.5 pt-[18px] shadow-composer">
          <p className="m-0 min-h-[74px] pr-2 text-lg leading-[1.55] narrow:min-h-[190px]">
            <Typed text={JOB} />
          </p>
          <div className="flex items-center justify-between gap-2">
            <div className="-ml-2.5 flex items-center">
              <IconButton label="Attach files" tabIndex={-1}>
                <Paperclip size={18} strokeWidth={1.6} aria-hidden />
              </IconButton>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="flex items-center gap-1.5 text-sm text-fg-muted">
                <Cloud size={14} strokeWidth={1.6} aria-hidden />
                Teacher: Spark
              </span>
              <span
                className="a a-press relative inline-flex size-10"
                style={at(SEND_AT, { dur: 300 })}
              >
                <IconButton
                  label="Send"
                  variant="muted"
                  shape="round"
                  size="lg"
                  tabIndex={-1}
                  className="a a-exit-up absolute inset-0"
                  style={at(READY_AT - 50, { dur: 150, dy: 0 })}
                >
                  <ArrowUp size={18} strokeWidth={2} aria-hidden />
                </IconButton>
                <IconButton
                  label="Send"
                  variant="primary"
                  shape="round"
                  size="lg"
                  tabIndex={-1}
                  className="a a-pop absolute inset-0"
                  style={at(READY_AT, { dur: 300 })}
                >
                  <ArrowUp size={18} strokeWidth={2} aria-hidden />
                </IconButton>
              </span>
            </div>
          </div>
        </div>
        <ul aria-label="Attached files" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {FILES.map((name, index) => (
            <li
              key={name}
              className="a a-from-left min-w-0"
              style={at(1600 + index * 90, { dx: 10, dur: 420 })}
            >
              <Attached name={name} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const option = 'inline-flex h-10 items-center rounded-lg border px-4';

/**
 * The conversation that follows: the description as sent, with its files, then Spark's reply,
 * which reads the files and asks what it needs, and the job it has drafted to review.
 */
function ClarifyScreen() {
  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="min-h-0 flex-1 overflow-hidden px-6 pt-9 narrow:px-4 narrow:pt-5">
        <ol
          aria-label="Conversation with Spark"
          className="m-0 mx-auto flex max-w-[720px] list-none flex-col gap-7 p-0 narrow:gap-5"
        >
          <li className="flex flex-col">
            <div className="flex max-w-[540px] flex-col items-end gap-2.5 self-end narrow:max-w-full">
              <p
                className="a a-up m-0 rounded-3xl bg-selected px-4 py-3 text-md text-pretty"
                style={at(HAND_OVER + 150, { dy: 90, dur: 800 })}
              >
                {JOB}
              </p>
              <ul
                aria-label="Files sent"
                className="m-0 flex list-none flex-wrap justify-end gap-2 p-0"
              >
                {FILES.map((name, index) => (
                  <li
                    key={name}
                    className={cn(
                      'a a-from-left min-w-0',
                      index >= SHOWN_ON_NARROW && 'narrow:hidden',
                    )}
                    style={at(HAND_OVER + 800 + index * 70, { dx: 10, dur: 400 })}
                  >
                    <Attached name={name} />
                  </li>
                ))}
                <li
                  className="a a-from-left hidden self-center text-sm text-fg-muted narrow:block"
                  style={at(HAND_OVER + 800 + SHOWN_ON_NARROW * 70, { dx: 10, dur: 400 })}
                >
                  and {FILES.length - SHOWN_ON_NARROW} more
                </li>
              </ul>
            </div>
          </li>
          <li className="flex flex-col">
            <div className="flex flex-col gap-4 text-md">
              <span
                className="a a-up text-sm font-medium text-mentor"
                style={at(ASKED, { dy: 10 })}
              >
                Spark
              </span>
              <div
                className="a a-up flex h-[22px] items-center gap-2 text-sm text-fg-muted"
                style={at(ASKED + 200, { dy: 10 })}
              >
                <Check size={14} strokeWidth={1.8} aria-hidden />
                <span>Read 6 files</span>
              </div>
              <p className="a a-wipe m-0 text-pretty" style={at(ASKED + 450, { dur: 1000 })}>
                Got it. When it prices a finished visit, should it show the line items or just the
                total?
              </p>
              <div role="group" aria-label="Answers" className="flex flex-wrap gap-2">
                <span className="a a-up grid" style={at(ASKED + 1500, { dy: 8 })}>
                  <span
                    className={cn(
                      option,
                      'a a-exit-up motion-only border-line-control bg-card text-fg-secondary [grid-area:1/1]',
                    )}
                    style={at(CHOSEN - 60, { dur: 140, dy: 0 })}
                  >
                    Show the line items
                  </span>
                  <span
                    className={cn(option, 'a a-pop border-fg bg-selected text-fg [grid-area:1/1]')}
                    style={at(CHOSEN, { dur: 260 })}
                  >
                    Show the line items
                  </span>
                </span>
                <span
                  className={cn(option, 'a a-up border-line-control bg-card text-fg-muted')}
                  style={at(ASKED + 1500, { dy: 8 })}
                >
                  Just the total
                </span>
              </div>
            </div>
          </li>
          <li className="flex flex-col">
            <div className="flex flex-col gap-4 text-md">
              <p className="a a-up m-0" style={at(CHOSEN + 400, { dy: 10 })}>
                That&apos;s everything I need. I&apos;ve drafted the job for you to review.
              </p>
              <Button
                variant="primary"
                className="a a-pop self-start"
                tabIndex={-1}
                style={at(CHOSEN + 750, { dur: 360 })}
              >
                Review the job
                <ArrowRight size={16} strokeWidth={2} aria-hidden />
              </Button>
            </div>
          </li>
        </ol>
      </div>
      <div className="a a-up px-6 pb-6 narrow:hidden" style={at(HAND_OVER + 600, { dy: 16 })}>
        <ReplyComposer
          className="mx-auto"
          label="Reply"
          placeholder="Reply"
          value=""
          onValueChange={noop}
          onSubmit={noop}
        />
      </div>
    </div>
  );
}

/**
 * The first chapter: the job said in plain words with its files, then the conversation it starts.
 * Spark reads the files, asks what it needs to know, and drafts the job for the person to review.
 */
export function DescribeMock() {
  return (
    <ChapterStage
      id="describe"
      label="The Architect Describe screen. The person has written what the job is and attached six files. Spark has read the files and asked whether the agent should show line items or just the total. The person chose line items, and Spark says it has drafted the job and offers a Review the job button."
      heightWide={700}
      heightCompact={730}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar title="New agent" current={0} />
        <div className="relative min-h-0 flex-1 overflow-hidden bg-ground-flow bg-dot-grid">
          <DescribeScreen />
          <ClarifyScreen />
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
