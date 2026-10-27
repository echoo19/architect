import type { JsonValue, Task } from '@architect/shared';
import type { CompanyRecords, Customer, Invoice, Payment } from '../company/types';
import { addDays, datesFrom, weekdayOf } from '../lib/calendar';
import { compareText } from '../lib/compare';
import { dollars, sum } from '../lib/money';
import type { Random } from '../lib/random';
import { BUSINESS_DATE } from '../policy/rules';
import { balanceCents, overdueInvoices, receivedCents } from '../reference/balances';
import type { OverdueInvoice } from '../reference/balances';
import { answerQuestion } from '../reference/overdue-questions';
import type { OverdueQuestion } from '../reference/overdue-questions';
import type { JobData } from '../reference/read-tools';
import type { JobVersion } from '../versions';
import { buildGroupTasks } from './overdue-groups';
import { mistakesThatMatter } from './overdue-mistakes';
import type { Covered } from './overdue-mistakes';
import { TODAY, withAnswerLine } from './prompts';
import { AnswerCap, difficultyOf, pickMix, pickMixWith, taskId } from './select';
import type { Candidate, Quota } from './select';

/**
 * Overdue questions come in four kinds about one customer or a few invoices: one customer's
 * overdue invoices, one customer's oldest overdue invoice, a call list of four customers, and the
 * invoices due in a three-day window. Every customer appears in at most one of these, so each
 * task is its own family. Version 2 asks half as many and fills the other half with questions
 * about groups of customers (overdue-groups.ts).
 */

type SingleKind = 'oldest' | 'balance' | 'callList' | 'window';

const QUOTAS: Readonly<Record<JobVersion, Readonly<Record<SingleKind, Quota>>>> = {
  1: {
    oldest: { easy: 3, medium: 9, hard: 3 },
    balance: { easy: 8, medium: 8, hard: 4 },
    callList: { easy: 4, medium: 6, hard: 3 },
    window: { easy: 4, medium: 5, hard: 3 },
  },
  2: {
    oldest: { easy: 1, medium: 3, hard: 3 },
    balance: { easy: 4, medium: 2, hard: 3 },
    callList: { easy: 2, medium: 2, hard: 3 },
    window: { easy: 1, medium: 3, hard: 3 },
  },
};

/** In version 2, no answer is right for more than three overdue tasks. */
const MAX_TASKS_PER_ANSWER = 3;

const LIST_SHAPE = '{"invoice_ids": ["<id>", ...], "overdue_cents": <integer>}';
const OLDEST_SHAPE =
  '{"invoice_id": "<id>", "balance_cents": <integer>, "days_overdue": <integer>}';
const CALL_LIST_SHAPE = '{"customers": [{"customer_id": "<id>", "overdue_cents": <integer>}, ...]}';

const CALL_LIST_SIZE = 4;
/**
 * Due-date windows last three days and start on the Tuesdays and Fridays between these dates,
 * so the last one runs up to the business date.
 */
const FIRST_WINDOW = '2026-07-07';
const LAST_WINDOW = BUSINESS_DATE;
const WINDOW_DAYS = 3;
/** Counting this many days back crosses at least three month ends. */
const LONG_OVERDUE_DAYS = 90;

interface Account {
  customer: Customer;
  overdue: OverdueInvoice[];
  overdueCents: number;
  /** Account traps, see `accountTraps`. */
  traps: string[];
  covered: Covered;
}

type TaskDraft = Omit<Task, 'id'>;

/** The question each kind asks, as the reference solutions and the tests read it. */
const questionOf = {
  balance: (account: Account): OverdueQuestion => ({
    kind: 'customer_balance',
    customer_id: account.customer.customer_id,
  }),
  oldest: (account: Account): OverdueQuestion => ({
    kind: 'oldest_invoice',
    customer_id: account.customer.customer_id,
  }),
  callList: (members: readonly Account[]): OverdueQuestion => ({
    kind: 'call_list',
    customer_ids: members.map((member) => member.customer.customer_id),
  }),
  window: (window: DueWindow): OverdueQuestion => ({
    kind: 'due_window',
    from: window.from,
    to: window.to,
  }),
};

