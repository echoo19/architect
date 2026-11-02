/*
 * What the scripted teacher of a drafting session says, for the shop whose records `shop.ts`
 * makes: a question first, then a job with three kinds of request, and a whole-harness draft for
 * each training round after.
 */

/** How a person describes the shop's job. */
export const DESCRIPTION =
  'Answer questions about the orders and customers of our small online shop: who a customer is, ' +
  'which of their orders are still pending, and what a region ordered in a stretch of time.';

export const EMPTY_JOB = {
  name: '',
  summary: '',
  description: '',
  does: [],
  doesNot: [],
  businessDate: '',
  passRate: 0,
  files: [],
  unresolved: [],
  taskTypes: [],
};

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

/** What the teacher drafts: three kinds of request, one for each template Architect has. */
export function draftReply(unresolved: string[]) {
  return {
    action: 'draft',
    message: '',
    options: [],
    job: {
      name: 'Shop desk',
      summary: "Answers questions about the shop's customers and orders.",
      description:
        'Shop desk answers questions about the orders and customers of a small online shop, from its exported records.',
      does: [
        'Looks up what the records say about a customer',
        "Lists a customer's pending orders",
        'Adds up what a region ordered between two dates',
      ],
      doesNot: ['Changes any record', 'Answers from anything but the records'],
      businessDate: '2026-11-24',
      passRate: 0.9,
      files: [
        { name: 'customers.csv', description: 'One row per customer.', access: 'read' },
        { name: 'orders.csv', description: 'One row per order.', access: 'read' },
        { name: 'policy.md', description: "The shop's rules.", access: 'read' },
      ],
      unresolved,
      taskTypes: [
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
        {
          ...NO_TYPE,
          id: 'pending',
          label: 'Pending orders',
          description: 'List the pending orders of a customer.',
          template: 'filtered_list',
          table: 'orders.csv',
          keyColumn: 'order_id',
          filters: [
            { column: 'status', op: 'equals', value: 'Pending', varies: false },
            { column: 'customer_id', op: 'equals', value: '', varies: true },
          ],
          request: 'Which orders of customer {customer_id} are still pending?',
        },
        {
          ...NO_TYPE,
          id: 'totals',
          label: 'Region totals',
          description: 'Add up the orders of a region between two dates.',
          template: 'group_total',
          table: 'orders.csv',
          groupColumn: 'region',
          measure: 'sum',
          valueColumn: 'amount',
          dateColumn: 'order_date',
          unit: 'as_written',
          request: 'What is the total of orders in the {group} region from {from} to {to}?',
        },
      ],
    },
  };
}

/** The teacher's first turn: one question, with two answers to pick from. */
export const ASK = {
  action: 'ask',
  message: 'Should cancelled orders count in what a region ordered?',
  options: ['Yes, count them', 'No, leave them out'],
  job: EMPTY_JOB,
};

/** A training round's reply: a plain whole-harness draft, so training has something to measure. */
export const ROUND_DRAFT = {
  title: 'Answer from the records',
  diagnosis: 'A first setup that reads the records before it answers.',
  causeTaskIds: [],
  edits: [{ op: 'write', path: 'AGENTS.md', content: 'Read the records, then answer.' }],
  predicted: { devDeltaMin: 0, devDeltaMax: 1, rationale: 'A first draft.' },
  readyClaim: false,
};
