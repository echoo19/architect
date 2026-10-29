/*
 * A made-up bike repair shop's records as an export writes them, and its policy, for the specs
 * that draft a rule: labor at $65 an hour in half-hour steps, members 10% off labor and never off
 * parts. Hours are sometimes off the half hour, and parts costs sometimes missing or written with
 * a dollar sign, so the rule has something to round, to leave out and to read.
 */

export interface BikeShop {
  customersCsv: string;
  ticketsCsv: string;
  policy: string;
}

export const POLICY = [
  '# Spoke & Chain repair desk',
  '',
  '- Labor is billed at $65 an hour, in half-hour steps.',
  '- Members get 10% off labor, never off parts.',
  '- A ticket is still open while its status is Open, Waiting on parts or Ready. Picked up means the customer has the bike back.',
  '- Parts costs are what the shop paid, before any markup.',
  '',
].join('\n');

/** A small seeded random number generator, so the same shop is made every time. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const STATUSES = ['Open', 'Waiting on parts', 'Ready', 'Picked up'];

export function bikeShop(policy: string = POLICY): BikeShop {
  const next = random(20261029);
  const customers = Array.from({ length: 40 }, (_, i) => ({
    id: `C-${101 + i}`,
    member: i % 3 === 0,
  }));
  const customersCsv = [
    'customer_id,name,email,member',
    ...customers.map((customer, i) =>
      [
        customer.id,
        `Customer ${i}`,
        `customer${i}@example.com`,
        i % 4 === 1 ? (customer.member ? 'YES' : ' No ') : customer.member ? 'yes' : 'no',
      ].join(','),
    ),
  ].join('\n');
  const tickets = Array.from({ length: 160 }, (_, i) => {
    const id = `T-${2001 + i}`;
    const halves = 1 + Math.floor(next() * 10);
    const short = [0, 0.1, 0.25, 0.4][Math.floor(next() * 4)] ?? 0;
    const hours = Math.round((halves / 2 - short) * 100) / 100;
    const missing = next() < 0.25;
    const cents = Math.round(next() * 30_000);
    const parts = missing
      ? i % 2 === 0
        ? 'N/A'
        : ''
      : i % 3 === 1
        ? `$${(cents / 100).toFixed(2)}`
        : (cents / 100).toFixed(2);
    return [
      id,
      customers[Math.floor(next() * customers.length)]?.id ?? 'C-101',
      STATUSES[Math.floor(next() * STATUSES.length)] ?? 'Open',
      i % 7 === 3 ? ` ${hours} ` : String(hours),
      parts,
    ].join(',');
  });
  return {
    customersCsv: `${customersCsv}\n`,
    ticketsCsv: `${['ticket_id,customer_id,status,labor_hours,parts_cost', ...tickets].join('\n')}\n`,
    policy,
  };
}

/** One step of the reply format: every field it asks for, the ones a step doesn't use empty. */
interface Step {
  id: string;
  op: string;
  value: string;
  column: string;
  from: string;
  values: string[];
  mode: string;
  args: string[];
}

function step(id: string, op: string, fields: Partial<Step> = {}): Step {
  return { id, op, value: '', column: '', from: '', values: [], mode: '', args: [], ...fields };
}

/**
 * The policy as the teacher writes it, step by step: hours rounded up to the half hour, times 65,
 * times 0.9 for a member, plus parts, to the cent.
 */
function steps(): Step[] {
  return [
    step('hours', 'col', { column: 'labor_hours', from: 'row' }),
    step('billed', 'round', { value: '0.5', mode: 'up', args: ['hours'] }),
    step('rate', 'num', { value: '65' }),
    step('discount', 'num', { value: '0.9' }),
    step('member_price', 'mul', { args: ['billed', 'rate', 'discount'] }),
    step('price', 'mul', { args: ['billed', 'rate'] }),
    step('is_member', 'equals', { column: 'member', from: 'lookup', value: 'yes' }),
    step('labor', 'if', { args: ['is_member', 'member_price', 'price'] }),
    step('parts', 'col', { column: 'parts_cost', from: 'row' }),
    step('sum', 'add', { args: ['labor', 'parts'] }),
    step('total', 'round', { value: '0.01', mode: 'half_up', args: ['sum'] }),
  ];
}

const NO_TYPE = {
  id: '',
  label: '',
  description: '',
  template: '',
  table: '',
  keyColumn: '',
  columns: [],
  filters: [],
  groupColumn: '',
  measure: '',
  valueColumn: '',
  dateColumn: '',
  dateOrder: '',
  unit: '',
  request: '',
};

export const OPEN_QUESTION = {
  question: 'Does the 10% off for members also apply to the parts?',
  options: ['No, labor only', 'Yes, parts too'],
  changesAnswers: true,
};

/** What the teacher drafts: the ticket's cost as a rule, and a lookup of a customer's email. */
export function bikeDraft(settled: boolean, labor = '$65') {
  return {
    action: 'draft',
    message: '',
    options: [],
    job: {
      name: 'Repair desk',
      summary: "Answers questions about the shop's repair tickets and what they cost.",
      description:
        'Repair desk answers questions about the tickets and customers of a bike repair shop, and works out what a ticket costs under the shop policy.',
      does: ['Works out what a ticket costs', 'Looks up a customer'],
      doesNot: ['Changes any record', 'Gives a discount the policy does not allow'],
      businessDate: '2026-10-29',
      passRate: 0.9,
      files: [
        { name: 'customers.csv', description: 'One row per customer.', access: 'read' },
        { name: 'tickets.csv', description: 'One row per repair ticket.', access: 'read' },
        { name: 'policy.md', description: "The shop's prices and rules.", access: 'read' },
      ],
      unresolved: [],
      taskTypes: [
        {
          ...NO_TYPE,
          id: 'cost',
          label: 'Ticket totals',
          description: 'Work out what a repair ticket costs.',
          template: 'rule',
          table: 'tickets.csv',
          keyColumn: 'ticket_id',
          request: 'What does ticket {key} cost the customer?',
          rule: {
            answerName: 'total',
            currency: 'USD',
            lookupTable: 'customers.csv',
            lookupKey: 'customer_id',
            matchColumn: 'customer_id',
            familyColumn: '',
            categories: [{ column: 'member', from: 'lookup', values: ['yes', 'no'] }],
            sources: [
              {
                file: 'policy.md',
                passage: `Labor is billed at ${labor} an hour, in half-hour steps.`,
              },
              { file: 'policy.md', passage: 'Members get 10% off labor, never off parts.' },
              ...(settled ? [{ file: 'answers', passage: 'No, labor only' }] : []),
            ],
            ambiguities: settled ? [] : [OPEN_QUESTION],
            steps: steps(),
            result: 'total',
          },
        },
        {
          ...NO_TYPE,
          id: 'email',
          label: 'Customer emails',
          description: 'Look up the email of a customer.',
          template: 'lookup',
          table: 'customers.csv',
          keyColumn: 'customer_id',
          columns: ['email'],
          request: 'What is the email of customer {key}?',
        },
      ],
    },
  };
}
