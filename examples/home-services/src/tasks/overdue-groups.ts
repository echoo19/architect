import type { AnswerCompare, JsonValue, Task } from '@architect/shared';
import { CITIES, ZONES } from '../company/catalog';
import { customerCells } from '../company/tables';
import type { CompanyRecords, Invoice, Payment } from '../company/types';
import { groupBy } from '../lib/group-by';
import { dollars } from '../lib/money';
import type { Random } from '../lib/random';
import { BUSINESS_DATE } from '../policy/rules';
import { overdueBalances } from '../reference/balances';
import { answerByReading } from '../reference/overdue-reads';
import { answerQuestion, inGroup } from '../reference/overdue-questions';
import type { GroupColumns, OverdueQuestion } from '../reference/overdue-questions';
import { ReadTools } from '../reference/read-tools';
import type { JobData } from '../reference/read-tools';
import { mistakesThatMatter } from './overdue-mistakes';
import type { Covered } from './overdue-mistakes';
import { TODAY, withAnswerLine } from './prompts';
import { AnswerCap, difficultyOf, pickMix } from './select';
import type { Candidate, Quota } from './select';

/**
 * Overdue questions about a group of customers (version 2): the group's overdue total, its three
 * largest balances, which of its customers are more than N days overdue, and who owes more than
 * an amount. A group is a city, or a zone or a city narrowed to plan members or to one payment
 * term, and each group is asked about once, so each task is its own family.
 */

type GroupQuestion = Extract<OverdueQuestion, { group: GroupColumns }>;
type GroupKind = GroupQuestion['kind'];

interface CustomerGroup {
  /** Names the group in its task's family, e.g. `zone=Ridge;terms_days=15`. */
  key: string;
  /** How a request names the group, e.g. `customers in the Ridge zone on 15-day terms`. */
  label: string;
  /** Which kind of group it is, so picks spread across zones, cities, plans and terms. */
  shape: string;
  columns: GroupColumns;
  covered: Covered;
}

interface GroupCase {
  group: CustomerGroup;
  question: GroupQuestion;
  answer: JsonValue;
}

/**
 * Kinds are picked scarcest first: a top three needs four customers who owe different amounts.
 * Nearly every top three is hard (a long read and an order to get right), and few age questions
 * are, since only old invoices matter to them.
 */
const QUOTAS: Readonly<Record<GroupKind, Quota>> = {
  group_top: { easy: 0, medium: 2, hard: 5 },
  group_owing: { easy: 0, medium: 3, hard: 4 },
  group_age: { easy: 0, medium: 5, hard: 3 },
  group_total: { easy: 1, medium: 4, hard: 3 },
};

const TERMS = [0, 15, 30, 45];
const AGE_DAYS = [30, 45, 60];
const OWING_CENTS = [25_000, 50_000, 100_000];

/**
 * Groups small enough to answer in a handful of reads that fit the agent's context, and big
 * enough to need adding up. Whole zones are left out: each has 180 to 300 past-due invoices.
 */
const MIN_MEMBERS = 5;
const MAX_MEMBERS = 60;
const MAX_PAST_DUE = 180;
/** Lists of customers stay short enough to read and type back. */
const MAX_LISTED = 8;

const COMPARE: Readonly<Record<GroupKind, AnswerCompare>> = {
  group_total: { mode: 'exact' },
  group_top: { mode: 'exact' },
  group_age: { mode: 'exact', setKeys: ['customer_ids'] },
  group_owing: { mode: 'exact' },
};

const CUSTOMER_LIST_SHAPE =
  '{"customers": [{"customer_id": "<id>", "overdue_cents": <integer>}, ...]}';
const SHAPES: Readonly<Record<GroupKind, string>> = {
  group_total: '{"overdue_cents": <integer>}',
  group_top: CUSTOMER_LIST_SHAPE,
  group_age: '{"count": <integer>, "customer_ids": ["<id>", ...]}',
  group_owing: CUSTOMER_LIST_SHAPE,
};

type Prompt<Q extends GroupQuestion> = (label: string, question: Q) => string;
type Prompts = { [K in GroupKind]: readonly Prompt<Extract<GroupQuestion, { kind: K }>>[] };

