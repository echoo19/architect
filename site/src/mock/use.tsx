import { Button, cn } from '@architect/ui';
import { ChevronDown, CirclePause, FilePlus } from 'lucide-react';
import { KeepIds, P, Reply, Steps, UserBubble } from './chat';
import { AppWindow, ChatComposer, ChatHeader, Sidebar } from './frame';
import { CHATS, DESK, deskSidebar } from './jobs';
import { at } from './motion';
import { ChapterStage } from './stage';

/**
 * Using the agent: the returns desk on this computer's build of Glimmer, asked to book a carrier
 * pickup for a return. It reads three files, finds the earliest day a carrier collects, and stops
 * at the row it wants to add to pickups.csv, because writing a file needs the person's say. Nothing
 * is saved until they answer. The request is made up from the shop's own records and rules, to show
 * the wait.
 */

const TITLE = 'Book the pickup for return RT-4106';
const ASK =
  'Orrin is sending back the dry bag from ORD-10482, return RT-4106. Book the earliest carrier pickup.';
const STEPS = [
  { action: 'Searched', target: 'returns.csv' },
  { action: 'Searched', target: 'customers.csv' },
  { action: 'Searched', target: 'pickups.csv' },
];
const SAYS = 'Orrin can hand over RT-4106 from Friday, December 4, so that is the earliest day.';
const WHY = ' Cedarline Parcel serves his region and collects that day.';
const COLUMNS = ['pickup_id', 'return_id', 'carrier', 'pickup_date', 'booked_on'] as const;
const ROW = ['PU-4106', 'RT-4106', 'Cedarline Parcel', '2026-12-04', '2026-11-24'] as const;
/** On a phone the row keeps the carrier and the date. */
const HIDDEN_ON_NARROW = [0, 1, 4];

/** When things happen, in ms from the start. */
const ASKED = 300;
const WORK = 1200;
const WORK_GAP = 420;
const SAYING = WORK + 3 * WORK_GAP + 300;
const CARD = SAYING + 1900;
const BUTTONS = CARD + 900;
const WAITING = BUTTONS + 900;

const cell = (index: number) =>
  cn('px-4 py-2.5 text-left', HIDDEN_ON_NARROW.includes(index) && 'narrow:hidden');

function Header({ file, summary }: { file: string; summary: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-hover">
        <FilePlus size={17} strokeWidth={1.6} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">
          Add to <span className="font-mono text-ui">{file}</span>
          <ChevronDown size={14} strokeWidth={1.8} aria-hidden className="ml-1.5 inline" />
        </span>
        <span className="text-small">{summary}</span>
      </span>
    </div>
  );
}

function Approval() {
  return (
    <section
      aria-label="Change waiting for approval"
      className="a a-up min-w-0 overflow-hidden rounded-card bg-card shadow-edge"
      style={at(CARD, { dy: 18, dur: 700 })}
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3 narrow:flex-col narrow:items-start">
        <Header file="data/pickups.csv" summary="1 new row" />
        <span
          className="a a-pop flex shrink-0 items-center gap-2"
          style={at(BUTTONS, { dur: 400 })}
        >
          <Button variant="ghost" size="sm" tabIndex={-1}>
            Deny
          </Button>
          <Button variant="secondary" size="sm" tabIndex={-1} className="narrow:hidden">
            Allow saving from now on
          </Button>
          <Button variant="primary" size="sm" tabIndex={-1}>
            Allow once
          </Button>
        </span>
      </div>
      <div className="a a-unfold border-t border-line" style={at(CARD + 500, { dur: 600 })}>
        <table className="w-full border-collapse font-mono text-small">
          <thead>
            <tr>
              <th aria-hidden className="w-6" />
              {COLUMNS.map((column, index) => (
                <th key={column} className={cn(cell(index), 'font-medium')}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="bg-student-soft">
              <td className="w-6 pl-4 text-student">+</td>
              {ROW.map((value, index) => (
                <td key={COLUMNS[index]} className={cell(index)}>
                  {value}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function UseMock() {
  return (
    <ChapterStage
      id="use"
      label="The Architect workspace with the ready-made returns desk agent, running on this computer. It was asked to book the earliest carrier pickup for a return of a dry bag. It searched three files, found that Cedarline Parcel can collect on Friday, December 4, and shows the row it wants to add to pickups.csv with Deny, Allow saving from now on and Allow once. It is waiting for the person's approval, and nothing is saved until they give it."
      heightWide={770}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex wide:inset-x-7 wide:top-6">
        <Sidebar agents={deskSidebar([TITLE, CHATS[0], CHATS[1]], 0)} className="narrow:hidden" />
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatHeader title={TITLE} />
          <div className="min-h-0 flex-1 overflow-hidden px-8 pt-4 narrow:px-4">
            <div className="mx-auto flex max-w-[720px] flex-col gap-6">
              <UserBubble className="a a-up" style={at(ASKED, { dy: 36, dur: 700 })}>
                <KeepIds text={ASK} />
              </UserBubble>
              <Reply>
                <Steps
                  header="3 steps so far"
                  steps={STEPS}
                  headerClassName="a a-up"
                  headerStyle={at(WORK - 150, { dy: 8 })}
                  stepClassName="a a-wipe"
                  stepStyle={(index) => at(WORK + index * WORK_GAP, { dur: 520 })}
                />
                <P className="a a-wipe" style={at(SAYING, { dur: 1500 })}>
                  <KeepIds text={SAYS} />
                  <span className="narrow:hidden">{WHY}</span>
                </P>
                <Approval />
                <p
                  className="a a-up m-0 flex items-center gap-2 text-ui"
                  style={at(WAITING, { dy: 8 })}
                >
                  <CirclePause size={16} strokeWidth={1.6} aria-hidden />
                  Waiting for your approval
                </p>
              </Reply>
            </div>
          </div>
          <ChatComposer agent={DESK} version={1} />
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