/** `data` is the job's data files as the agent reads them; version 2 uses them for its groups. */
export function buildOverdueTasks(
  random: Random,
  records: CompanyRecords,
  version: JobVersion,
  data: JobData,
): Task[] {
  const quotas = QUOTAS[version];
  const cap = new AnswerCap(MAX_TASKS_PER_ANSWER);
  const paymentsOf = paymentsByInvoice(records.payments);
  const accounts = records.customers
    .map((customer) => accountOf(records, paymentsOf, customer))
    .filter((account) => account !== null);
  const used = new Set<string>();

  // Customers with two or more overdue invoices are the scarcest, so they are picked first.
  const oldest = pickMix(
    random,
    accounts
      .filter(hasClearOldest)
      .map((account) =>
        withBoundaries(
          version,
          accountCandidate(account, oldestTraps(records, account)),
          questionOf.oldest(account),
          account.covered,
        ),
      ),
    quotas.oldest,
    'oldest overdue',
    cap,
  );
  oldest.forEach(({ value }) => used.add(value.customer.customer_id));

  const balance = pickMix(
    random,
    accounts
      .filter((account) => !used.has(account.customer.customer_id) && isBalanceQuestion(account))
      .map((account) =>
        withBoundaries(
          version,
          accountCandidate(account, account.traps),
          questionOf.balance(account),
          account.covered,
        ),
      ),
    quotas.balance,
    'overdue balance',
    cap,
  );
  balance.forEach(({ value }) => used.add(value.customer.customer_id));

  const callLists = pickMix(
    random,
    callListCandidates(
      random,
      accounts.filter((account) => !used.has(account.customer.customer_id)),
    ).map((candidate) =>
      withBoundaries(
        version,
        candidate,
        questionOf.callList(candidate.value),
        coveredBy(candidate.value),
      ),
    ),
    quotas.callList,
    'call list',
    cap,
  );

  const windowChoices = windowCandidates(records, paymentsOf).map((candidate) =>
    withBoundaries(version, candidate, questionOf.window(candidate.value), candidate.value.covered),
  );
  // Version 2 always asks about a window holding both sides of today's boundaries.
  const both = (a: string, b: string) => (c: Candidate<DueWindow>) =>
    c.traps.includes(a) && c.traps.includes(b);
  const windows =
    version === 1
      ? pickMix(random, windowChoices, quotas.window, 'due window', cap)
      : pickMixWith(
          random,
          windowChoices,
          quotas.window,
          'due window',
          [both('due_today', 'due_yesterday'), both('paid_today', 'paid_tomorrow')],
          cap,
        );

  const drafts: TaskDraft[] = [
    ...oldest.map((c) => oldestTask(random, c, version)),
    ...balance.map((c) => balanceTask(random, c, version)),
    ...callLists.map((c) => callListTask(random, c, version)),
    ...windows.map((c) => windowTask(random, c, version)),
    ...(version === 1 ? [] : buildGroupTasks(random.fork('groups'), records, data)),
  ];
  return drafts.map((draft, index) => ({ id: taskId('overdue', index), ...draft }));
}

/**
 * What version 2 adds to a question about one customer or a few invoices: whether a payment dated
 * today or tomorrow, or an invoice due yesterday, moves the answer; and the answer itself, so no
 * answer is right for more than three tasks. Version 1 keeps the candidate as it was.
 */
function withBoundaries<T>(
  version: JobVersion,
  candidate: Candidate<T>,
  question: OverdueQuestion,
  covered: Covered,
): Candidate<T> {
  if (version === 1) return candidate;
  const boundaries = mistakesThatMatter(question, covered, [
    'paid_tomorrow',
    'paid_today',
    'due_yesterday',
  ]);
  const answer = answerQuestion(question, covered.invoices, covered.payments, BUSINESS_DATE);
  return {
    ...candidate,
    traps: [...candidate.traps, ...boundaries],
    answer: JSON.stringify(answer),
  };
}

/** Version 2 records each task's question, for the reference solutions and the tests. */
function questionMeta(version: JobVersion, question: OverdueQuestion): Record<string, JsonValue> {
  return version === 1 ? {} : { question };
}

