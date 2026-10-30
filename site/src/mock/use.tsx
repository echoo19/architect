import {
  cn,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { ApprovalCard, KeepIds, P, Reply, Steps, UserBubble, WaitingLine } from './chat';
import { AppWindow, ChatComposer, ChatHeader, Sidebar } from './frame';
import { DESK, ORDERS_TITLE, START_TITLE } from './jobs';
import { at } from './motion';
import { ChapterStage } from './stage';

/**
 * Using the agent: the ready-made returns desk, a made-up business, on this computer's 2-bit
 * Glimmer. It is asked one question about a customer's October orders, reads two files, searches
 * two more, and answers correctly in 97 seconds; the question and the answer are the run's own.
 * Then it is asked to book a carrier pickup for one of that customer's returns, and it stops at the
 * row it wants to add to pickups.csv and waits, because writing a file needs the person's say.
 * That second request is made up to show the wait, from the same shop's records and rules.
 */

const QUESTION = ORDERS_TITLE;

const AGENTS = [
  {
    name: DESK,
    chats: [{ title: QUESTION, current: true }, { title: START_TITLE }],
  },
];

const ASK =
  'Orrin is sending back the dry bag from ORD-10482, return RT-4106. Book the earliest carrier pickup.';

const STEPS = [
  { action: 'Read', target: 'data/orders.csv' },
  { action: 'Read', target: 'data/customers.csv' },
  { action: 'Searched', target: 'orders.csv' },
  { action: 'Searched', target: 'order_lines.csv' },
];

const BOOKING_STEPS = [
  { action: 'Searched', target: 'returns.csv' },
  { action: 'Searched', target: 'customers.csv' },
  { action: 'Searched', target: 'pickups.csv' },
];

/**
 * What it says before the row, and the row. RT-4106 is the dry bag, for a customer in the Valley
 * region, which Cedarline Parcel serves. The dry bag can be handed over from Friday, December 4, a
 * day Cedarline collects, and no Cedarline pickup is booked for that day yet.
 */
const BOOKING_SAYS =
  'Orrin can hand over RT-4106 from Friday, December 4, so that is the earliest day.';
const BOOKING_WHY = ' Cedarline Parcel serves his region and collects that day.';
const PICKUP_COLUMNS = ['pickup_id', 'return_id', 'carrier', 'pickup_date', 'booked_on'];
const PICKUP_ROW = ['PU-4106', 'RT-4106', 'Cedarline Parcel', '2026-12-04', '2026-11-24'];
/** On a phone the row keeps the carrier, which may take two lines, and the date. */
const PICKUP_HIDDEN_ON_NARROW = [0, 1, 4];
const PICKUP_WRAPS_ON_NARROW = [2];

type Line = readonly [sku: string, name: string, qty: string, price: string];

interface Order {
  id: string;
  placed: string;
  lines: readonly Line[];
  /** The one order a phone shows, since it has room for one: the one the next request is about. */
  keptOnNarrow?: boolean;
}

const ORDERS: readonly Order[] = [
  {
    id: 'ORD-10440',
    placed: 'Oct 2',
    lines: [
      ['KS-9868', 'River Sandal', 'x1', '$55.96'],
      ['WD-6432', 'Self-Inflating Pad', 'x1', '$99.95'],
    ],
  },
  {
    id: 'ORD-10454',
    placed: 'Oct 6',
    lines: [
      ['FN-3028', 'Rechargeable Headlamp', 'x2', '$44.96'],
      ['CM-7661', 'Fleece Quarter-Zip', 'x1', '$79.95'],
      ['PX-2721', 'Hip Pack', 'x1', '$44.00'],
      ['LT-7840', 'Locking Carabiner', 'x1', '$11.96'],
    ],
  },
  {
    id: 'ORD-10482',
    placed: 'Oct 17',
    keptOnNarrow: true,
    lines: [
      ['FN-6517', 'Dry Bag 20L', 'x1', '$34.95'],
      ['VB-3808', 'Four-Season Expedition Tent', 'x1', '$1,189.95'],
      ['TW-7734', 'Double Camp Cot', 'x1', '$229.95'],
    ],
  },
  {
    id: 'ORD-10502',
    placed: 'Oct 24',
    lines: [
      ['WD-6810', 'Sleeping Bag Liner', 'x1', '$59.95'],
      ['LT-9829', 'Overnight Pack 45L', 'x1', '$219.95'],
    ],
  },
];

/** When the chapter's moments happen, in ms from the start. */
const TABLE_AT = 3000;
const HAND_OVER = 5900;
const ASK_AT = HAND_OVER + 350;
const WORK_AT = ASK_AT + 700;
const SAYS_AT = WORK_AT + 1750;
const CARD_AT = SAYS_AT + 800;
const WAIT_AT = CARD_AT + 1100;

/** The agent's answer: each order it found, when it was placed, and what was in it. */
function Orders() {
  const rest = ORDERS.filter((order) => !order.keptOnNarrow);
  return (
    <div className="a a-up" style={at(TABLE_AT, { dy: 20, dur: 700 })}>
      <TableCard aria-label="Orders placed in October 2026">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Order</TableHead>
            <TableHead>What was in it</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ORDERS.map((order, index) => (
            <TableRow key={order.id} className={cn(!order.keptOnNarrow && 'narrow:hidden')}>
              <TableCell className="whitespace-nowrap align-top narrow:px-3!">
                <span
                  className="a a-up flex flex-col"
                  style={at(TABLE_AT + 250 + index * 300, { dy: 8, dur: 500 })}
                >
                  <span className="font-mono text-fg">{order.id}</span>
                  <span className="text-small text-fg">{order.placed}</span>
                </span>
              </TableCell>
              <TableCell className="align-top narrow:px-3!">
                <ul
                  className="a a-up m-0 flex list-none flex-col p-0 leading-6"
                  style={at(TABLE_AT + 300 + index * 300, { dy: 8, dur: 500 })}
                >
                  {order.lines.map(([sku, name, qty, price]) => (
                    <li key={sku} className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-mono text-small text-fg narrow:hidden">{sku}</span>
                      <span className="text-fg">{name}</span>
                      <span className="font-mono text-small tabular-nums text-fg sm:ml-auto">
                        {qty} {price}
                      </span>
                    </li>
                  ))}
                </ul>
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="hidden narrow:table-row">
            <TableCell colSpan={2} className="text-small text-fg narrow:px-3!">
              <KeepIds
                text={`${rest.length} more orders: ${rest.map((order) => order.id).join(', ')}`}
              />
            </TableCell>
          </TableRow>
        </TableBody>
      </TableCard>
    </div>
  );
}

/** The first exchange, played from the top as a chat starts, and gone when the chat moves on. */
function FirstExchange() {
  return (
    <div
      className="a a-exit-up motion-only absolute inset-0 px-8 pt-5 narrow:px-4"
      style={at(HAND_OVER, { dur: 420, dy: 40 })}
    >
      <div className="mx-auto flex max-w-[720px] flex-col gap-6 text-body">
        <UserBubble
          className="a a-up"
          articleClassName="narrow:max-w-full"
          style={at(250, { dy: 36, dur: 700 })}
        >
          {QUESTION.replace('@', '@\u200b')}
        </UserBubble>
        <Reply>
          <Steps
            header="Worked for 1 min 37 s · 4 steps"
            steps={STEPS}
            headerStyle={at(1000, { dy: 10 })}
            headerClassName="a a-up"
            stepClassName="a a-wipe"
            stepStyle={(index) => at(1250 + index * 420, { dur: 520 })}
          />
          <Orders />
        </Reply>
      </div>
    </div>
  );
}

/**
 * The same chat once the next request is in: scrolled down, so the end of the answer is still
 * above it. On a phone only the new request has room.
 */
function SecondExchange() {
  return (
    <div className="absolute inset-0 flex flex-col justify-end px-8 pb-5 narrow:px-4">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 text-body">
        <div className="a a-up narrow:hidden" style={at(HAND_OVER + 150, { dur: 450, dy: 0 })}>
          <Orders />
        </div>
        <UserBubble
          className="a a-up"
          articleClassName="narrow:max-w-full"
          style={at(ASK_AT, { dy: 36, dur: 700 })}
        >
          <KeepIds text={ASK} />
        </UserBubble>
        <Reply className="a a-up" style={at(WORK_AT - 100, { dur: 300, dy: 0 })}>
          <Steps
            header="3 steps so far"
            steps={BOOKING_STEPS}
            headerStyle={at(WORK_AT, { dy: 10 })}
            headerClassName="a a-up"
            stepClassName="a a-wipe"
            stepStyle={(index) => at(WORK_AT + 250 + index * 420, { dur: 520 })}
          />
          <P className="a a-up" style={at(SAYS_AT, { dy: 10, dur: 600 })}>
            <KeepIds text={BOOKING_SAYS} />
            <span className="narrow:hidden">{BOOKING_WHY}</span>
          </P>
          <ApprovalCard
            file="data/pickups.csv"
            summary="1 new row"
            columns={PICKUP_COLUMNS}
            rows={[{ cells: PICKUP_ROW }]}
            hideOnNarrow={PICKUP_HIDDEN_ON_NARROW}
            wrapOnNarrow={PICKUP_WRAPS_ON_NARROW}
            className="a a-up"
            style={at(CARD_AT, { dy: 20, dur: 700 })}
            bodyClassName="a a-unfold"
            bodyStyle={at(CARD_AT + 500, { dur: 600 })}
            buttonsClassName="a a-pop"
            buttonsStyle={at(CARD_AT + 800, { dur: 400 })}
          />
          <WaitingLine className="a a-up" style={at(WAIT_AT, { dy: 8 })} />
        </Reply>
      </div>
    </div>
  );
}

export function UseMock() {
  return (
    <ChapterStage
      id="use"
      label="The Architect workspace. The ready-made returns desk agent, running on this computer, was asked which orders a customer placed in October 2026 and what was in each. It read the orders and customers files, searched the orders and order lines, and answered in 1 minute 37 seconds with four orders and their items. Then it was asked to book the earliest carrier pickup for that customer's return. It shows the row it wants to add to pickups.csv, with Deny, Allow saving from now on and Allow once, and waits. Nothing is saved until the person answers."
      heightWide={945}
      heightCompact={960}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex wide:inset-x-7 wide:top-6">
        <Sidebar agents={AGENTS} className="narrow:hidden" />
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatHeader title={QUESTION} />
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <FirstExchange />
            <SecondExchange />
          </div>
          <ChatComposer agent={DESK} version={1} />
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
