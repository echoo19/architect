import { draft, NO_TYPE } from './drafting-world';

/*
 * What a teacher sends to draft the bike shop's rule: the same expression as `bikeExpression`,
 * written as the reply format asks, in steps that name one another by id.
 */

export interface Step {
  id: string;
  op: string;
  value: string;
  column: string;
  from: string;
  values: string[];
  mode: string;
  args: string[];
}

/** A step with every field the format asks for, the ones an op doesn't use left empty. */
export function step(id: string, op: string, fields: Partial<Step> = {}): Step {
  return { id, op, value: '', column: '', from: '', values: [], mode: '', args: [], ...fields };
}

export interface WireRule {
  answerName: string;
  currency: string;
  lookupTable: string;
  lookupKey: string;
  matchColumn: string;
  familyColumn: string;
  categories: { column: string; from: string; values: string[] }[];
  sources: { file: string; passage: string }[];
  ambiguities: {
    question: string;
    options: string[];
    changesAnswers: boolean;
    /** A question about an empty cell names the column, and Architect gives the answers. */
    blankColumn?: string;
    blankFrom?: string;
  }[];
  steps: Step[];
  result: string;
}

/**
 * The policy as steps: hours rounded up to the half hour, times 65, times 0.9 for a member, plus
 * parts, to the cent.
 */
export function bikeSteps(factor = '0.9'): Step[] {
  return [
    step('hours', 'col', { column: 'labor_hours', from: 'row' }),
    step('billed', 'round', { value: '0.5', mode: 'up', args: ['hours'] }),
    step('rate', 'num', { value: '65' }),
    step('discount', 'num', { value: factor }),
    step('member_price', 'mul', { args: ['billed', 'rate', 'discount'] }),
    step('price', 'mul', { args: ['billed', 'rate'] }),
    step('is_member', 'equals', { column: 'member', from: 'lookup', value: 'yes' }),
    step('labor', 'if', { args: ['is_member', 'member_price', 'price'] }),
    step('parts', 'col', { column: 'parts_cost', from: 'row' }),
    step('sum', 'add', { args: ['labor', 'parts'] }),
    step('total', 'round', { value: '0.01', mode: 'half_up', args: ['sum'] }),
  ];
}

export function wireRule(overrides: Partial<WireRule> = {}): WireRule {
  return {
    answerName: 'total',
    currency: 'USD',
    lookupTable: 'customers.csv',
    lookupKey: 'customer_id',
    matchColumn: 'customer_id',
    familyColumn: '',
    categories: [{ column: 'member', from: 'lookup', values: ['yes', 'no'] }],
    sources: [
      { file: 'policy.md', passage: 'Labor is billed at $65 an hour, in half-hour steps.' },
      { file: 'policy.md', passage: 'Members get 10% off labor, never off parts.' },
    ],
    ambiguities: [],
    steps: bikeSteps(),
    result: 'total',
    ...overrides,
  };
}

/** The tickets' cost as a task type of the reply. */
export function costType(rule: Partial<WireRule> = {}, overrides: object = {}) {
  return {
    ...NO_TYPE,
    id: 'cost',
    label: 'Ticket totals',
    description: 'Work out what a repair ticket costs.',
    template: 'rule' as const,
    table: 'tickets.csv',
    keyColumn: 'ticket_id',
    request: 'What does ticket {key} cost the customer?',
    rule: wireRule(rule),
    ...overrides,
  };
}

/** A lookup of customers' emails, which the bike shop's customers support 40 times. */
export const CONTACT_TYPE = {
  ...NO_TYPE,
  id: 'email',
  label: 'Customer emails',
  description: 'Look up the email of a customer.',
  template: 'lookup' as const,
  table: 'customers.csv',
  keyColumn: 'customer_id',
  columns: ['email'],
  request: 'What is the email of customer {key}?',
};

/** A draft of the repair desk with the rule and a lookup. */
export function bikeDraft(types: object[] = [costType(), CONTACT_TYPE], unresolved: string[] = []) {
  return draft({
    name: 'Repair desk',
    summary: "Answers questions about the shop's repair tickets.",
    description:
      'Repair desk answers questions about the tickets and customers of a bike repair shop and what a ticket costs under its policy.',
    does: ['Works out what a ticket costs', 'Looks up a customer'],
    doesNot: ['Changes any record'],
    businessDate: '2026-10-29',
    files: [
      { name: 'customers.csv', description: 'One row per customer.', access: 'read' },
      { name: 'tickets.csv', description: 'One row per repair ticket.', access: 'read' },
      { name: 'policy.md', description: "The shop's prices and rules.", access: 'read' },
    ],
    unresolved,
    taskTypes: types,
  });
}
