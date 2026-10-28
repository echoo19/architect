import { join } from 'node:path';
import { createChecker, createSandbox, createToolbox, openAgentFiles } from '@architect/engine';
import type { Sandbox } from '@architect/engine';
import { HarnessSchema } from '@architect/shared';
import type { CheckOutcome, JsonValue, Task } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CsvRow } from '../src/lib/csv';
import { answerByReading } from '../src/reference/overdue-reads';
import type { OverdueQuestion } from '../src/reference/overdue-questions';
import { AgentTools } from '../src/reference/tools';
import type { ToolCall } from '../src/reference/tools';
import { BOTH_VERSIONS, BUSINESS_DATE, answerOf, latestVersion, trapsOf } from './helpers';
import type { JobFolder } from './helpers';
import { daysFromTo, invoicesDueBetween, membersOf, openBalance, totalOpen } from './oracles';

/**
 * The overdue reference solutions use only the agent's tools, so their tool calls show what each
 * task costs in turns and context. These tests replay every call through the runner's own tools
 * and compare the text the agent gets back, grade every answer with the runner's checker, check
 * that each task fits the agent's turns and a third of its context, and check that the mistakes
 * the new questions are built around (missing part of a long result, counting an invoice due
 * today) really fail.
 */

/** Model turns the agent gets: one tool call each, and one more for the reply with ANSWER. */
const MAX_STEPS = 16;
/** A third of the agent's 16k-token context. */
const MAX_CHARACTERS = 24_000;

let sandbox: Sandbox;
beforeAll(() => {
  sandbox = createSandbox();
});
afterAll(() => sandbox.dispose());

const harness = HarnessSchema.parse({
  meta: { format: 2, name: 'Service desk', version: 0, hash: '' },
  system: 'You are the Service desk agent.',
  retrieval: {},
  decoding: {},
  guardrails: {},
});

/** The text the runner's tools give back for each call, on a fresh scratch copy of the files. */
async function replay(job: JobFolder, calls: readonly ToolCall[]) {
  const files = await openAgentFiles({
    dataDir: join(job.dir, 'data'),
    files: job.job().data.files,
    mode: 'scratch',
  });
  const toolbox = createToolbox({ harness, files, sandbox, today: BUSINESS_DATE });
  const contents: string[] = [];
  for (const [index, call] of calls.entries()) {
    const outcome = await toolbox.run({
      id: `call_${index}`,
      name: call.name,
      arguments: call.arguments,
    });
    contents.push(outcome.content);
  }
  return contents;
}

describe('the tools of the reference solutions', () => {
  it('read a long file in parts, numbered and noted the way the runner does', async () => {
    const tools = new AgentTools(latestVersion.data());
    tools.readAll('invoices.csv');
    expect(tools.calls.length).toBeGreaterThan(10);
    expect(tools.calls[1]?.content).toMatch(/^\d+\tINV-/);
    expect(tools.calls[0]?.content).toMatch(
      /\n\[Lines 1-\d+ of 1395\. 1,\d{3} more lines: read on with offset \d+\.\]$/,
    );
    expect(await replay(latestVersion, tools.calls)).toEqual(
      tools.calls.map((call) => call.content),
    );
  });
});

/** The question a task asks: recorded in version 2, worked out from the family in version 1. */
function questionOf(task: Task): OverdueQuestion {
  const recorded = task.meta?.question;
  if (recorded !== undefined) return recorded as unknown as OverdueQuestion;
  const [kind, subject = ''] = task.family.split(':');
  if (kind === 'customer') {
    return 'days_overdue' in answerOf(task)
      ? { kind: 'oldest_invoice', customer_id: subject }
      : { kind: 'customer_balance', customer_id: subject };
  }
  if (kind === 'call-list') return { kind: 'call_list', customer_ids: subject.split('+') };
  const [from, to] = task.prompt.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  if (kind !== 'due-window' || !from || !to) throw new Error(`${task.id} asks no known question`);
  return { kind: 'due_window', from, to };
}

/** Whether the built-in comparator would accept `answer`: equal JSON, with set keys unordered. */
function grades(task: Task, answer: JsonValue): boolean {
  if (task.expected.kind !== 'answer') throw new Error(`${task.id} is not an answer task`);
  const setKeys = task.expected.compare.setKeys ?? [];
  const canonical = (value: JsonValue): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    const entries = Object.keys(value)
      .sort()
      .map((key) => {
        const child = value[key] as JsonValue;
        const items = Array.isArray(child) && setKeys.includes(key);
        const text = items ? `[${child.map(canonical).sort().join(',')}]` : canonical(child);
        return `${JSON.stringify(key)}:${text}`;
      });
    return `{${entries.join(',')}}`;
  };
  return canonical(answer) === canonical(task.expected.value);
}

