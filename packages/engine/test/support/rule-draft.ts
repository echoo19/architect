import { draft, NO_TYPE } from './drafting-world';

/*
 * What a teacher sends to draft the bike shop's rule: the same expression as `bikeExpression`,
 * written in the uniform steps of the reply format.
 */

export interface Step {
  op: string;
  value: string;
  column: string;
  from: string;
  values: string[];
  mode: string;
  args: Step[];
}

/** A step with every field the format asks for, the ones an op doesn't use left empty. */
export function step(op: string, fields: Partial<Step> = {}): Step {
  return { op, value: '', column: '', from: '', values: [], mode: '', args: [], ...fields };
}

export const wireNum = (value: string): Step => step('num', { value });
export const wireCol = (column: string, from = 'row'): Step => step('col', { column, from });

/** Hours rounded up to the half hour. */
export const WIRE_HOURS = step('round', {
  value: '0.5',
  mode: 'up',
  args: [wireCol('labor_hours')],
});

/** The policy as the format carries it: labor, less a tenth for a member, plus parts, to the cent. */
export function wireBike(factor = '0.9'): Step {
  return step('round', {
    value: '0.01',
    mode: 'half_up',
    args: [
      step('add', {
        args: [
          step('if', {
            args: [
              step('equals', { column: 'member', from: 'lookup', value: 'yes' }),
              step('mul', { args: [WIRE_HOURS, wireNum('65'), wireNum(factor)] }),
              step('mul', { args: [WIRE_HOURS, wireNum('65')] }),
            ],
          }),
          wireCol('parts_cost'),
        ],
      }),
    ],
  });
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
  ambiguities: { question: string; options: string[]; changesAnswers: boolean }[];
  expression: Step;
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
    expression: wireBike(),
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
