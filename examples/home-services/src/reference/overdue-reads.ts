import type { JsonValue } from '@architect/shared';
import { addDays } from '../lib/calendar';
import { answerQuestion } from './overdue-questions';
import type { OverdueQuestion } from './overdue-questions';
import { cell } from './tools';
import type { AgentTools, CodeRow, Rows } from './tools';

/**
 * Reference solutions to the overdue questions that use only the agent's tools, so the calls they
 * make show what each task costs in turns and context. Each reads the policy, then sends run code
 * that lists the past-due invoices the question covers (a group's customers found in the same
 * code), then code that lists the payments received on those invoices by today. Both lists come
 * back as compact rows in a known column order, so even the largest group fits one result.
 */

const READ = `const read = (name) => csv.parse(files.read('data/' + name));`;
const text = (value: string): string => JSON.stringify(value);

export function answerByReading(
  tools: AgentTools,
  question: OverdueQuestion,
  asOf: string,
): JsonValue {
  // The rules come from the policy, so reading it is part of the cost; answerQuestion applies them.
  tools.readAll('policy.md');
  const before = pastDueBefore(question, asOf);
  const { setup, test } = coveredCode(question);
  const pick = `${test} && row.due_date < ${text(before)}`;
  const pastDue = (rows: Rows) => {
    const covered = coveredTest(question, rows);
    return rows('invoices.csv', (row) => covered(row) && cell(row, 'due_date') < before);
  };

  const invoices = tools
    .run(
      [
        READ,
        ...setup,
        `read('invoices.csv').filter((row) => ${pick}).map((row) => [row.invoice_id, row.customer_id, row.due_date, row.total_cents])`,
      ].join('\n'),
      (rows) =>
        pastDue(rows).map((row) => [
          cell(row, 'invoice_id'),
          cell(row, 'customer_id'),
          cell(row, 'due_date'),
          cell(row, 'total_cents'),
        ]),
    )
    .map(([invoice_id, customer_id, due_date, total_cents]) => ({
      invoice_id: String(invoice_id),
      customer_id: String(customer_id),
      due_date: String(due_date),
      total_cents: Number(total_cents),
    }));
  if (invoices.length === 0) return answerQuestion(question, [], [], asOf);

  const payments = tools
    .run(
      [
        READ,
        ...setup,
        `const invoices = read('invoices.csv').filter((row) => ${pick}).map((row) => row.invoice_id);`,
        `read('payments.csv').filter((row) => invoices.includes(row.invoice_id) && row.date <= ${text(asOf)}).map((row) => [row.invoice_id, row.date, row.amount_cents])`,
      ].join('\n'),
      (rows) => {
        const ids = new Set(pastDue(rows).map((row) => cell(row, 'invoice_id')));
        return rows(
          'payments.csv',
          (row) => ids.has(cell(row, 'invoice_id')) && cell(row, 'date') <= asOf,
        ).map((row) => [cell(row, 'invoice_id'), cell(row, 'date'), cell(row, 'amount_cents')]);
      },
    )
    .map(([invoice_id, date, amount_cents]) => ({
      invoice_id: String(invoice_id),
      date: String(date),
      amount_cents: Number(amount_cents),
    }));
  return answerQuestion(question, invoices, payments, asOf);
}

/** The code that picks the invoices a question covers: lines to run first, and a test on `row`. */
function coveredCode(question: OverdueQuestion): { setup: string[]; test: string } {
  switch (question.kind) {
    case 'customer_balance':
    case 'oldest_invoice':
      return { setup: [], test: `row.customer_id === ${text(question.customer_id)}` };
    case 'call_list':
      return {
        setup: [],
        test: `${JSON.stringify(question.customer_ids)}.includes(row.customer_id)`,
      };
    case 'due_window':
      return {
        setup: [],
        test: `row.due_date >= ${text(question.from)} && row.due_date <= ${text(question.to)}`,
      };
    case 'group_total':
    case 'group_top':
    case 'group_age':
    case 'group_owing': {
      const match = Object.entries(question.group)
        .map(([column, value]) => `row.${column} === ${text(value)}`)
        .join(' && ');
      return {
        setup: [
          `const members = read('customers.csv').filter((row) => ${match}).map((row) => row.customer_id);`,
        ],
        test: 'members.includes(row.customer_id)',
      };
    }
  }
}

/** The same test the reference applies to an invoice row, with a group's customers found first. */
function coveredTest(question: OverdueQuestion, rows: Rows): (row: CodeRow) => boolean {
  switch (question.kind) {
    case 'customer_balance':
    case 'oldest_invoice':
      return (row) => cell(row, 'customer_id') === question.customer_id;
    case 'call_list':
      return (row) => question.customer_ids.includes(cell(row, 'customer_id'));
    case 'due_window':
      return (row) =>
        cell(row, 'due_date') >= question.from && cell(row, 'due_date') <= question.to;
    case 'group_total':
    case 'group_top':
    case 'group_age':
    case 'group_owing': {
      const columns = Object.entries(question.group);
      const members = new Set(
        rows('customers.csv', (row) =>
          columns.every(([column, value]) => cell(row, column) === value),
        ).map((row) => cell(row, 'customer_id')),
      );
      return (row) => members.has(cell(row, 'customer_id'));
    }
  }
}

/**
 * Invoices due before the business date. For a question about invoices more than N days overdue
 * only those due more than N days ago matter, so the code asks for just those.
 */
function pastDueBefore(question: OverdueQuestion, asOf: string): string {
  return question.kind === 'group_age' ? addDays(asOf, -question.days) : asOf;
}
