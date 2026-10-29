import type { CSSProperties, ReactNode } from 'react';
import {
  Button,
  cn,
  Heading,
  IconButton,
  SettingsRow,
  StatusMark,
  ToggleChip,
  VersionTag,
} from '@architect/ui';
import { ArrowUpRight, File, ListChecks, Send, X } from 'lucide-react';
import { Prose, P, Reply, ReplyActions, UserBubble, WorkedFor } from './chat';
import { AppWindow, ChatHeader, Sidebar } from './frame';
import { PICKUP_ASK, PICKUP_SIDEBAR, PICKUP_TITLE } from './jobs';
import { at } from './motion';
import { noop } from './noop';
import { ChapterStage } from './stage';

const FILES = ['orders.csv', 'customers.csv', 'returns.csv', 'pickups.csv', 'policy.md'];

/**
 * The flagged reply, what the person says is wrong with it, and the lesson Spark makes of that.
 * The pickup is for return RT-4092, which can be handed over from Thursday, November 26, 2026. That
 * is Thanksgiving, and the shop's policy says no carrier collects on it.
 */
const REPLY = 'Cedarline Parcel can collect it Thursday, 2026-11-26.';
const WRONG = 'No carrier picks up on Thanksgiving.';
const SHOULD = 'Book Friday, the next day Cedarline collects.';
const LESSON_TEXT =
  'Before booking a pickup, check policy.md for days when no carrier collects, like Thanksgiving.';

/** When the chapter's moments happen, in ms from the start. */
const FLAG = 500;
const DRAWER = 850;
const WRITE = 1500;
const SEND = 4000;
const LESSON = 4500;
const SAVE = 6900;
const SAVED = 7300;

/** Words that arrive a few at a time, as a person's typing does. */
function Typed({ text, start, step = 52 }: { text: string; start: number; step?: number }) {
  return (
    <>
      {text.split(' ').map((word, index) => (
        <span
          key={index}
          className="a a-up inline-block"
          style={at(start + index * step, { dy: 4, dur: 240 })}
        >
          {word}
          {' '}
        </span>
      ))}
    </>
  );
}

function Field({
  label,
  hint,
  children,
  style,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="a a-up flex flex-col gap-2" style={style}>
      <span className="flex items-baseline gap-2 text-fg">
        {label}
        {hint && <span className="text-sm text-fg-muted">{hint}</span>}
      </span>
      {children}
    </div>
  );
}

const box =
  'w-full rounded-md border border-line-control bg-well px-3 py-2.5 text-base leading-normal';