function paymentsByInvoice(payments: readonly Payment[]): Map<string, Payment[]> {
  const byInvoice = new Map<string, Payment[]>();
  for (const payment of payments) {
    const list = byInvoice.get(payment.invoice_id);
    if (list) list.push(payment);
    else byInvoice.set(payment.invoice_id, [payment]);
  }
  return byInvoice;
}

function coveredBy(members: readonly Account[]): Covered {
  return {
    invoices: members.flatMap((member) => member.covered.invoices),
    payments: members.flatMap((member) => member.covered.payments),
  };
}

function accountOf(
  records: CompanyRecords,
  paymentsOf: ReadonlyMap<string, Payment[]>,
  customer: Customer,
): Account | null {
  const invoices = records.invoices.filter(
    (invoice) => invoice.customer_id === customer.customer_id,
  );
  if (invoices.length === 0) return null;
  const overdue = overdueInvoices(invoices, records.payments, BUSINESS_DATE);
  return {
    customer,
    overdue,
    overdueCents: sum(overdue.map((invoice) => invoice.balance_cents)),
    traps: accountTraps(invoices, records.payments, overdue),
    covered: {
      invoices,
      payments: invoices.flatMap((invoice) => paymentsOf.get(invoice.invoice_id) ?? []),
    },
  };
}

/** What makes a customer's overdue total easy to get wrong. */
function accountTraps(
  invoices: readonly Invoice[],
  payments: readonly Payment[],
  overdue: readonly OverdueInvoice[],
): string[] {
  return [
    ...(overdue.length === 0 ? ['nothing_overdue'] : []),
    ...(overdue.length >= 2 ? ['several_invoices'] : []),
    ...balanceTraps(invoices, payments, overdue),
  ];
}

/**
 * The payments and dates in a set of invoices that trip up an overdue count: overdue invoices
 * with part paid or with a payment only scheduled, and open invoices that are due today or later.
 */
function balanceTraps(
  invoices: readonly Invoice[],
  payments: readonly Payment[],
  overdue: readonly OverdueInvoice[],
): string[] {
  const overdueIds = new Set(overdue.map((invoice) => invoice.invoice_id));
  const isOverdue = (invoice: Invoice) => overdueIds.has(invoice.invoice_id);
  const isOpen = (invoice: Invoice) => balanceCents(invoice, payments, BUSINESS_DATE) > 0;
  const traps: string[] = [];
  if (invoices.some((i) => isOverdue(i) && receivedCents(i, payments, BUSINESS_DATE) > 0)) {
    traps.push('partial_payment');
  }
  if (invoices.some((i) => isOverdue(i) && hasScheduledPayment(i, payments))) {
    traps.push('scheduled_payment');
  }
  if (invoices.some((i) => i.due_date === BUSINESS_DATE && isOpen(i))) traps.push('due_today');
  if (invoices.some((i) => i.due_date > BUSINESS_DATE && isOpen(i))) traps.push('not_yet_due');
  return traps;
}

function hasScheduledPayment(invoice: Invoice, payments: readonly Payment[]): boolean {
  return payments.some((p) => p.invoice_id === invoice.invoice_id && p.date > BUSINESS_DATE);
}

/** A customer is worth asking about when something is overdue or something only looks overdue. */
function isBalanceQuestion(account: Account): boolean {
  return account.overdue.length > 0 || account.traps.length > 1;
}

function hasClearOldest(account: Account): boolean {
  const [first, second] = account.overdue;
  return first !== undefined && second !== undefined && first.due_date < second.due_date;
}

/** What makes the oldest overdue invoice easy to get wrong. */
function oldestTraps(records: CompanyRecords, account: Account): string[] {
  const oldest = account.overdue[0];
  if (!oldest) return [];
  const invoice = records.invoices.find((i) => i.invoice_id === oldest.invoice_id);
  if (!invoice) throw new Error(`Missing invoice ${oldest.invoice_id}`);
  const traps: string[] = [];
  if (oldest.balance_cents < invoice.total_cents) traps.push('partial_payment');
  if (hasScheduledPayment(invoice, records.payments)) traps.push('scheduled_payment');
  const olderPaid = records.invoices.some(
    (i) => i.customer_id === account.customer.customer_id && i.due_date < oldest.due_date,
  );
  if (olderPaid) traps.push('older_paid_invoice');
  if (oldest.days_overdue > LONG_OVERDUE_DAYS) traps.push('long_overdue');
  return traps;
}

