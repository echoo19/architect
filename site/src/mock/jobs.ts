import type { SidebarAgent } from './frame';

/**
 * What the hero window shows, one job at a time: three small businesses, each with its own agent
 * and a chat that has finished. The names and figures are made up for the mocks.
 */

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
    note?: string;
  };
}

export const JOBS: readonly JobChat[] = [
  {
    title: 'Price the two jobs Dana finished',
    ask: 'Price the two jobs Dana finished today and tell me the totals.',
    worked: 'Worked for 47 s',
    lead: [
      'Job J-4471 comes to ',
      { b: '$524.03' },
      ' and job J-4473 to ',
      { b: '$1,116.52' },
      '.',
    ],
    bullets: [
      'J-4473 ran after hours, so labor is billed at 1.5x.',
      'The customer on J-4473 is a plan member, so 10% comes off before tax.',
    ],
    intro: "Here's how each total breaks down:",
    table: {
      label: 'Totals for the two jobs',
      columns: ['Item', 'J-4471', 'J-4473'],
      rows: [
        ['Labor', '$300.00', '$720.00'],
        ['Parts', '$158.20', '$412.60'],
        ['Trip fee', '$35.00', '$35.00'],
        ['Total', '$524.03', '$1,116.52'],
      ],
      note: '2 more rows: Plan discount, Tax',
    },
  },
  {
    title: 'Can order 1187 come back?',
    ask: 'Order 1187 wants to send back the Rain Shell Jacket, unworn. Can it come back, and what do they get?',
    worked: 'Worked for 31 s',
    lead: [
      'Yes. Order 1187 was delivered 12 days ago, inside the 30 day window, and the refund is ',
      { b: '$84.96' },
      '.',
    ],
    bullets: [
      'They get the price paid, not the list price.',
      'Return shipping is free on a first return.',
    ],
    intro: "Here's the refund:",
    table: {
      label: 'Refund for order 1187',
      columns: ['Item', 'Paid', 'Refund'],
      rows: [
        ['Rain Shell Jacket', '$84.96', '$84.96'],
        ['Shipping', '$7.50', '$0.00'],
        ['Restocking fee', '$0.00', '$0.00'],
        ['Total', '$92.46', '$84.96'],
      ],
    },
  },
  {
    title: 'Bills due this week',
    ask: 'Which supplier bills are due this week, and what do we owe in all?',
    worked: 'Worked for 54 s',
    lead: ['Three bills are due by Friday, ', { b: '$1,482.30' }, ' in all.'],
    bullets: [
      'Marlow Supply is due Wednesday and is the largest.',
      'Alder Bay Parts was part paid, so only the rest is counted.',
    ],
    intro: 'Each bill and what is still owed:',
    table: {
      label: 'Bills due this week',
      columns: ['Supplier', 'Due', 'Owed'],
      rows: [
        ['Marlow Supply', 'Wed', '$812.00'],
        ['Alder Bay Parts', 'Thu', '$370.30'],
        ['Ferncliff Fuel', 'Fri', '$300.00'],
        ['Total', '', '$1,482.30'],
      ],
    },
  },
];

const OTHER_CHATS: Record<string, readonly string[]> = {
  'Service desk': ['Close out Tuesday', 'Invoice the Cedar Ave panel repair'],
  'Returns desk': ['Refund the rain shell'],
  'Back office': ['Reorder shop supplies'],
};

const AGENT_OF_JOB = ['Service desk', 'Returns desk', 'Back office'] as const;

/** The sidebar with one job's chat open; every other chat and agent stays where it is. */
export function sidebarFor(open: number): SidebarAgent[] {
  return AGENT_OF_JOB.map((name, agentIndex) => {
    const job = JOBS[agentIndex];
    const others = OTHER_CHATS[name] ?? [];
    return {
      name,
      chats: [
        { title: job?.title ?? name, current: agentIndex === open },
        ...others.map((title, index) => ({
          title,
          needsYou: name === 'Service desk' && index === 1,
        })),
      ],
    };
  });
}
