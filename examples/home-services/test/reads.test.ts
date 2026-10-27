import type { JsonValue, Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { CsvRow } from '../src/lib/csv';
import { answerByReading } from '../src/reference/overdue-reads';
import type { OverdueQuestion } from '../src/reference/overdue-questions';
import { ReadTools } from '../src/reference/read-tools';
import { BOTH_VERSIONS, BUSINESS_DATE, answerOf, latestVersion, trapsOf } from './helpers';
import type { JobFolder } from './helpers';
import { daysFromTo, invoicesDueBetween, membersOf, openBalance, totalOpen } from './oracles';

/**
 * The overdue reference solutions use only the agent's read tools, so their tool calls show what
 * each task costs in turns and context. These tests check the tools behave like the runner's,
 * that the solutions answer every task within ten calls, and that the mistakes the new questions
 * are built around (missing a page, counting an invoice due today) really fail.
 */

describe('the read tools of the reference solutions', () => {
  const day = (n: number) => `2026-10-${String((n % 28) + 1).padStart(2, '0')}`;
  const rows = Array.from({ length: 450 }, (_, i) => ({
    id: `R-${String(i + 1).padStart(3, '0')}`,
    n: String(i + 1),
    date: day(i),
    note: 'x'.repeat(100),
  }));
  const longText = 'A line of the office policy.\n'.repeat(700);
  const tools = () =>
    new ReadTools({
      tables: new Map([['t.csv', { columns: ['id', 'n', 'date', 'note'], rows }]]),
      texts: new Map([
        ['short.md', 'One line.\n'],
        ['long.md', longText],
      ]),
    });

  it('return 50 rows unless asked for more, and never more than 200', () => {
    const read = tools();
    expect(read.readTable({ file: 't.csv', columns: ['id'] }).rows).toHaveLength(50);
    const most = read.readTable({ file: 't.csv', columns: ['id'], limit: 500 });
    expect(most.rows).toHaveLength(200);
    expect([most.total, most.truncated]).toEqual([450, true]);
    expect(read.calls).toBe(2);
  });

  it('page with offset until the last matching row', () => {
    const read = tools();
    const seen: string[] = [];
    for (let page = { truncated: true }; page.truncated;) {
      const next = read.readTable({
        file: 't.csv',
        columns: ['id'],
        limit: 200,
        offset: seen.length,
      });
      seen.push(...next.rows.map((row) => String(row.id)));
      page = next;
    }
    expect(seen).toEqual(rows.map((row) => row.id));
    expect(read.calls).toBe(3);
  });

  it('cut a result to 8,000 characters, written the way the runner writes it', () => {
    const resultText = (count: number) =>
      JSON.stringify({
        file: 't.csv',
        columns: ['id', 'note'],
        rows: rows.slice(0, count).map((row) => [row.id, row.note]),
        total: 450,
        truncated: true,
        note: `Rows 1 to ${count} of 450 are shown to stay within the size limit. Read again with offset ${count} for more, or ask for fewer columns.`,
      });
    let fits = 0;
    while (resultText(fits + 1).length <= 8000) fits += 1;

    const read = tools();
    const page = read.readTable({ file: 't.csv', columns: ['id', 'note'], limit: 200 });
    expect(page.rows).toHaveLength(fits);
    expect(fits).toBeLessThan(200);
    expect(read.characters).toBe(resultText(fits).length);
  });

  it('compare numbers as numbers and everything else as text', () => {
    const read = tools();
    const count = (where: Parameters<ReadTools['readTable']>[0]['where']) =>
      read.readTable({ file: 't.csv', where, limit: 0 }).total;
    expect(count([{ column: 'n', op: '=', value: 45 }])).toBe(1);
    expect(count([{ column: 'n', op: '=', value: '45.0' }])).toBe(1);
    expect(count([{ column: 'n', op: '<', value: '100' }])).toBe(99);
    expect(count([{ column: 'n', op: 'in', value: [1, '2', 'R-003'] }])).toBe(2);
    expect(count([{ column: 'id', op: 'in', value: ['R-001', 'R-450', 'R-999'] }])).toBe(2);
    expect(count([{ column: 'date', op: '<', value: '2026-10-03' }])).toBe(
      rows.filter((row) => row.date < '2026-10-03').length,
    );
    expect(() => count([{ column: 'missing', op: '=', value: 1 }])).toThrow(
      't.csv has no column missing',
    );
  });

  it('hand a long text over in parts that end at a line break, and a short one whole', () => {
    const read = tools();
    expect(read.readText('short.md')).toEqual({ text: 'One line.\n', nextOffset: null });
    let text = '';
    for (let offset: number | null = 0; offset !== null;) {
      const part = read.readText('long.md', offset);
      expect(part.text.endsWith('\n')).toBe(true);
      text += part.text;
      offset = part.nextOffset;
    }
    expect(text).toBe(longText);
    expect(read.calls).toBeGreaterThanOrEqual(3);
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

describe.each(BOTH_VERSIONS)('reference solutions with read tools in version $version', (job) => {
  const solved = job.tasksOfType('overdue').map((task) => {
    const tools = new ReadTools(job.data());
    const answer = answerByReading(tools, questionOf(task), BUSINESS_DATE);
    return { task, answer, calls: tools.calls, characters: tools.characters };
  });

  it('answer every overdue task the way it is graded', () => {
    for (const { task, answer } of solved) expect(grades(task, answer), task.id).toBe(true);
  });

  it('need at most 10 tool calls for any overdue task, reading the policy included', () => {
    for (const { task, calls } of solved) expect(calls, task.id).toBeLessThanOrEqual(10);
  });

  it("read at most 24,000 characters, a third of the agent's 16k-token context", () => {
    for (const { task, characters } of solved) {
      expect(characters, task.id).toBeLessThanOrEqual(24_000);
    }
  });
});

describe('the policy of version 2', () => {
  it('fits in a single read_text result', () => {
    const tools = new ReadTools(latestVersion.data());
    expect(tools.readText('policy.md').nextOffset).toBeNull();
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
 * What an agent gets when it reads a group the lazy way: one read of each table with the default
 * limit, so it sees only the first 50 matching rows of each, in file order.
 */
function lazyGroupAnswer(job: JobFolder, question: OverdueQuestion): JsonValue {
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

  it('fail a group answer that read only the first page of a long result', () => {
    const paged = tasks.filter((task) => trapsOf(task).includes('paging'));
    expect(paged.length).toBeGreaterThanOrEqual(8);
    for (const task of paged) {
      expect(grades(task, lazyGroupAnswer(latestVersion, questionOf(task))), task.id).toBe(false);
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
