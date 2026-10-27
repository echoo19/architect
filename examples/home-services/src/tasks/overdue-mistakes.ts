import { addDays } from '../lib/calendar';
import { BUSINESS_DATE } from '../policy/rules';
import { isOverdue, receivedCents } from '../reference/balances';
import type { InvoiceDue, PaymentMade } from '../reference/balances';
import { answerQuestion } from '../reference/overdue-questions';
import type { OverdueQuestion } from '../reference/overdue-questions';

/** The invoices an overdue question covers, and the payments recorded against them. */
export interface Covered {
  invoices: readonly InvoiceDue[];
  payments: readonly PaymentMade[];
}

const YESTERDAY = addDays(BUSINESS_DATE, -1);
const TOMORROW = addDays(BUSINESS_DATE, 1);

/**
 * Ways to misread the overdue rules, each applied to the records a question covers, so a trap is
 * a mistake that changes the answer: counting payments that haven't arrived (any of them, or just
 * tomorrow's), missing the ones that arrived today, putting an invoice due today or yesterday on
 * the wrong side of overdue, forgetting part payments on invoices that are still open, or going
 * by due dates alone and counting invoices that were paid in full.
 */
const MISTAKES = {
  scheduled_payment: ({ invoices, payments }: Covered) => ({
    invoices,
    payments: payments.map((p) => (p.date > BUSINESS_DATE ? { ...p, date: BUSINESS_DATE } : p)),
  }),
  paid_tomorrow: ({ invoices, payments }: Covered) => ({
    invoices,
    payments: payments.map((p) => (p.date === TOMORROW ? { ...p, date: BUSINESS_DATE } : p)),
  }),
  paid_today: ({ invoices, payments }: Covered) => ({
    invoices,
    payments: payments.filter((p) => p.date !== BUSINESS_DATE),
  }),
  due_today: ({ invoices, payments }: Covered) => ({
    invoices: invoices.map((i) =>
      i.due_date === BUSINESS_DATE ? { ...i, due_date: YESTERDAY } : i,
    ),
    payments,
  }),
  due_yesterday: ({ invoices, payments }: Covered) => ({
    invoices: invoices.map((i) =>
      i.due_date === YESTERDAY ? { ...i, due_date: BUSINESS_DATE } : i,
    ),
    payments,
  }),
  partial_payment: ({ invoices, payments }: Covered) => {
    const partlyPaid = new Set(
      invoices
        .filter(
          (i) =>
            isOverdue(i, payments, BUSINESS_DATE) && receivedCents(i, payments, BUSINESS_DATE) > 0,
        )
        .map((i) => i.invoice_id),
    );
    return { invoices, payments: payments.filter((p) => !partlyPaid.has(p.invoice_id)) };
  },
  paid_in_full: ({ invoices }: Covered) => ({ invoices, payments: [] }),
} satisfies Record<string, (covered: Covered) => Covered>;

export type OverdueMistake = keyof typeof MISTAKES;

/** The mistakes, in the order given, that would change the answer to `question`. */
export function mistakesThatMatter(
  question: OverdueQuestion,
  covered: Covered,
  mistakes: readonly OverdueMistake[],
): OverdueMistake[] {
  const answer = (records: Covered) =>
    JSON.stringify(answerQuestion(question, records.invoices, records.payments, BUSINESS_DATE));
  const truth = answer(covered);
  return mistakes.filter((mistake) => answer(MISTAKES[mistake](covered)) !== truth);
}
