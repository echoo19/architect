import type { RuleNode, RuleSpec } from '@architect/shared';
import { readTable, type Table } from '../../src/drafting/table';
import { seededRandom } from '../../src/splits/random';

/*
 * A made-up bike repair shop's records, as a messy export writes them, with the true values kept
 * beside the text so a test can work an answer out from the truth and compare it with the one
 * Architect worked out from the mess. The policy: labor at $65 an hour in half-hour steps, members
 * 10% off labor and never off parts.
 */

export interface Customer {
  id: string;
  member: boolean;
}

export interface Ticket {
  id: string;
  customerId: string;
  /** The hours the mechanic wrote, which may not be a half hour. */
  hours: number;
  /** Parts at cost in cents, or null where the export has none. */
  partsCents: number | null;
  status: string;
}

export interface Bike {
  customers: Customer[];
  tickets: Ticket[];
  customersCsv: string;
  ticketsCsv: string;
  customerTable: Table;
  ticketTable: Table;
}

const STATUSES = ['Open', 'Waiting on parts', 'Ready', 'Picked up'] as const;

function money(cents: number, style: number): string {
  const text = (cents / 100).toFixed(2);
  return style % 3 === 1
    ? `$${text}`
    : style % 3 === 2
      ? `$${Number(text).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
      : text;
}

/**
 * The truth: what the policy makes a ticket cost, in cents, worked out with whole numbers.
 * `rate` is the percent a member pays of the labor charge.
 */
export function truth(ticket: Ticket, member: boolean, memberPercent = 90): number {
  const halfHours = Math.ceil(ticket.hours * 2 - 1e-9);
  const labor = halfHours * 3250;
  const paid = member ? Math.round((labor * memberPercent) / 100) : labor;
  return paid + (ticket.partsCents ?? 0);
}

export interface BikeOptions {
  customers?: number;
  tickets?: number;
  /** Hours the shop writes: half hours, or any quarter hours so that rounding matters. */
  offGrid?: boolean;
  seed?: string;
}

export function bikeShop(options: BikeOptions = {}): Bike {
  const random = seededRandom(options.seed ?? 'bike');
  const count = options.customers ?? 40;
  const customers: Customer[] = Array.from({ length: count }, (_, i) => ({
    id: `C-${101 + i}`,
    member: i % 3 === 0,
  }));
  const tickets: Ticket[] = Array.from({ length: options.tickets ?? 160 }, (_, i) => {
    const halves = 1 + Math.floor(random() * 10);
    // Off the half hour by a little: the mechanic wrote 1.4 and the shop bills 1.5.
    const short = options.offGrid ? ([0, 0.1, 0.25, 0.4][Math.floor(random() * 4)] ?? 0) : 0;
    const customer = customers[Math.floor(random() * customers.length)] as Customer;
    return {
      id: `T-${2001 + i}`,
      customerId: customer.id,
      hours: Math.round((halves / 2 - short) * 100) / 100,
      partsCents: random() < 0.25 ? null : Math.round(random() * 30_000),
      status: STATUSES[Math.floor(random() * STATUSES.length)] as string,
    };
  });
  const customersCsv = [
    'customer_id,name,email,member',
    ...customers.map((c, i) =>
      [
        c.id,
        `Name ${i}`,
        `name${i}@example.com`,
        i % 4 === 1 ? (c.member ? 'YES' : ' No ') : c.member ? 'yes' : 'no',
      ].join(','),
    ),
  ].join('\n');
  const ticketsCsv = [
    'ticket_id,customer_id,status,labor_hours,parts_cost',
    ...tickets.map((t, i) =>
      [
        t.id,
        t.customerId,
        t.status,
        i % 7 === 3 ? ` ${t.hours} ` : String(t.hours),
        t.partsCents === null ? (i % 2 === 0 ? 'N/A' : '') : money(t.partsCents, i),
      ].join(','),
    ),
  ].join('\n');
  return {
    customers,
    tickets,
    customersCsv: `${customersCsv}\n`,
    ticketsCsv: `${ticketsCsv}\n`,
    customerTable: readTable('customers.csv', `${customersCsv}\n`),
    ticketTable: readTable('tickets.csv', `${ticketsCsv}\n`),
  };
}

export const col = (column: string, from: 'row' | 'lookup' = 'row'): RuleNode => ({
  op: 'col',
  column,
  from,
});
export const num = (value: string): RuleNode => ({ op: 'num', value });

/** Hours rounded up to the half hour. */
export const billedHours: RuleNode = {
  op: 'round',
  arg: col('labor_hours'),
  increment: '0.5',
  mode: 'up',
};

/** The expression of the policy: labor, less a tenth for a member, plus parts, to the cent. */
export function bikeExpression(memberFactor = '0.9'): RuleNode {
  return {
    op: 'round',
    increment: '0.01',
    mode: 'half_up',
    arg: {
      op: 'add',
      args: [
        {
          op: 'if',
          when: { test: 'equals', column: 'member', from: 'lookup', value: 'yes' },
          then: { op: 'mul', args: [billedHours, num('65'), num(memberFactor)] },
          else: { op: 'mul', args: [billedHours, num('65')] },
        },
        col('parts_cost'),
      ],
    },
  };
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

export function bikeRule(overrides: Partial<RuleSpec> = {}): RuleSpec {
  return {
    template: 'rule',
    table: 'tickets.csv',
    keyColumn: 'ticket_id',
    request: 'What does ticket {key} cost the customer?',
    answerName: 'total',
    currency: 'USD',
    lookup: { table: 'customers.csv', keyColumn: 'customer_id', matchColumn: 'customer_id' },
    categories: [{ column: 'member', from: 'lookup', values: ['yes', 'no'] }],
    expression: bikeExpression(),
    sources: [
      { file: 'policy.md', passage: 'Labor is billed at $65 an hour, in half-hour steps.' },
      { file: 'policy.md', passage: 'Members get 10% off labor, never off parts.' },
    ],
    ...overrides,
  };
}

export function bikeTables(bike: Bike): Map<string, Table> {
  return new Map([
    ['tickets.csv', bike.ticketTable],
    ['customers.csv', bike.customerTable],
  ]);
}
