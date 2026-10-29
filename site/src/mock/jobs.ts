import type { SidebarAgent } from './frame';

/**
 * What the page's windows show: one made-up shop, Larchwood Outfitters, and the returns desk agent
 * that works its records. The first window's three finished chats are answered from the sample
 * job's own records and rules, so every figure in them is one the rules give.
 */

export const DESK = 'Returns desk';

/** The chats the chapters list beside the one that is open. */
export const ORDERS_TITLE =
  'Which orders did orrin.castellanos@example.com place in October 2026, and what was in each?';
export const PICKUP_ASK = 'Book the earliest pickup for return RT-4092.';
export const PICKUP_TITLE = 'Book the earliest pickup for return RT-4092';
export const START_TITLE = 'Start a return';

/** The sidebar of the chapters about correcting and sharing: the pickup chat is the open one. */
export const PICKUP_SIDEBAR: SidebarAgent[] = [
  {
    name: DESK,
    chats: [
      { title: ORDERS_TITLE },
      { title: PICKUP_TITLE, current: true },
      { title: START_TITLE, awaitsApproval: true },
    ],
  },
];

export interface JobChat {
  /** The chat's title in the sidebar and over the transcript. */
  title: string;
  ask: string;
  worked: string;
  /** The answer's first line: plain text, and the figures set in bold as `{ b }`. */
  lead: readonly (string | { b: string })[];
  bullets: readonly string[];
  intro: string;
  table: {
    label: string;
    columns: readonly string[];
    rows: readonly (readonly string[])[];
    /** Columns a phone's narrow window leaves out, by position. */
    hideOnNarrow?: readonly number[];
    note?: string;
  };
}

export const JOBS: readonly JobChat[] = [
  {
    title: "Can Nico's tent come back?",
    ask: "Nico Mbeki wants to return the Two-Person Backpacking Tent from order ORD-10506. It's opened. Can it come back, and what does he get?",
    worked: 'Worked for 52 s · 4 steps',
    lead: [
      'Yes. The tent was delivered 23 days ago, inside the 30 day window, and Nico gets ',
      { b: '$258.22' },
      ' back on his card.',
    ],
    bullets: [
      'An opened tent has a 15% restocking fee.',
      'Nico is not a member, so he pays the $6.95 return label.',
    ],
    intro: 'Here is how the refund adds up:',
    table: {
      label: 'Refund for order ORD-10506',
      columns: ['Item', 'Amount'],
      rows: [
        ['Two-Person Backpacking Tent', '$311.96'],
        ['Restocking fee, 15%', '-$46.79'],
        ['Return label', '-$6.95'],
        ['Refund to card', '$258.22'],
      ],
    },
  },
  {
    title: 'What has Marcus spent on tents?',
    ask: 'How much has Marcus Fairbanks spent on tents since September 23?',
    worked: 'Worked for 47 s · 4 steps',
    lead: ['Marcus has spent ', { b: '$1,189.95' }, ' on tents since September 23.'],
    bullets: [
      'One order counts: ORD-10413, placed on September 23.',
      'The tent was returned later, but a return does not lower what a customer has spent.',
    ],
    intro: 'Here is the order:',
    table: {
      label: 'Tent spending for Marcus Fairbanks',
      columns: ['Item', 'Order', 'Spent'],
      rows: [
        ['Four-Season Expedition Tent', 'ORD-10413', '$1,189.95'],
        ['Total', '', '$1,189.95'],
      ],
      hideOnNarrow: [1],
    },
  },
  {
    title: "Can Vera's pot sets come back?",
    ask: 'Vera Galloway brought back 2 Titanium Pot Sets from order ORD-10289. They are opened. Can they come back?',
    worked: 'Worked for 36 s · 3 steps',
    lead: [
      'No. The order was delivered 94 days ago, far past the 30 day window, so the refund is ',
      { b: '$0.00' },
      '.',
    ],
    bullets: [
      'Vera is not a member, so the window is 30 days, not 60.',
      'The order had 1 pot set, so 2 could not come back anyway.',
    ],
    intro: 'Here is how it was decided:',
    table: {
      label: 'How the return was decided',
      columns: ['Check', 'Result'],
      rows: [
        ['Delivered', '94 days ago'],
        ['Window for Vera', '30 days'],
        ['Pot sets bought', '1'],
        ['Pot sets returned', '2'],
        ['Decision', 'Denied'],
      ],
    },
  },
];

/** The window's sidebar with one chat open; the agent's other chat stays where it is. */
export function sidebarFor(open: number): SidebarAgent[] {
  return [
    {
      name: DESK,
      chats: [
        ...JOBS.map((job, index) => ({ title: job.title, current: index === open })),
        { title: START_TITLE, awaitsApproval: true },
      ],
    },
  ];
}