describe.each(BOTH_VERSIONS)(
  "reference solutions with the agent's tools in version $version",
  (job) => {
    const solved = job.tasksOfType('overdue').map((task) => {
      const tools = new AgentTools(job.data());
      const answer = answerByReading(tools, questionOf(task), BUSINESS_DATE);
      return { task, answer, tools };
    });

    it('answer every overdue task the way it is graded', () => {
      for (const { task, answer } of solved) expect(grades(task, answer), task.id).toBe(true);
    });

    it(`fit every overdue task in ${MAX_STEPS} turns, the answer and reading the policy included`, () => {
      for (const { task, tools } of solved) {
        expect(tools.calls.length + 1, task.id).toBeLessThanOrEqual(MAX_STEPS);
      }
    });

    it(`read at most ${MAX_CHARACTERS.toLocaleString('en-US')} characters, a third of the agent's 16k-token context`, () => {
      for (const { task, tools } of solved) {
        expect(tools.characters, task.id).toBeLessThanOrEqual(MAX_CHARACTERS);
      }
    });

    it("get back exactly the text the model of the tools gives, and pass the runner's checker", async () => {
      const checker = createChecker({ job: job.job(), jobDir: job.dir, sandbox });
      const files = await openAgentFiles({
        dataDir: join(job.dir, 'data'),
        files: job.job().data.files,
        mode: 'scratch',
      });
      for (const { task, answer, tools } of solved) {
        expect(await replay(job, tools.calls), task.id).toEqual(
          tools.calls.map((call) => call.content),
        );
        const outcome: CheckOutcome = {
          finalText: `ANSWER: ${JSON.stringify(answer)}`,
          answer,
          toolCalls: tools.calls.map((call) => ({ name: call.name, arguments: call.arguments })),
          stopReason: 'answer',
        };
        expect(await checker.check(task, outcome, files), task.id).toMatchObject({ pass: true });
      }
    }, 300_000);
  },
);

describe('the policy of version 2', () => {
  it('fits in a single read', () => {
    const tools = new AgentTools(latestVersion.data());
    tools.readAll('policy.md');
    expect(tools.calls).toHaveLength(1);
  });
});

/**
 * An answer worked out with the oracle, with a choice of which invoices count as past due: the
 * policy's (due before today) or a careless one.
 */
function oracleAnswer(
  job: JobFolder,
  question: OverdueQuestion,
  pastDue: (invoice: CsvRow) => boolean,
): JsonValue {
  const overdue = (invoices: CsvRow[]) =>
    invoices.filter((invoice) => pastDue(invoice) && openBalance(job, invoice) > 0);
  const invoicesOf = (id: string) => job.rowsWhere('invoices.csv', 'customer_id', id);
  const ids = (invoices: CsvRow[]) => invoices.map((invoice) => String(invoice.invoice_id)).sort();
  const owing = (customerIds: string[]) =>
    customerIds
      .map((customer_id) => ({
        customer_id,
        overdue_cents: totalOpen(job, overdue(invoicesOf(customer_id))),
      }))
      .filter((member) => member.overdue_cents > 0)
      .sort((a, b) => b.overdue_cents - a.overdue_cents);
  const members = (group: Record<string, string>) =>
    membersOf(job, group).map((row) => String(row.customer_id));

  switch (question.kind) {
    case 'customer_balance': {
      const open = overdue(invoicesOf(question.customer_id));
      return { invoice_ids: ids(open), overdue_cents: totalOpen(job, open) };
    }
    case 'oldest_invoice': {
      const order = (invoice: CsvRow) => `${invoice.due_date} ${invoice.invoice_id}`;
      const [oldest] = overdue(invoicesOf(question.customer_id)).sort((a, b) =>
        order(a) < order(b) ? -1 : 1,
      );
      if (!oldest) return null;
      return {
        invoice_id: String(oldest.invoice_id),
        balance_cents: openBalance(job, oldest),
        days_overdue: daysFromTo(String(oldest.due_date), BUSINESS_DATE),
      };
    }
    case 'call_list':
      return { customers: owing(question.customer_ids) };
    case 'due_window': {
      const open = overdue(invoicesDueBetween(job, question.from, question.to));
      return { invoice_ids: ids(open), overdue_cents: totalOpen(job, open) };
    }
    case 'group_total':
      return {
        overdue_cents: owing(members(question.group)).reduce((t, m) => t + m.overdue_cents, 0),
      };
    case 'group_top':
      return { customers: owing(members(question.group)).slice(0, question.count) };
    case 'group_age': {
      const late = members(question.group).filter((id) =>
        overdue(invoicesOf(id)).some(
          (invoice) => daysFromTo(String(invoice.due_date), BUSINESS_DATE) > question.days,
        ),
      );
      return { count: late.length, customer_ids: late.sort() };
    }
    case 'group_owing':
      return {
        customers: owing(members(question.group)).filter(
          (member) => member.overdue_cents > question.over_cents,
        ),
      };
  }
}

