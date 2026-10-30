import type { ReactNode } from 'react';
import { Button, cn, ReplyComposer } from '@architect/ui';
import { ArrowRight, Check } from 'lucide-react';
import { FlowBar } from './flow-bar';
import { AppWindow } from './frame';
import { Insert, Model, Swap } from './kit';
import { at } from './motion';
import { noop } from './noop';
import { UserBubble } from './chat';
import { ChapterStage } from './stage';

/**
 * Spark's questions about the repair shop's three files, as the Describe screen's conversation
 * asks them. The first is Spark's own, about the discount; the second is Architect's, about the
 * tickets whose parts cost says N/A, which the teacher is never shown. The words are the app's.
 */

const JOB =
  'Answer questions about the tickets of our bike repair shop: what a ticket costs under our policy, and who a customer is.';
const DISCOUNT = 'Does the 10% off for members also apply to the parts?';
const NA =
  'In tickets.csv, parts_cost sometimes says "N/A". If "N/A" means no parts cost, count it as zero. If it can also mean "not known yet", leave those rows out.';

/** When things happen, in ms from the start. */
const BUBBLE = 300;
const READ = 1000;
const Q1 = 1750;
const Q1_OPTIONS = 2900;
const Q1_PICK = 4300;
const Q2 = 4900;
const Q2_OPTIONS = 6700;
const Q2_PICK = 8000;
const DONE = 8700;
const REVIEW = 9300;

const option = 'inline-flex h-10 items-center rounded-control px-4';

function Choice({
  children,
  start,
  chosenAt,
}: {
  children: string;
  start: number;
  chosenAt?: number;
}) {
  const plain = cn(option, 'bg-card shadow-edge-strong');
  const picked = cn(option, 'bg-selected font-medium inset-ring-1 inset-ring-fg');
  return (
    <span className="a a-up inline-flex" style={at(start, { dy: 8 })}>
      {chosenAt === undefined ? (
        <span className={plain}>{children}</span>
      ) : (
        <Swap
          at={chosenAt}
          before={<span className={plain}>{children}</span>}
          after={<span className={picked}>{children}</span>}
        />
      )}
    </span>
  );
}

function Question({
  from,
  start,
  textDur,
  children,
  choices,
}: {
  from: ReactNode;
  start: number;
  textDur: number;
  children: ReactNode;
  choices: ReactNode;
}) {
  return (
    <Insert start={start - 200} dur={520}>
      <div className="flex flex-col gap-3 pt-6">
        <span className="a a-up font-medium" style={at(start, { dy: 8 })}>
          {from}
        </span>
        <p className="a a-wipe m-0 text-body text-pretty" style={at(start + 250, { dur: textDur })}>
          {children}
        </p>
        <div role="group" aria-label="Answers" className="flex flex-wrap gap-2">
          {choices}
        </div>
      </div>
    </Insert>
  );
}

export function AskMock() {
  return (
    <ChapterStage
      id="ask"
      label="The Architect Describe screen's conversation. Spark has read the repair shop's three files and asks whether the 10% off for members also applies to the parts. The person answers no, labor only. Architect then asks what N/A in the parts cost column should count as, to count it as zero or leave those rows out, and the person chooses to count it as zero. Spark says that is everything it needs and offers a Review the job button."
      heightWide={780}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar title="New agent" current={0} />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden px-6 pt-8 narrow:px-4 narrow:pt-5">
            <div className="mx-auto flex max-w-[680px] flex-col">
              <UserBubble className="a a-up" style={at(BUBBLE, { dy: 40, dur: 800 })}>
                {JOB}
              </UserBubble>
              <div className="flex flex-col gap-3 pt-6">
                <span className="a a-up font-medium" style={at(READ - 150, { dy: 8 })}>
                  <Model name="Spark" />
                </span>
                <span
                  className="a a-up flex items-center gap-2 text-ui"
                  style={at(READ, { dy: 8 })}
                >
                  <Check size={14} strokeWidth={1.8} aria-hidden />
                  Read customers.csv, tickets.csv and policy.md
                </span>
              </div>
              <Question
                from={<span className="sr-only">Spark</span>}
                start={Q1}
                textDur={900}
                choices={
                  <>
                    <Choice start={Q1_OPTIONS} chosenAt={Q1_PICK}>
                      No, labor only
                    </Choice>
                    <Choice start={Q1_OPTIONS + 100}>Yes, parts too</Choice>
                  </>
                }
              >
                {DISCOUNT}
              </Question>
              <Question
                from="Architect"
                start={Q2}
                textDur={1700}
                choices={
                  <>
                    <Choice start={Q2_OPTIONS} chosenAt={Q2_PICK}>
                      Count it as zero
                    </Choice>
                    <Choice start={Q2_OPTIONS + 100}>Leave those rows out</Choice>
                  </>
                }
              >
                {NA}
              </Question>
              <Insert start={DONE - 200} dur={520}>
                <div className="flex flex-col gap-4 pt-6">
                  <p className="a a-up m-0" style={at(DONE, { dy: 10 })}>
                    That&apos;s everything I need. I&apos;ve drafted the job for you to review.
                  </p>
                  <Button
                    variant="primary"
                    className="a a-pop self-start"
                    tabIndex={-1}
                    style={at(REVIEW, { dur: 360 })}
                  >
                    Review the job
                    <ArrowRight size={16} strokeWidth={2} aria-hidden />
                  </Button>
                </div>
              </Insert>
            </div>
          </div>
          <div className="px-6 pb-6 narrow:hidden">
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
      </AppWindow>
    </ChapterStage>
  );
}
