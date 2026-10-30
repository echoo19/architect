import type { ReactNode } from 'react';
import { Button, IconButton, ToggleChip } from '@architect/ui';
import { Copy, File, Flag, Layers, ListChecks, Send, Trash2, X } from 'lucide-react';
import { KeepIds, P, Reply, UserBubble } from './chat';
import { AppWindow, ChatHeader, Sidebar } from './frame';
import { CHATS, deskSidebar } from './jobs';
import { Swap, Typed } from './kit';
import { at } from './motion';
import { noop } from './noop';
import { ChapterStage } from './stage';

/**
 * Teaching it, as the app does it in two steps: the person flags an answer and says what was wrong
 * (Teach this), then Spark's lesson is shown to review before it is saved as a new version
 * (Flagged answer). The return is RT-4092, whose earliest day is Thursday, November 26, 2026:
 * Thanksgiving, when the shop's policy says no carrier collects. The version before it passed 58
 * of 60 on its final test.
 */

const TITLE = 'Book the earliest pickup for return RT-4092';
const ASK = 'Book the earliest pickup for return RT-4092.';
const REPLY = 'Cedarline Parcel can collect it on Thursday, November 26.';
const WRONG = 'November 26 is Thanksgiving, and no carrier picks up that day.';
const SHOULD = 'Book Friday, the next day Cedarline collects.';
const LESSON =
  'Before booking a pickup, check policy.md for days when no carrier collects, like Thanksgiving.';
const FILES = ['orders.csv', 'customers.csv', 'returns.csv', 'pickups.csv', 'policy.md'] as const;

/** When things happen, in ms from the start. */
const ASKED = 300;
const ANSWER = 900;
const ACTIONS = 1700;
const FLAG = 2400;
const DRAWER = 2650;
const WRITE = 3300;
const TYPE_STEP = 52;
const SHOULD_AT = WRITE + WRONG.split(' ').length * TYPE_STEP + 350;
const FILES_AT = SHOULD_AT + SHOULD.split(' ').length * TYPE_STEP + 300;
const PICK = FILES_AT + 900;
const SHARE = PICK + 1000;
const REVIEW = SHARE + 450;

const field =
  'min-h-[64px] rounded-control bg-field px-3.5 py-3 text-body leading-normal shadow-edge-strong';

function Field({
  label,
  optional,
  start,
  children,
}: {
  label: string;
  optional?: boolean;
  start: number;
  children: ReactNode;
}) {
  return (
    <div className="a a-up flex flex-col gap-2" style={at(start, { dy: 8 })}>
      <span className="flex items-baseline gap-2 font-medium">
        {label}
        {optional && <span className="text-small font-normal">Optional</span>}
      </span>
      {children}
    </div>
  );
}