/**
 * What an agent gets when it takes part of a long result for all of it: the first 50 matching
 * rows of each table, in file order.
 */
function partialGroupAnswer(job: JobFolder, question: OverdueQuestion): JsonValue {
  if (!('group' in question)) throw new Error(`${question.kind} is not about a group`);
  const firstPage = <T>(rows: T[]) => rows.slice(0, 50);
  const members = new Set(
    firstPage(membersOf(job, question.group)).map((row) => String(row.customer_id)),
  );
  const cutoff = new Date(`${BUSINESS_DATE}T12:00:00Z`);
  if (question.kind === 'group_age') cutoff.setUTCDate(cutoff.getUTCDate() - question.days);
  const before = cutoff.toISOString().slice(0, 10);
  const invoices = firstPage(
    job
      .table('invoices.csv')
      .filter((i) => members.has(String(i.customer_id)) && String(i.due_date) < before),
  );
  const invoiceIds = new Set(invoices.map((invoice) => String(invoice.invoice_id)));
  const payments = firstPage(
    job
      .table('payments.csv')
      .filter((p) => invoiceIds.has(String(p.invoice_id)) && String(p.date) <= BUSINESS_DATE),
  );
  const open = (invoice: CsvRow) =>
    Number(invoice.total_cents) -
    payments
      .filter((payment) => payment.invoice_id === invoice.invoice_id)
      .reduce((paid, payment) => paid + Number(payment.amount_cents), 0);

  const owed = new Map<string, number>();
  for (const invoice of invoices) {
    if (open(invoice) <= 0) continue;
    const customer = String(invoice.customer_id);
    owed.set(customer, (owed.get(customer) ?? 0) + open(invoice));
  }
  const ranked = [...owed]
    .map(([customer_id, overdue_cents]) => ({ customer_id, overdue_cents }))
    .sort((a, b) => b.overdue_cents - a.overdue_cents);
  switch (question.kind) {
    case 'group_total':
      return { overdue_cents: ranked.reduce((total, m) => total + m.overdue_cents, 0) };
    case 'group_top':
      return { customers: ranked.slice(0, question.count) };
    case 'group_age':
      return { count: ranked.length, customer_ids: ranked.map((m) => m.customer_id).sort() };
    case 'group_owing':
      return { customers: ranked.filter((member) => member.overdue_cents > question.over_cents) };
  }
}

describe('the mistakes version 2 is built around', () => {
  const tasks = latestVersion.tasksOfType('overdue');
  const policy = (invoice: CsvRow) => String(invoice.due_date) < BUSINESS_DATE;

  it('agree with the oracle on every overdue task when the rules are read right', () => {
    for (const task of tasks) {
      expect(grades(task, oracleAnswer(latestVersion, questionOf(task), policy)), task.id).toBe(
        true,
      );
    }
  });

  it('fail a group answer that took part of a long result for all of it', () => {
    const paged = tasks.filter((task) => trapsOf(task).includes('paging'));
    expect(paged.length).toBeGreaterThanOrEqual(8);
    for (const task of paged) {
      expect(grades(task, partialGroupAnswer(latestVersion, questionOf(task))), task.id).toBe(
        false,
      );
    }
  });

  it('fail an answer that counts an invoice due today as overdue', () => {
    const dueToday = tasks.filter((task) => trapsOf(task).includes('due_today'));
    expect(dueToday.length).toBeGreaterThanOrEqual(5);
    const careless = (invoice: CsvRow) => String(invoice.due_date) <= BUSINESS_DATE;
    for (const task of dueToday) {
      const answer = oracleAnswer(latestVersion, questionOf(task), careless);
      expect(grades(task, answer), task.id).toBe(false);
    }
  });
});