function accountCandidate(account: Account, traps: string[]): Candidate<Account> {
  return { value: account, traps, kind: traps.join('+') };
}

function balanceTask(
  random: Random,
  { value: account, traps }: Candidate<Account>,
  version: JobVersion,
): TaskDraft {
  const { customer_id, name } = account.customer;
  const prompts = [
    `Today is ${TODAY}. ${name} (${customer_id}) called about their account. Which of their ` +
      'invoices are overdue, and what is their total overdue balance?',
    `It's ${TODAY}. Before I call ${name} (${customer_id}), list their overdue invoices and the ` +
      'total they owe on them.',
    `Today is ${TODAY}. Does customer ${customer_id} (${name}) have anything overdue? Give the ` +
      'overdue invoice ids and the overdue balance.',
  ];
  const request = `${random.pick(prompts)} If nothing is overdue, answer with an empty list and 0.`;
  return {
    type: 'overdue',
    family: `customer:${customer_id}`,
    prompt: withAnswerLine(request, LIST_SHAPE),
    expected: {
      kind: 'answer',
      value: {
        invoice_ids: account.overdue.map((invoice) => invoice.invoice_id),
        overdue_cents: account.overdueCents,
      },
      compare: { mode: 'exact', setKeys: ['invoice_ids'] },
    },
    meta: {
      summary:
        account.overdue.length === 0
          ? 'Nothing overdue'
          : `${account.overdue.length} overdue, ${dollars(account.overdueCents)}`,
      difficulty: difficultyOf(traps),
      traps,
      ...questionMeta(version, questionOf.balance(account)),
    },
  };
}

function oldestTask(
  random: Random,
  { value: account, traps }: Candidate<Account>,
  version: JobVersion,
): TaskDraft {
  const { customer_id, name } = account.customer;
  const oldest = account.overdue[0];
  if (!oldest) throw new Error(`${customer_id} has nothing overdue`);
  const prompts = [
    `Today is ${TODAY}. For ${name} (${customer_id}), which overdue invoice has the earliest due ` +
      'date? Tell me how much is still open on it and how many days overdue it is.',
    `It's ${TODAY}. I want to chase the oldest overdue invoice of ${name} (${customer_id}) ` +
      'first. Which one is it, what is its open balance, and how many days past due is it?',
  ];
  return {
    type: 'overdue',
    family: `customer:${customer_id}`,
    prompt: withAnswerLine(random.pick(prompts), OLDEST_SHAPE),
    expected: {
      kind: 'answer',
      value: {
        invoice_id: oldest.invoice_id,
        balance_cents: oldest.balance_cents,
        days_overdue: oldest.days_overdue,
      },
      compare: { mode: 'exact' },
    },
    meta: {
      summary: `${oldest.invoice_id}, ${dollars(oldest.balance_cents)} open, ${oldest.days_overdue} days overdue`,
      difficulty: difficultyOf(traps),
      traps,
      ...questionMeta(version, questionOf.oldest(account)),
    },
  };
}

/**
 * Call lists of four customers, drawn without overlap, where at least one customer owes
 * something and no two owe the same amount (so "largest first" has one right order).
 */
function callListCandidates(random: Random, accounts: readonly Account[]): Candidate<Account[]>[] {
  const shuffled = random.shuffle(accounts);
  const candidates: Candidate<Account[]>[] = [];
  for (let start = 0; start + CALL_LIST_SIZE <= shuffled.length; start += CALL_LIST_SIZE) {
    const members = shuffled.slice(start, start + CALL_LIST_SIZE);
    const owing = members.filter((member) => member.overdueCents > 0);
    const amounts = new Set(owing.map((member) => member.overdueCents));
    if (owing.length === 0 || amounts.size < owing.length) continue;
    const traps = [
      ...new Set(
        members.flatMap((member) =>
          member.traps.filter((trap) => trap !== 'nothing_overdue' && trap !== 'several_invoices'),
        ),
      ),
    ].sort(compareText);
    if (owing.length >= 2) traps.push('largest_first');
    candidates.push({ value: members, traps, kind: `${owing.length} owing` });
  }
  return candidates;
}