const PROMPTS: Prompts = {
  group_total: [
    (label) => `Today is ${TODAY}. What is the total overdue balance of the ${label}?`,
    (label) =>
      `It's ${TODAY}. Add up what the ${label} owe on overdue invoices. What is the total?`,
  ],
  group_top: [
    (label) =>
      `Today is ${TODAY}. Which three ${label} have the largest overdue balances? ` +
      "Give each one's overdue balance, largest first.",
    (label) =>
      `It's ${TODAY}. I'll call the three ${label} who owe the most on overdue invoices first. ` +
      'Who are they, and how much does each owe? Largest first.',
  ],
  group_age: [
    (label, q) =>
      `Today is ${TODAY}. How many ${label} have an invoice more than ${q.days} days overdue? ` +
      'List them too.',
    (label, q) =>
      `It's ${TODAY}. Which ${label} are more than ${q.days} days overdue on at least one ` +
      'invoice, and how many are there?',
  ],
  group_owing: [
    (label, q) =>
      `Today is ${TODAY}. Which ${label} owe more than ${wholeDollars(q.over_cents)} in ` +
      'overdue balances? List each with their overdue balance, largest first.',
    (label, q) =>
      `It's ${TODAY}. Find the ${label} whose overdue balance is above ` +
      `${wholeDollars(q.over_cents)}, and give each balance, largest first.`,
  ],
};

/** Each group question has an answer no other one has. */
export function buildGroupTasks(
  random: Random,
  records: CompanyRecords,
  data: JobData,
): Omit<Task, 'id'>[] {
  const groups = customerGroups(records);
  const cap = new AnswerCap(1);
  const used = new Set<string>();
  const kinds: readonly GroupKind[] = ['group_top', 'group_owing', 'group_age', 'group_total'];
  return kinds.flatMap((kind) => {
    const candidates = groups
      .filter((group) => !used.has(group.key))
      .flatMap((group) => candidatesFor(random, group, kind, data));
    const picked = pickMix(random, candidates, QUOTAS[kind], kind, cap);
    for (const { value } of picked) used.add(value.group.key);
    return picked.map((candidate) => groupTask(random, candidate));
  });
}

type GroupDefinition = Pick<CustomerGroup, 'label' | 'shape' | 'columns'>;

function customerGroups(records: CompanyRecords): CustomerGroup[] {
  const define = (label: string, shape: string, columns: GroupColumns): GroupDefinition => ({
    label,
    shape,
    columns,
  });
  const definitions = [
    ...ZONES.flatMap((zone) => [
      define(`plan members in the ${zone} zone`, 'zone plan', { zone, plan_member: 'yes' }),
      ...TERMS.map((terms) =>
        define(`customers in the ${zone} zone on ${terms}-day terms`, 'zone terms', {
          zone,
          terms_days: String(terms),
        }),
      ),
    ]),
    ...CITIES.flatMap(({ name: city }) => [
      define(`customers in the city of ${city}`, 'city', { city }),
      define(`plan members in the city of ${city}`, 'city plan', { city, plan_member: 'yes' }),
      ...TERMS.map((terms) =>
        define(`customers in the city of ${city} on ${terms}-day terms`, 'city terms', {
          city,
          terms_days: String(terms),
        }),
      ),
    ]),
  ];

  const invoicesOf = groupBy(records.invoices, (invoice) => invoice.customer_id);
  const paymentsOf = groupBy(records.payments, (payment) => payment.invoice_id);
  // Two names for the same customers (when a zone's plan members all live in one of its cities)
  // would be one question asked twice, so only the first name is kept.
  const memberSets = new Set<string>();
  return definitions.flatMap((definition) => {
    const members = records.customers.filter((c) => inGroup(customerCells(c), definition.columns));
    const invoices: Invoice[] = members.flatMap((c) => invoicesOf.get(c.customer_id) ?? []);
    const payments: Payment[] = invoices.flatMap((i) => paymentsOf.get(i.invoice_id) ?? []);
    const pastDue = invoices.filter((invoice) => invoice.due_date < BUSINESS_DATE).length;
    if (members.length < MIN_MEMBERS || members.length > MAX_MEMBERS) return [];
    if (pastDue > MAX_PAST_DUE) return [];
    const memberSet = members.map((c) => c.customer_id).join(' ');
    if (memberSets.has(memberSet)) return [];
    memberSets.add(memberSet);
    const key = Object.entries(definition.columns)
      .map(([column, value]) => `${column}=${value}`)
      .join(';');
    return [{ ...definition, key, covered: { invoices, payments } }];
  });
}

/** The question of this kind worth asking about the group, if there is one, as a candidate. */
function candidatesFor(
  random: Random,
  group: CustomerGroup,
  kind: GroupKind,
  data: JobData,
): Candidate<GroupCase>[] {
  const question = questionFor(random, group, kind);
  if (!question) return [];
  const answer = answerOf(question, group.covered);
  const traps = groupTraps(group, question, answer, data);
  return [
    {
      value: { group, question, answer },
      traps,
      kind: group.shape,
      answer: JSON.stringify(answer),
    },
  ];
}

