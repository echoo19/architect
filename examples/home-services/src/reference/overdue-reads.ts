import type { JsonValue } from '@architect/shared';
import { addDays } from '../lib/calendar';
import type { InvoiceDue, PaymentMade } from './balances';
import { answerQuestion } from './overdue-questions';
import type { OverdueQuestion } from './overdue-questions';
import { MAX_ROWS } from './read-tools';
import type { Condition, ReadTools, Row, TableRead } from './read-tools';

/**
 * Reference solutions to the overdue questions that use only the agent's read tools, so the
 * calls they make show what a task costs in turns and context. Each reads the policy, then the
 * customers in a group when the question names one, then the past-due invoices it covers, then
 * the payments received on them. A careful reader names the columns it needs and pages until
 * every matching row is in; a lazy one takes the first page of 50 rows and stops there.
 */

export type Reading = 'careful' | 'lazy';

const INVOICE_COLUMNS = ['invoice_id', 'customer_id', 'due_date', 'total_cents'];
const PAYMENT_COLUMNS = ['invoice_id', 'date', 'amount_cents'];

export function answerByReading(
  tools: ReadTools,
  question: OverdueQuestion,
  asOf: string,
  reading: Reading = 'careful',
): JsonValue {
  // The rules come from the policy, so reading it is part of the cost; answerQuestion applies them.
  readToTheEnd(tools, 'policy.md');
  const invoices = rowsOf(
    tools,
    {
      file: 'invoices.csv',
      where: [...invoiceConditions(tools, question, reading), pastDue(question, asOf)],
      columns: INVOICE_COLUMNS,
    },
    reading,
  ).map(toInvoice);
  const payments =
    invoices.length === 0
      ? []
      : rowsOf(
          tools,
          {
            file: 'payments.csv',
            where: [
              { column: 'invoice_id', op: 'in', value: invoices.map((i) => i.invoice_id) },
              { column: 'date', op: '<=', value: asOf },
            ],
            columns: PAYMENT_COLUMNS,
          },
          reading,
        ).map(toPayment);
  return answerQuestion(question, invoices, payments, asOf);
}

/** Which invoices the question covers, as where conditions on invoices.csv. */
function invoiceConditions(
  tools: ReadTools,
  question: OverdueQuestion,
  reading: Reading,
): Condition[] {
  switch (question.kind) {
    case 'customer_balance':
    case 'oldest_invoice':
      return [{ column: 'customer_id', op: '=', value: question.customer_id }];
    case 'call_list':
      return [{ column: 'customer_id', op: 'in', value: question.customer_ids }];
    case 'due_window':
      return [
        { column: 'due_date', op: '>=', value: question.from },
        { column: 'due_date', op: '<=', value: question.to },
      ];
    case 'group_total':
    case 'group_top':
    case 'group_age':
    case 'group_owing': {
      const members = rowsOf(
        tools,
        {
          file: 'customers.csv',
          where: Object.entries(question.group).map(([column, value]) => ({
            column,
            op: '=' as const,
            value,
          })),
          columns: ['customer_id'],
        },
        reading,
      ).map((row) => String(row.customer_id));
      return [{ column: 'customer_id', op: 'in', value: members }];
    }
  }
}

/**
 * Invoices due before the business date. For a question about invoices more than N days overdue
 * only those due more than N days ago matter, so the read asks for just those.
 */
function pastDue(question: OverdueQuestion, asOf: string): Condition {
  const before = question.kind === 'group_age' ? addDays(asOf, -question.days) : asOf;
  return { column: 'due_date', op: '<', value: before };
}

function rowsOf(tools: ReadTools, read: TableRead, reading: Reading): Row[] {
  if (reading === 'lazy') return tools.readTable(read).rows;
  const rows: Row[] = [];
  for (;;) {
    const page = tools.readTable({ ...read, limit: MAX_ROWS, offset: rows.length });
    if (page.rows.length === 0 && page.truncated) {
      throw new Error(`A single row of ${read.file} is longer than a tool result can hold`);
    }
    rows.push(...page.rows);
    if (!page.truncated) return rows;
  }
}

function readToTheEnd(tools: ReadTools, file: string): void {
  for (let offset: number | null = 0; offset !== null;) {
    offset = tools.readText(file, offset).nextOffset;
  }
}

function toInvoice(row: Row): InvoiceDue {
  return {
    invoice_id: String(row.invoice_id),
    customer_id: String(row.customer_id),
    due_date: String(row.due_date),
    total_cents: Number(row.total_cents),
  };
}

function toPayment(row: Row): PaymentMade {
  return {
    invoice_id: String(row.invoice_id),
    date: String(row.date),
    amount_cents: Number(row.amount_cents),
  };
}