/** What the person writes under a flagged reply, the first thing the drawer shows. */
function WriteLayer() {
  return (
    <div
      className="a a-exit-left motion-only absolute inset-0 flex flex-col gap-5 px-6 pt-5"
      style={at(SEND + 350, { dur: 360, dx: 36 })}
    >
      <blockquote
        className="a a-up m-0 border-l-2 border-line-control pl-4 text-fg-secondary"
        style={at(WRITE, { dy: 10 })}
      >
        {REPLY}
      </blockquote>
      <Field label="What was wrong" style={at(WRITE + 150, { dy: 10 })}>
        <div className={cn(box, 'min-h-[70px]')}>
          <Typed text={WRONG} start={WRITE + 500} />
        </div>
      </Field>
      <Field label="What it should have done" hint="Optional" style={at(WRITE + 300, { dy: 10 })}>
        <div className={cn(box, 'min-h-[70px]')}>
          <Typed text={SHOULD} start={WRITE + 1250} />
        </div>
      </Field>
      <Field label="What it should have used" hint="Optional" style={at(WRITE + 450, { dy: 10 })}>
        <div role="group" className="flex flex-wrap gap-2">
          {FILES.map((file, index) => (
            <span
              key={file}
              className="a a-from-left grid"
              style={at(WRITE + 2100 + index * 70, { dx: 8, dur: 360 })}
            >
              {file === 'policy.md' ? (
                <>
                  <span
                    className="a a-exit-up [grid-area:1/1]"
                    style={at(SEND - 700, { dur: 120, dy: 0 })}
                  >
                    <ToggleChip
                      pressed={false}
                      onPressedChange={noop}
                      icon={<File size={14} strokeWidth={1.6} />}
                    >
                      {file}
                    </ToggleChip>
                  </span>
                  <span className="a a-pop [grid-area:1/1]" style={at(SEND - 700, { dur: 260 })}>
                    <ToggleChip
                      pressed
                      onPressedChange={noop}
                      icon={<File size={14} strokeWidth={1.6} />}
                    >
                      {file}
                    </ToggleChip>
                  </span>
                </>
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
  );
}

function Fact({
  label,
  children,
  style,
}: {
  label: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      className="a a-up grid grid-cols-[112px_minmax(0,1fr)] gap-4 border-t border-line py-3.5 narrow:grid-cols-[72px_minmax(0,1fr)] narrow:gap-2.5"
      style={style}
    >
      <dt className="text-fg-muted">{label}</dt>
      <dd className="m-0 flex flex-col gap-2 text-fg-soft text-pretty">{children}</dd>
    </div>
  );
}

/** The lesson Spark proposes from the flagged answer. */
function LessonLayer() {
  return (
    <div
      className="a a-exit-left motion-only absolute inset-0 flex flex-col gap-6 px-6 pt-5"
      style={at(SAVE + 100, { dur: 360, dx: 36 })}
    >
      <div className="flex flex-col gap-3">
        <span
          className="a a-up flex items-center gap-2 text-sm text-fg-secondary"
          style={at(LESSON + 150, { dy: 10 })}
        >
          <ListChecks size={15} strokeWidth={1.7} aria-hidden />
          Rule
        </span>
        <p
          className="a a-wipe m-0 text-2xl text-fg text-pretty"
          style={at(LESSON + 350, { dur: 1100 })}
        >
          {LESSON_TEXT}
        </p>
      </div>
      <dl className="m-0 flex flex-col">
        <Fact label="You said" style={at(LESSON + 1100, { dy: 10 })}>
          {WRONG}
        </Fact>
        <Fact label="Change" style={at(LESSON + 1300, { dy: 10 })}>
          <span className="text-fg">Adds to its instructions</span>
          <span className="border-l-2 border-line-control pl-3 text-fg-secondary">
            A pickup date must be a day the carrier collects. policy.md lists the days none do.
          </span>
        </Fact>
        <Fact label="Practice needed" style={at(LESSON + 1500, { dy: 10 })}>
          No, a rule is enough
        </Fact>
      </dl>
    </div>
  );
}

/** What the drawer says once the lesson is saved: the new version, and that the old one answers. */
function SavedLayer() {
  return (
    <div className="absolute inset-0 flex flex-col gap-7 px-6 pt-7">
      <div role="status" className="flex flex-col items-start gap-4 narrow:flex-row narrow:gap-3">
        <div className="a a-pop" style={at(SAVED + 100, { dur: 420 })}>
          <StatusMark state="ok" size={24} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Heading as="h3" size="title" className="a a-up" style={at(SAVED + 250, { dy: 12 })}>
            Saved as version 2
          </Heading>
          <p className="m-0 flex flex-col text-fg-secondary">
            <span className="a a-up narrow:hidden" style={at(SAVED + 450, { dy: 10 })}>
              It hasn&apos;t taken a final test.
            </span>
            <span className="a a-up" style={at(SAVED + 650, { dy: 10 })}>
              Version 1 keeps answering until you use version 2.
            </span>
          </p>
        </div>
      </div>
      <dl className="m-0 flex flex-col">
        <Fact label="You said" style={at(SAVED + 800, { dy: 12 })}>
          {WRONG}
        </Fact>
        <Fact label="Lesson" style={at(SAVED + 950, { dy: 12 })}>
          {LESSON_TEXT}
        </Fact>
      </dl>
      <ul aria-label="Versions" className="m-0 flex list-none flex-col p-0">
        <li className="a a-up" style={at(SAVED + 1100, { dy: 12 })}>
          <SettingsRow
            icon={<VersionTag version={2} />}
            label="New, not in use yet"
            meta="No final test yet · from version 1"
          >
            <Button size="xs" tabIndex={-1}>
              <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
              Use this version
            </Button>
          </SettingsRow>
        </li>
        <li className="a a-up" style={at(SAVED + 1300, { dy: 12 })}>
          <SettingsRow icon={<VersionTag version={1} active />} label="In use">
            <span className="flex flex-col items-end tabular-nums narrow:hidden">
              <span className="font-mono">97%</span>
              <span className="text-sm text-fg-muted">58 of 60 passed</span>
            </span>
          </SettingsRow>
        </li>
      </ul>
    </div>
  );
}

/** The drawer's footer: three states in one place, each leaving as the next arrives. */
function Footers() {
  return (
    <div className="grid min-h-16 shrink-0 border-t border-line-card px-6 py-3.5 [&>*]:[grid-area:1/1]">
      <div
        className="a a-exit-up motion-only flex flex-wrap items-center justify-end gap-x-4 gap-y-3"
        style={at(SEND + 350, { dur: 260, dy: 0 })}
      >
        <p className="m-0 mr-auto max-w-[260px] text-sm text-fg-secondary text-pretty narrow:hidden">
          Only this exchange, its steps and your notes go to Spark, for up to $0.25.
        </p>
        <span className="a a-press inline-flex" style={at(SEND - 100, { dur: 300 })}>
          <Button size="md" variant="primary" tabIndex={-1}>
            <Send size={14} strokeWidth={1.8} aria-hidden />
            Share with Spark
          </Button>
        </span>
      </div>
      <div
        className="a a-up motion-only flex items-center justify-end"
        style={at(LESSON + 300, { dy: 10 })}
      >
        <div
          className="a a-exit-up flex flex-wrap items-center justify-end gap-x-3 gap-y-3"
          style={at(SAVE + 100, { dur: 260, dy: 0 })}
        >
          <Button size="md" variant="ghost" tabIndex={-1} className="narrow:hidden">
            Discard
          </Button>
          <Button size="md" variant="secondary" tabIndex={-1} className="narrow:hidden">
            Save for Improve
          </Button>
          <span className="a a-press inline-flex" style={at(SAVE - 150, { dur: 300 })}>
            <Button size="md" variant="primary" tabIndex={-1}>
              Save as version 2
            </Button>
          </span>
        </div>
      </div>
      <div
        className="a a-up flex items-center justify-end gap-x-4"
        style={at(SAVED + 1500, { dy: 10 })}
      >
        <Button size="md" tabIndex={-1}>
          Done
        </Button>
        <Button size="md" variant="primary" tabIndex={-1}>
          Open Teaching
        </Button>
      </div>
    </div>
  );
}

/** The drawer over the window, from the flag to the saved version. */
function Drawer() {
  return (
    <div
      className={cn(
        'a a-slide-in absolute bottom-3 right-3 top-3 flex w-[520px] flex-col overflow-hidden',
        'rounded-3xl border border-line-control bg-modal shadow-modal',
        'narrow:inset-x-3 narrow:w-auto',
      )}
      style={at(DRAWER, { dur: 640 })}
    >
      <div className="flex min-h-[60px] shrink-0 items-start gap-3 border-b border-line-card py-2.5 pl-6 pr-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
          <h3 className="m-0 text-md font-medium">Teach this</h3>
          <span className="truncate text-sm text-fg-muted narrow:hidden">
            Reply to &quot;{PICKUP_ASK}&quot;
          </span>
        </div>
        <IconButton label="Close" tabIndex={-1}>
          <X size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        <WriteLayer />
        <LessonLayer />
        <SavedLayer />
      </div>
      <Footers />
    </div>
  );
}

/**
 * Correcting an answer: the flag under a reply opens Teach this. The person says what was wrong,
 * Spark turns it into a lesson, and saving it makes a new version. The version in use keeps
 * answering until the person switches.
 */
export function TeachMock() {
  return (
    <ChapterStage
      id="teach"
      label="The Architect workspace with Teach this open. The person flagged the returns desk's reply about a pickup date, and wrote what was wrong: no carrier picks up on Thanksgiving. Spark turned it into a lesson: before booking a pickup, check policy.md for days when no carrier collects. It is saved as version 2. Version 1 keeps answering until the person uses version 2."
      heightWide={690}
      heightCompact={800}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 wide:inset-x-7 wide:top-6">
        <div className="absolute inset-0 flex narrow:hidden">
          <Sidebar agents={PICKUP_SIDEBAR} />
          <div className="flex min-w-0 flex-1 flex-col">
            <ChatHeader title={PICKUP_TITLE} />
            <div className="min-h-0 flex-1 overflow-hidden px-8 pt-5">
              <div className="ml-0 flex w-[212px] flex-col gap-6 text-chat">
                <UserBubble articleClassName="max-w-full">{PICKUP_ASK}</UserBubble>
                <Reply>
                  <WorkedFor>Worked for 29 s · 2 steps</WorkedFor>
                  <Prose>
                    <P>{REPLY}</P>
                  </Prose>
                  <span className="a a-press -mt-2 block" style={at(FLAG, { dur: 360 })}>
                    <ReplyActions
                      flagged
                      flagClassName="a a-fill"
                      flagStyle={at(FLAG + 80, { dur: 300 })}
                    />
                  </span>
                </Reply>
              </div>
            </div>
          </div>
        </div>
        <div
          className="a a-scrim absolute inset-0 bg-backdrop narrow:hidden"
          style={at(DRAWER - 50, { dur: 500 })}
        />
        <Drawer />
      </AppWindow>
    </ChapterStage>
  );
}
