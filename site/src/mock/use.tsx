import {
  cn,
  TableBody,
  TableCard,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@architect/ui';
import { Reply, Steps, UserBubble } from './chat';
import { AppWindow, ChatComposer, ChatHeader, Sidebar } from './frame';
import { at } from './motion';
import { ChapterStage } from './stage';

/**
 * Using the agent: the ready-made returns desk, a made-up business, on this computer's 2-bit
 * Glimmer, asked one question about a customer's October orders. It read two files, searched two
 * more, and answered correctly in 97 seconds. The question and the answer are the run's own.
 */

const QUESTION =
  'Which orders did orrin.castellanos@example.com place in October 2026, and what was in each?';

const AGENTS = [
  {
    name: 'Returns desk',
    chats: [
      { title: QUESTION, current: true },
      { title: 'Start a return for ORD-10482', awaitsApproval: true },
    ],
  },
];

const STEPS = [
  { action: 'Read', target: 'data/orders.csv' },
  { action: 'Read', target: 'data/customers.csv' },
  { action: 'Searched', target: 'orders.csv' },
  { action: 'Searched', target: 'order_lines.csv' },
];

type Line = readonly [sku: string, name: string, qty: string, price: string];

interface Order {
  id: string;
  placed: string;
  lines: readonly Line[];
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

/** On a phone the table keeps this many orders and counts the rest. */
const SHOWN_ON_NARROW = 1;
const TABLE_AT = 3000;

/** The agent's answer: each order it found, when it was placed, and what was in it. */
function Orders() {
  const rest = ORDERS.slice(SHOWN_ON_NARROW);
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
            <TableRow key={order.id} className={cn(index >= SHOWN_ON_NARROW && 'narrow:hidden')}>
              <TableCell className="whitespace-nowrap align-top narrow:px-3!">
                <span
                  className="a a-up flex flex-col"
                  style={at(TABLE_AT + 250 + index * 300, { dy: 8, dur: 500 })}
                >
                  <span className="font-mono text-fg">{order.id}</span>
                  <span className="text-sm text-fg-muted">{order.placed}</span>
                </span>
              </TableCell>
              <TableCell className="align-top narrow:px-3!">
                <ul
                  className="a a-up m-0 flex list-none flex-col p-0 leading-6"
                  style={at(TABLE_AT + 300 + index * 300, { dy: 8, dur: 500 })}
                >
                  {order.lines.map(([sku, name, qty, price]) => (
                    <li key={sku} className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-mono text-sm text-fg-muted">{sku}</span>
                      <span className="text-fg">{name}</span>
                      <span className="font-mono text-sm tabular-nums text-fg-secondary sm:ml-auto">
                        {qty} {price}
                      </span>
                    </li>
                  ))}
                </ul>
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="hidden narrow:table-row">
            <TableCell colSpan={2} className="text-sm text-fg-muted narrow:px-3!">
              {rest.length} more orders: {rest.map((order) => order.id).join(', ')}
            </TableCell>
          </TableRow>
        </TableBody>
      </TableCard>
    </div>
  );
}

export function UseMock() {
  return (
    <ChapterStage
      id="use"
      label="The Architect workspace. The ready-made returns desk agent, running on this computer, was asked which orders a customer placed in October 2026 and what was in each. It read the orders and customers files, searched the orders and order lines, and answered in 1 minute 37 seconds with four orders and their items. Another chat is waiting for the person to approve a change, and the box below says it asks first before saving files."
      heightWide={945}
      heightCompact={865}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex wide:inset-x-7 wide:top-6">
        <Sidebar agents={AGENTS} className="narrow:hidden" />
        <div className="flex min-w-0 flex-1 flex-col">
          <ChatHeader title={QUESTION} />
          <div className="min-h-0 flex-1 overflow-hidden px-8 pt-5 narrow:px-4">
            <div className="mx-auto flex max-w-[720px] flex-col gap-6 text-chat">
              <UserBubble
                className="a a-up"
                articleClassName="narrow:max-w-full"
                style={at(250, { dy: 36, dur: 700 })}
              >
                {QUESTION}
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
          <ChatComposer agent="Returns desk" version={1} />
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