function questionFor(random: Random, group: CustomerGroup, kind: GroupKind): GroupQuestion | null {
  const columns = group.columns;
  const balances = overdueBalances(group.covered.invoices, group.covered.payments, BUSINESS_DATE);
  switch (kind) {
    case 'group_total':
      return balances.length > 0 ? { kind, group: columns } : null;
    case 'group_top': {
      // Four distinct balances, so the top three and their order are unambiguous.
      const top = balances.slice(0, 4).map((balance) => balance.overdue_cents);
      const distinct =
        top.length === 4 && top.every((cents, i) => i === 0 || (top[i - 1] as number) > cents);
      return distinct ? { kind, group: columns, count: 3 } : null;
    }
    case 'group_age': {
      const options = AGE_DAYS.map((days) => ({ kind, group: columns, days })).filter((q) => {
        const { count } = answerOf(q, group.covered) as { count: number };
        return count >= 1 && count <= MAX_LISTED;
      });
      // Prefer a cutoff where an invoice sits exactly on it, which tests "more than".
      const onBoundary = options.filter((q) => dayBoundaryMatters(q, group.covered));
      const choices = onBoundary.length > 0 ? onBoundary : options;
      return choices.length > 0 ? random.pick(choices) : null;
    }
    case 'group_owing': {
      const options = OWING_CENTS.map((over_cents) => ({
        kind,
        group: columns,
        over_cents,
      })).filter((q) => {
        const owing = balances.filter((balance) => balance.overdue_cents > q.over_cents);
        const amounts = new Set(owing.map((balance) => balance.overdue_cents));
        return owing.length >= 1 && owing.length <= MAX_LISTED && amounts.size === owing.length;
      });
      return options.length > 0 ? random.pick(options) : null;
    }
  }
}

/**
 * What a careless answer gets wrong here: reading only the first page of a long result, a
 * misread of today's date or of part payments, listing customers out of order, or, for how long
 * customers have been overdue, going by due dates without checking what was paid and counting an
 * invoice exactly N days overdue as more than N.
 */
function groupTraps(
  group: CustomerGroup,
  question: GroupQuestion,
  answer: JsonValue,
  data: JobData,
): string[] {
  const lazy = answerByReading(new ReadTools(data), question, BUSINESS_DATE, 'lazy');
  const listed = (answer as { customers?: unknown[] }).customers ?? [];
  const age = question.kind === 'group_age';
  return [
    ...(JSON.stringify(lazy) === JSON.stringify(answer) ? [] : ['paging']),
    ...mistakesThatMatter(question, group.covered, [
      'scheduled_payment',
      'paid_tomorrow',
      'paid_today',
      'due_today',
      'due_yesterday',
      'partial_payment',
      ...(age ? (['paid_in_full'] as const) : []),
    ]),
    ...(age && dayBoundaryMatters(question, group.covered) ? ['day_boundary'] : []),
    ...(listed.length >= 2 ? ['largest_first'] : []),
  ];
}

/** Whether counting an invoice exactly N days overdue as more than N would change the answer. */
function dayBoundaryMatters(
  question: Extract<GroupQuestion, { kind: 'group_age' }>,
  covered: Covered,
): boolean {
  const atLeast = answerOf({ ...question, days: question.days - 1 }, covered);
  return JSON.stringify(atLeast) !== JSON.stringify(answerOf(question, covered));
}

function answerOf(question: OverdueQuestion, covered: Covered): JsonValue {
  return answerQuestion(question, covered.invoices, covered.payments, BUSINESS_DATE);
}

function groupTask(random: Random, { value, traps }: Candidate<GroupCase>): Omit<Task, 'id'> {
  const { group, question, answer } = value;
  return {
    type: 'overdue',
    family: `group:${group.key}`,
    prompt: withAnswerLine(promptFor(random, group.label, question), SHAPES[question.kind]),
    expected: { kind: 'answer', value: answer, compare: COMPARE[question.kind] },
    meta: {
      summary: summaryOf(answer),
      difficulty: difficultyOf(traps),
      traps,
      question,
    },
  };
}

function promptFor(random: Random, label: string, question: GroupQuestion): string {
  switch (question.kind) {
    case 'group_total':
      return random.pick(PROMPTS.group_total)(label, question);
    case 'group_top':
      return random.pick(PROMPTS.group_top)(label, question);
    case 'group_age':
      return random.pick(PROMPTS.group_age)(label, question);
    case 'group_owing':
      return random.pick(PROMPTS.group_owing)(label, question);
  }
}

function summaryOf(answer: JsonValue): string {
  const { overdue_cents, customers, customer_ids } = answer as {
    overdue_cents?: number;
    customers?: { customer_id: string; overdue_cents: number }[];
    customer_ids?: string[];
  };
  if (overdue_cents !== undefined) return `${dollars(overdue_cents)} overdue`;
  if (customers)
    return customers.map((c) => `${c.customer_id} ${dollars(c.overdue_cents)}`).join(', ');
  const ids = customer_ids ?? [];
  return `${ids.length} ${ids.length === 1 ? 'customer' : 'customers'}: ${ids.join(', ')}`;
}

/** "$500", "$1,000" */
function wholeDollars(cents: number): string {
  return dollars(cents).replace(/\.00$/, '');
}