function callListTask(
  random: Random,
  { value: members, traps }: Candidate<Account[]>,
  version: JobVersion,
): TaskDraft {
  const names = members
    .map((member) => `${member.customer.customer_id} (${member.customer.name})`)
    .join(', ');
  const owing = members
    .filter((member) => member.overdueCents > 0)
    .sort((a, b) => b.overdueCents - a.overdueCents);
  const prompts = [
    `Today is ${TODAY}. I'm making collection calls to ${names}. Which of them have an overdue ` +
      'balance, and how much? List only customers with an overdue balance, largest balance first.',
    `It's ${TODAY}. For this call list: ${names}. Give each customer's overdue balance, leaving ` +
      'out anyone with nothing overdue, largest balance first.',
  ];
  return {
    type: 'overdue',
    family: `call-list:${members.map((member) => member.customer.customer_id).join('+')}`,
    prompt: withAnswerLine(random.pick(prompts), CALL_LIST_SHAPE),
    expected: {
      kind: 'answer',
      value: {
        customers: owing.map((member) => ({
          customer_id: member.customer.customer_id,
          overdue_cents: member.overdueCents,
        })),
      },
      compare: { mode: 'exact' },
    },
    meta: {
      summary: owing
        .map((member) => `${member.customer.customer_id} ${dollars(member.overdueCents)}`)
        .join(', '),
      difficulty: difficultyOf(traps),
      traps,
      ...questionMeta(version, questionOf.callList(members)),
    },
  };
}

interface DueWindow {
  from: string;
  to: string;
  overdue: OverdueInvoice[];
  covered: Covered;
}

/** Three-day spans of due dates (Tuesday to Thursday, Friday to Sunday) with something overdue. */
function windowCandidates(
  records: CompanyRecords,
  paymentsOf: ReadonlyMap<string, Payment[]>,
): Candidate<DueWindow>[] {
  return datesFrom(FIRST_WINDOW, LAST_WINDOW)
    .filter((date) => weekdayOf(date) === 'Tue' || weekdayOf(date) === 'Fri')
    .map((from) => {
      const to = addDays(from, WINDOW_DAYS - 1);
      const due = records.invoices.filter((i) => i.due_date >= from && i.due_date <= to);
      const overdue = overdueInvoices(due, records.payments, BUSINESS_DATE);
      const traps = [
        ...(overdue.length >= 4 ? ['several_invoices'] : []),
        ...balanceTraps(due, records.payments, overdue),
      ];
      const covered = {
        invoices: due,
        payments: due.flatMap((invoice) => paymentsOf.get(invoice.invoice_id) ?? []),
      };
      return { value: { from, to, overdue, covered }, traps, kind: traps.join('+') };
    })
    .filter((candidate) => candidate.value.overdue.length > 0);
}

function windowTask(
  random: Random,
  { value: window, traps }: Candidate<DueWindow>,
  version: JobVersion,
): TaskDraft {
  const total = sum(window.overdue.map((invoice) => invoice.balance_cents));
  const prompts = [
    `Today is ${TODAY}. Which invoices with a due date from ${window.from} to ${window.to} ` +
      '(both included) are overdue now, and what do their balances add up to?',
    `It's ${TODAY}. Review the invoices due between ${window.from} and ${window.to}, ` +
      'inclusive. Which of them are overdue today, and what is the total overdue balance on them?',
  ];
  return {
    type: 'overdue',
    family: `due-window:${window.from}`,
    prompt: withAnswerLine(random.pick(prompts), LIST_SHAPE),
    expected: {
      kind: 'answer',
      value: {
        invoice_ids: window.overdue.map((invoice) => invoice.invoice_id),
        overdue_cents: total,
      },
      compare: { mode: 'exact', setKeys: ['invoice_ids'] },
    },
    meta: {
      summary: `${window.overdue.length} overdue, ${dollars(total)}`,
      difficulty: difficultyOf(traps),
      traps,
      ...questionMeta(version, questionOf.window(window)),
    },
  };
}