/** One line of the lesson's review: what it is, and what it says. */
function Row({ label, start, children }: { label: string; start: number; children: ReactNode }) {
  return (
    <div
      className="a a-up grid grid-cols-[112px_minmax(0,1fr)] gap-x-4 border-t border-line py-3.5 narrow:grid-cols-1 narrow:gap-y-1"
      style={at(start, { dy: 8 })}
    >
      <span>{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Step one: the flagged answer and what the person says was wrong with it. */
function WriteLayer() {
  return (
    <div
      className="a a-exit-left motion-only absolute inset-0 flex flex-col"
      style={at(SHARE, { dur: 380, dx: 40 })}
    >
      <div className="flex min-h-[72px] items-start justify-between gap-3 px-6 pt-4 narrow:px-4">
        <div className="flex min-w-0 flex-col">
          <h3 className="m-0 font-display text-h2 font-semibold">Teach this</h3>
          <span className="truncate text-small">Reply to &quot;{ASK}&quot;</span>
        </div>
        <IconButton label="Close" size="sm" tabIndex={-1}>
          <X size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden border-t border-line px-6 pt-5 narrow:px-4">
        <blockquote className="m-0 border-l-2 border-line-strong pl-4 text-pretty">
          {REPLY}
        </blockquote>
        <Field label="What was wrong" start={FLAG + 700}>
          <div className={field}>
            <Typed text={WRONG} start={WRITE} step={TYPE_STEP} />
          </div>
        </Field>
        <Field label="What it should have done" optional start={FLAG + 850}>
          <div className={field}>
            <Typed text={SHOULD} start={SHOULD_AT} step={TYPE_STEP} />
          </div>
        </Field>
        <Field label="What it should have used" optional start={FLAG + 1000}>
          <div role="group" className="flex flex-wrap gap-2">
            {FILES.map((file, index) => (
              <span
                key={file}
                className="a a-from-left grid"
                style={at(FILES_AT + index * 70, { dx: 8, dur: 360 })}
              >
                {file === 'policy.md' ? (
                  <Swap
                    at={PICK}
                    before={
                      <ToggleChip
                        pressed={false}
                        onPressedChange={noop}
                        icon={<File size={14} strokeWidth={1.6} />}
                      >
                        {file}
                      </ToggleChip>
                    }
                    after={
                      <ToggleChip
                        pressed
                        onPressedChange={noop}
                        icon={<File size={14} strokeWidth={1.6} />}
                      >
                        {file}
                      </ToggleChip>
                    }
                  />
                ) : (
                  <ToggleChip
                    pressed={false}
                    onPressedChange={noop}
                    icon={<File size={14} strokeWidth={1.6} />}
                  >
                    {file}
                  </ToggleChip>
                )}
              </span>
            ))}
          </div>
        </Field>
      </div>
      <div className="flex min-h-[76px] items-center justify-between gap-4 border-t border-line px-6 narrow:flex-col narrow:items-stretch narrow:gap-3 narrow:px-4 narrow:py-3">
        <span className="max-w-[34ch] text-small text-pretty">
          Only this exchange, its steps and your notes go to Spark, for up to $0.25.
        </span>
        <span className="a a-press inline-flex" style={at(SHARE - 120, { dur: 320 })}>
          <Button variant="primary" size="md" tabIndex={-1}>
            <Send size={15} strokeWidth={1.8} aria-hidden />
            Share with Spark
          </Button>
        </span>
      </div>
    </div>
  );
}

/** Step two: Spark's lesson, to review before it is saved as a new version. */
function ReviewLayer() {
  return (
    <div className="absolute inset-0 flex flex-col">
      <div
        className="a a-from-right flex min-h-[72px] items-start justify-between gap-3 px-6 pt-4 narrow:px-4"
        style={at(REVIEW, { dx: 40, dur: 520 })}
      >
        <div className="flex min-w-0 flex-col">
          <h3 className="m-0 font-display text-h2 font-semibold">Flagged answer</h3>
          <span className="text-small">To review</span>
        </div>
        <IconButton label="Close" size="sm" tabIndex={-1}>
          <X size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden border-t border-line px-6 pt-5 narrow:px-4">
        <div
          className="a a-from-right flex flex-col gap-3 pb-5"
          style={at(REVIEW + 120, { dx: 40, dur: 520 })}
        >
          <span className="flex items-center gap-2 text-small">
            <ListChecks size={15} strokeWidth={1.7} aria-hidden />
            Rule
          </span>
          <p className="m-0 font-display text-h1 font-semibold text-balance">
            Check policy.md for days no carrier collects before booking a pickup.
          </p>
        </div>
        <Row label="You said" start={REVIEW + 450}>
          {WRONG}
        </Row>
        <Row label="Change" start={REVIEW + 600}>
          <span className="font-medium">Adds to its instructions</span>
          <blockquote className="m-0 mt-2 border-l-2 border-line-strong pl-3 text-pretty">
            {LESSON}
          </blockquote>
        </Row>
        <Row label="Practice needed" start={REVIEW + 750}>
          No, a rule is enough
        </Row>
        <Row label="Why" start={REVIEW + 900}>
          Its instructions don&apos;t say that no carrier collects on a holiday such as
          Thanksgiving.
        </Row>
      </div>
      <div
        className="a a-up flex min-h-[76px] items-center justify-end gap-3 border-t border-line px-6 narrow:flex-wrap narrow:px-4 narrow:py-3"
        style={at(REVIEW + 1100, { dy: 8 })}
      >
        <Button variant="ghost" size="md" tabIndex={-1}>
          <Trash2 size={15} strokeWidth={1.7} aria-hidden />
          Discard
        </Button>
        <Button variant="secondary" size="md" tabIndex={-1} className="narrow:hidden">
          Save for Improve
        </Button>
        <Button variant="primary" size="md" tabIndex={-1}>
          <Layers size={15} strokeWidth={1.7} aria-hidden />
          Save as version 2
        </Button>
      </div>
    </div>
  );
}

export function TeachMock() {
  return (
    <ChapterStage
      id="teach"
      label="The Architect workspace. The returns desk agent answered a request to book the earliest pickup for a return with Thursday, November 26. The person flags the answer and, in Teach this, writes that November 26 is Thanksgiving and no carrier picks up that day, says it should book Friday, and picks policy.md as the file it should have used, then shares it with Spark. Spark's lesson is shown to review as Flagged answer: a rule that adds to its instructions to check the policy for days when no carrier collects, with no practice needed. It can be discarded, saved for Improve, or saved as version 2, while version 1 keeps answering."
      heightWide={700}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex wide:inset-x-7 wide:top-6 narrow:min-h-[700px]">
        <Sidebar agents={deskSidebar([TITLE, CHATS[0], CHATS[1]], 0)} className="narrow:hidden" />
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatHeader title={TITLE} />
          <div className="min-h-0 flex-1 overflow-hidden px-8 pt-4 narrow:px-4">
            <div className="mx-auto flex max-w-[720px] flex-col gap-6">
              <UserBubble className="a a-up" style={at(ASKED, { dy: 36, dur: 700 })}>
                <KeepIds text={ASK} />
              </UserBubble>
              <Reply>
                <P className="a a-wipe" style={at(ANSWER, { dur: 900 })}>
                  {REPLY}
                </P>
                <div className="a a-up flex gap-1" style={at(ACTIONS, { dy: 8 })}>
                  <IconButton label="Copy" size="sm" tabIndex={-1}>
                    <Copy size={15} strokeWidth={1.6} aria-hidden />
                  </IconButton>
                  <span className="a a-press relative inline-flex" style={at(FLAG, { dur: 360 })}>
                    <IconButton label="Teach this" size="sm" tabIndex={-1}>
                      <Flag size={15} strokeWidth={1.6} aria-hidden />
                    </IconButton>
                  </span>
                </div>
              </Reply>
            </div>
          </div>
        </div>

        <div
          aria-hidden
          className="a a-scrim absolute inset-0 bg-backdrop"
          style={at(DRAWER, { dur: 420 })}
        />
        <aside
          aria-label="Teach this"
          className="a a-slide-in absolute inset-y-0 right-0 w-[520px] overflow-hidden bg-raised shadow-float narrow:inset-x-2 narrow:bottom-2 narrow:top-14 narrow:w-auto narrow:rounded-card"
          style={at(DRAWER, { dur: 560, dx: '100%', dy: 60 })}
        >
          <WriteLayer />
          <ReviewLayer />
        </aside>
      </AppWindow>
    </ChapterStage>
  );
}
