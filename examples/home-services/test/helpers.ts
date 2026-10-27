import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { CheckResultSchema, TaskSchema } from '@architect/shared';
import type { CheckResult, Task } from '@architect/shared';
import { jobDir } from '../src';
import type { JobVersion } from '../src';
import { parseCsv } from '../src/lib/csv';
import type { CsvRow } from '../src/lib/csv';
import type { Booking, ServiceRequest, Technician, TravelTime } from '../src/company/types';
import { parseJobData } from '../src/reference/read-tools';
import type { JobData } from '../src/reference/read-tools';
import { buildSchedule } from '../src/reference/scheduling';
import type { Schedule, SchedulingRules } from '../src/reference/scheduling';

export const BUSINESS_DATE = '2026-11-05';

export interface CheckerContext {
  readTable(name: string): CsvRow[];
  readOriginalTable(name: string): CsvRow[];
  answer: null;
  finalText: string;
  toolCalls: [];
}

type Validator = (params: unknown, ctx: CheckerContext) => unknown;

/** A committed job folder, read the way the runner would read it. Tables and tasks parse once. */
export class JobFolder {
  readonly dir: string;
  private tasks: Task[] | undefined;
  private readonly tables = new Map<string, CsvRow[]>();
  private sandbox: vm.Context | undefined;
  private parsed: JobData | undefined;

  constructor(readonly version: JobVersion) {
    this.dir = jobDir(version);
  }

  file(path: string): string {
    return readFileSync(join(this.dir, ...path.split('/')), 'utf8');
  }

  allTasks(): Task[] {
    this.tasks ??= this.file('tasks.jsonl')
      .trimEnd()
      .split('\n')
      .map((line) => TaskSchema.parse(JSON.parse(line)));
    return this.tasks;
  }

  tasksOfType(type: string): Task[] {
    return this.allTasks().filter((task) => task.type === type);
  }

  task(id: string): Task {
    const task = this.allTasks().find((t) => t.id === id);
    if (!task) throw new Error(`No task ${id} in version ${this.version}`);
    return task;
  }

  /** A data table as rows of strings (empty cells null). Treat it as read-only. */
  table(name: string): CsvRow[] {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = parseCsv(this.file(`data/${name}`));
      this.tables.set(name, rows);
    }
    return rows;
  }

  /** The single row whose `column` equals `value`. */
  rowWhere(name: string, column: string, value: string): CsvRow {
    const matches = this.rowsWhere(name, column, value);
    if (matches.length !== 1) {
      throw new Error(`${matches.length} rows in ${name} with ${column}=${value}`);
    }
    return matches[0] as CsvRow;
  }

  rowsWhere(name: string, column: string, value: string): CsvRow[] {
    return this.table(name).filter((row) => row[column] === value);
  }

  /** Every file in data/, the way the reference solutions' read tools serve them. */
  data(): JobData {
    this.parsed ??= parseJobData(
      new Map(readdirSync(join(this.dir, 'data')).map((name) => [name, this.file(`data/${name}`)])),
    );
    return this.parsed;
  }

  /** A checker context whose end state is the original data with `changed` tables swapped in. */
  contextWith(changed: Record<string, CsvRow[]>): CheckerContext {
    return {
      readTable: (name) => changed[name] ?? this.table(name),
      readOriginalTable: (name) => this.table(name),
      answer: null,
      finalText: '',
      toolCalls: [],
    };
  }

  /** The end state after appending `rows` to one table. */
  withAppended(name: string, ...rows: CsvRow[]): CheckerContext {
    return this.contextWith({ [name]: [...this.table(name), ...rows] });
  }

  /**
   * The V8 context the folder's checker.js runs in: fresh, with Date and Math.random removed, so
   * any use of the clock or of randomness throws instead of passing quietly.
   */
  checkerSandbox(): vm.Context {
    if (!this.sandbox) {
      this.sandbox = vm.createContext({});
      vm.runInContext('delete globalThis.Date; delete Math.random;', this.sandbox);
      vm.runInContext(this.file('checker.js'), this.sandbox, { filename: 'checker.js' });
    }
    return this.sandbox;
  }

  /** Runs the task's validator on an end state and returns its parsed result. */
  check(task: Task, ctx: CheckerContext): CheckResult {
    if (task.expected.kind !== 'end_state') throw new Error(`${task.id} has no end-state check`);
    const validators = (this.checkerSandbox() as { validators: Record<string, Validator> })
      .validators;
    const validator = validators[task.expected.validator];
    if (!validator) throw new Error(`No validator ${task.expected.validator}`);
    const result: unknown = JSON.parse(JSON.stringify(validator(task.expected.params, ctx)));
    return CheckResultSchema.parse(result);
  }

  /** A booking row for the task's request at the given technician, date and times. */
  bookingRow(task: Task, slot: Omit<ExpectedSlot, 'technician_ids'> & { technician_id: string }) {
    const params = paramsOf(task);
    const request = this.rowWhere('requests.csv', 'request_id', String(params.request_id));
    const row: CsvRow = {
      booking_id: String(params.booking_id),
      request_id: String(params.request_id),
      technician_id: slot.technician_id,
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
      zone: String(request.zone),
    };
    return row;
  }
}

export const firstVersion = new JobFolder(1);
export const latestVersion = new JobFolder(2);
export const BOTH_VERSIONS = [firstVersion, latestVersion] as const;

export function paramsOf(task: Task): Record<string, unknown> {
  if (task.expected.kind !== 'end_state') throw new Error(`${task.id} has no params`);
  return task.expected.params;
}

export function answerOf(task: Task): Record<string, unknown> {
  if (task.expected.kind !== 'answer') throw new Error(`${task.id} is not an answer task`);
  return task.expected.value as Record<string, unknown>;
}

export function trapsOf(task: Task): string[] {
  return task.meta?.traps as string[];
}

/** The invoice row the ground truth says the agent should add. */
export function expectedInvoiceRow(task: Task): CsvRow {
  const params = paramsOf(task);
  const cell = (key: string) => String(params[key]);
  return {
    invoice_id: cell('invoice_id'),
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

/** The scheduling rules policy.md states, for the reference search. */
export const SCHEDULING_RULES: SchedulingRules = {
  businessDate: BUSINESS_DATE,
  closedDates: ['2026-11-11'],
  slotMinutes: 30,
  noon: 12 * 60,
};

/** A folder's scheduling tables as typed records, for the reference search. */
export function referenceSchedule(job: JobFolder): Schedule {
  const list = (cell: string | null | undefined) => (cell ? cell.split(';') : []);
  return buildSchedule(
    job.table('technicians.csv').map(
      (row) =>
        ({
          ...row,
          skills: list(row.skills),
          licenses: list(row.licenses),
          work_days: list(row.work_days),
        }) as unknown as Technician,
    ),
    job.table('bookings.csv') as unknown as Booking[],
    job
      .table('travel.csv')
      .map((row) => ({ ...row, minutes: Number(row.minutes) }) as unknown as TravelTime),
  );
}

/** The request a scheduling task books, as a typed record. */
export function requestOf(job: JobFolder, task: Task): ServiceRequest {
  const row = job.rowWhere('requests.csv', 'request_id', String(paramsOf(task).request_id));
  return { ...row, duration_minutes: Number(row.duration_minutes) } as unknown as ServiceRequest;
}
