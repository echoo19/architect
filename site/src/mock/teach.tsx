import { Button, cn, IconButton, VersionTag } from '@architect/ui';
import { Copy, Flag, X } from 'lucide-react';
import { KeepIds, P, Reply, UserBubble } from './chat';
import { AppWindow, ChatHeader, Sidebar } from './frame';
import { CHATS, deskSidebar } from './jobs';
import { Insert, Model, Typed } from './kit';
import { at } from './motion';
import { ChapterStage } from './stage';

/**
 * Teaching it: the agent's answer is wrong, the person flags it and says why, and Spark turns that
 * into a lesson that is saved as a new version. The return is RT-4092, whose earliest day is
 * Thursday, November 26, 2026: Thanksgiving, when the shop's policy says no carrier collects. The
 * version before it passed 58 of 60 on its final test.
 */

const TITLE = 'Book the earliest pickup for return RT-4092';
const ASK = 'Book the earliest pickup for return RT-4092.';
const REPLY = 'Cedarline Parcel can collect it on Thursday, November 26.';
const WRONG = 'November 26 is Thanksgiving, and no carrier picks up that day.';
const LESSON =
  'Before booking a pickup, check policy.md for days when no carrier collects, like Thanksgiving.';

/** When things happen, in ms from the start. */
const ASKED = 300;
const ANSWER = 900;
const ACTIONS = 1700;
const FLAG = 2400;
const DRAWER = 2650;
const TYPE = 3500;
const TYPE_STEP = 52;
const TYPED_END = TYPE + WRONG.split(' ').length * TYPE_STEP;
const LESSON_AT = TYPED_END + 900;
const VERSIONS = LESSON_AT + 2000;

export function TeachMock() {
  return (
    <ChapterStage
      id="teach"
      label="The Architect workspace. The returns desk agent answered a request to book the earliest pickup for a return with Thursday, November 26. The person flags the answer and writes that November 26 is Thanksgiving and no carrier picks up that day. Spark turns that into a lesson: before booking a pickup, check the policy for days when no carrier collects. It is saved as version 2, which is not in use yet. Version 1, which passed 58 of 60 on its final test, keeps answering until the person uses version 2."
      heightWide={700}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex wide:inset-x-7 wide:top-6 narrow:min-h-[640px]">
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
          className="a a-slide-in absolute inset-y-0 right-0 flex w-[460px] flex-col bg-raised shadow-float narrow:inset-x-2 narrow:bottom-2 narrow:top-14 narrow:w-auto narrow:rounded-card"
          style={at(DRAWER, { dur: 560, dx: '100%', dy: 60 })}
        >
          <div className="flex min-h-16 items-center justify-between px-6 narrow:px-4">
            <h3 className="m-0 font-display text-h2 font-semibold">Teach this</h3>
            <IconButton label="Close" size="sm" tabIndex={-1}>
              <X size={16} strokeWidth={1.8} aria-hidden />
            </IconButton>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-hidden border-t border-line px-6 pt-6 narrow:px-4">
            <blockquote className="m-0 border-l-2 border-line-strong pl-4 text-pretty">
              {REPLY}
            </blockquote>
            <div className="flex flex-col gap-2">
              <span className="font-medium">What was wrong</span>
              <div className="min-h-[76px] rounded-control bg-field px-3.5 py-3 text-body leading-normal shadow-edge-strong">
                <Typed text={WRONG} start={TYPE} step={TYPE_STEP} />
              </div>
            </div>
            <Insert start={LESSON_AT - 200} dur={600}>
              <div className="flex flex-col gap-2">
                <span className="a a-up font-medium" style={at(LESSON_AT, { dy: 8 })}>
                  <Model name="Spark" />
                </span>
                <p
                  className="a a-wipe m-0 text-body text-pretty"
                  style={at(LESSON_AT + 200, { dur: 1400 })}
                >
                  {LESSON}
                </p>
              </div>
            </Insert>
            <Insert start={VERSIONS - 100} dur={600}>
              <ul className="m-0 flex list-none flex-col p-0">
                <li
                  className="a a-up flex min-h-14 items-center justify-between gap-3 border-t border-line"
                  style={at(VERSIONS, { dy: 8 })}
                >
                  <span className="flex items-center gap-3">
                    <VersionTag version={2} />
                    <span>Not in use yet</span>
                  </span>
                  <Button variant="secondary" size="sm" tabIndex={-1}>
                    Use this version
                  </Button>
                </li>
                <li
                  className={cn(
                    'a a-up flex min-h-14 items-center justify-between gap-3 border-t border-line',
                  )}
                  style={at(VERSIONS + 200, { dy: 8 })}
                >
                  <span className="flex items-center gap-3">
                    <VersionTag version={1} active />
                    <span>In use</span>
                  </span>
                  <span className="tabular-nums">58 of 60 passed</span>
                </li>
              </ul>
            </Insert>
          </div>
        </aside>
      </AppWindow>
    </ChapterStage>
  );
}
