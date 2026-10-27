import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { CheckResultSchema, TaskSchema } from '@architect/shared';
import type { CheckResult, Task } from '@architect/shared';
import { sampleJobDir } from '../src';
import { parseCsv } from '../src/lib/csv';
import type { CsvRow } from '../src/lib/csv';

/** The committed job folder, read the way the runner would read it. */

export const BUSINESS_DATE = '2026-11-05';

export function jobFile(path: string): string {
  return readFileSync(join(sampleJobDir, ...path.split('/')), 'utf8');
}

let tasks: Task[] | undefined;
export function loadTasks(): Task[] {
  tasks ??= jobFile('tasks.jsonl')
    .trimEnd()
    .split('\n')
    .map((line) => TaskSchema.parse(JSON.parse(line)));
  return tasks;
}

export function taskById(id: string): Task {
  const task = loadTasks().find((t) => t.id === id);
  if (!task) throw new Error(`No task ${id}`);
  return task;
}

const tables = new Map<string, CsvRow[]>();
/** A data table as rows of strings (empty cells null), parsed once. Treat it as read-only. */
export function table(name: string): CsvRow[] {
  let rows = tables.get(name);
  if (!rows) {
    rows = parseCsv(jobFile(`data/${name}`));
    tables.set(name, rows);
  }
  return rows;
}

/** The single row whose `column` equals `value`. */
export function rowWhere(name: string, column: string, value: string): CsvRow {
  const matches = table(name).filter((row) => row[column] === value);
  if (matches.length !== 1)
    throw new Error(`${matches.length} rows in ${name} with ${column}=${value}`);
  return matches[0] as CsvRow;
}

export function rowsWhere(name: string, column: string, value: string): CsvRow[] {
  return table(name).filter((row) => row[column] === value);
}

export interface CheckerContext {
  readTable(name: string): CsvRow[];
  readOriginalTable(name: string): CsvRow[];
  answer: null;
  finalText: string;
  toolCalls: [];
}

/** A checker context whose end state is the original data with `changed` tables swapped in. */
export function contextWith(changed: Record<string, CsvRow[]>): CheckerContext {
  return {
    readTable: (name) => changed[name] ?? table(name),
    readOriginalTable: (name) => table(name),
    answer: null,
    finalText: '',
    toolCalls: [],
  };
}

/** The end state after appending `rows` to one table. */
export function withAppended(name: string, ...rows: CsvRow[]): CheckerContext {
  return contextWith({ [name]: [...table(name), ...rows] });
}

type Validator = (params: unknown, ctx: CheckerContext) => unknown;

let sandbox: vm.Context | undefined;
/**
 * The V8 context checker.js runs in: fresh, with Date and Math.random removed, so any use of the
 * clock or of randomness throws instead of passing quietly.
 */
export function checkerSandbox(): vm.Context {
  if (!sandbox) {
    sandbox = vm.createContext({});
    vm.runInContext('delete globalThis.Date; delete Math.random;', sandbox);
    vm.runInContext(jobFile('checker.js'), sandbox, { filename: 'checker.js' });
  }
  return sandbox;
}

export function loadValidators(): Record<string, Validator> {
  return (checkerSandbox() as { validators: Record<string, Validator> }).validators;
}

/** Runs the task's validator on an end state and returns its parsed result. */
export function check(task: Task, ctx: CheckerContext): CheckResult {
  if (task.expected.kind !== 'end_state') throw new Error(`${task.id} has no end-state check`);
  const validator = loadValidators()[task.expected.validator];
  if (!validator) throw new Error(`No validator ${task.expected.validator}`);
  const result: unknown = JSON.parse(JSON.stringify(validator(task.expected.params, ctx)));
  return CheckResultSchema.parse(result);
}

export function paramsOf(task: Task): Record<string, unknown> {
  if (task.expected.kind !== 'end_state') throw new Error(`${task.id} has no params`);
  return task.expected.params;
}

/** The invoice row the ground truth says the agent should add. */
export function expectedInvoiceRow(task: Task): CsvRow {
  const params = paramsOf(task);
  const cell = (key: string) => String(params[key]);
  return {
    invoice_id: String(task.meta?.invoice_id),
    job_id: cell('job_id'),
    customer_id: cell('customer_id'),
    issue_date: cell('issue_date'),
    due_date: cell('due_date'),
    labor_cents: cell('labor_cents'),
    parts_cents: cell('parts_cents'),
    fees_cents: cell('fees_cents'),
    discount_cents: cell('discount_cents'),
    tax_cents: cell('tax_cents'),
    total_cents: cell('total_cents'),
  };
}

export interface ExpectedSlot {
  date: string;
  start_time: string;
  end_time: string;
  technician_ids: string[];
}

export function expectedSlot(task: Task): ExpectedSlot {
  return task.meta?.slot as unknown as ExpectedSlot;
}

/** A booking row for the task's request at the given technician, date and times. */
export function bookingRow(
  task: Task,
  slot: Omit<ExpectedSlot, 'technician_ids'> & { technician_id: string },
): CsvRow {
  const params = paramsOf(task);
  const request = rowWhere('requests.csv', 'request_id', String(params.request_id));
  return {
    booking_id: String(params.booking_id),
    request_id: String(params.request_id),
    technician_id: slot.technician_id,
    date: slot.date,
    start_time: slot.start_time,
    end_time: slot.end_time,
    zone: String(request.zone),
  };
}
