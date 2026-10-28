import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { CheckResultSchema, JobSchema, TaskSchema } from '@architect/shared';
import type { CheckResult, Job, JsonValue, Task } from '@architect/shared';
import { jobDir } from '../src';
import { parseCsv } from '../src/lib/csv';
import type { CsvRow } from '../src/lib/csv';
import { parseJobData } from '../src/reference/tools';
import type { JobData } from '../src/reference/tools';

export const BUSINESS_DATE = '2026-11-24';

/** The tables an export wrote, where some values may be written another way. */
export const MESSY_TABLES = [
  'customers.csv',
  'products.csv',
  'orders.csv',
  'order_lines.csv',
  'returns.csv',
  'pickups.csv',
] as const;

export interface CheckerContext {
  readTable(name: string): CsvRow[];
  readOriginalTable(name: string): CsvRow[];
  answer: JsonValue | null;
  finalText: string;
  toolCalls: [];
}

type Validator = (params: unknown, ctx: CheckerContext) => unknown;

/** The committed job folder, read the way the runner reads it. Tables and tasks parse once. */
export class JobFolder {
  readonly dir = jobDir;
  private tasks: Task[] | undefined;
  private readonly tables = new Map<string, CsvRow[]>();
  private sandbox: vm.Context | undefined;
  private parsed: JobData | undefined;

  file(path: string): string {
    return readFileSync(join(this.dir, ...path.split('/')), 'utf8');
  }

  job(): Job {
    return JobSchema.parse(JSON.parse(this.file('job.json')));
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

  /** A data table as rows of strings (empty cells null), exactly as written. Read-only. */
  table(name: string): CsvRow[] {
    let rows = this.tables.get(name);
    if (!rows) {
      rows = parseCsv(this.file(`data/${name}`));
      this.tables.set(name, rows);
    }
    return rows;
  }

  /** Every file in data/, the way the reference solutions' tools serve them. */
  data(): JobData {
    this.parsed ??= parseJobData(
      new Map(readdirSync(join(this.dir, 'data')).map((name) => [name, this.file(`data/${name}`)])),
    );
    return this.parsed;
  }

  /** A checker context whose end state is the original data with `changed` tables swapped in. */
  contextWith(changed: Record<string, CsvRow[]>, answer: JsonValue | null = null): CheckerContext {
    return {
      readTable: (name) => changed[name] ?? this.table(name),
      readOriginalTable: (name) => this.table(name),
      answer,
      finalText: answer === null ? '' : `ANSWER: ${JSON.stringify(answer)}`,
      toolCalls: [],
    };
  }

  /** The end state after appending `rows` to one table, with this ANSWER. */
  withAppended(name: string, rows: CsvRow[], answer: JsonValue | null = null): CheckerContext {
    return this.contextWith({ [name]: [...this.table(name), ...rows] }, answer);
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
}

export const job = new JobFolder();

export function paramsOf(task: Task): Record<string, JsonValue> {
  if (task.expected.kind !== 'end_state') throw new Error(`${task.id} has no params`);
  return task.expected.params;
}

export function trapsOf(task: Task): string[] {
  return task.meta?.traps as string[];
}

/** The returns.csv row the ground truth says a refund task adds. */
export function expectedReturnRow(task: Task): CsvRow {
  const params = paramsOf(task);
  const cell = (key: string) => (params[key] === null ? null : String(params[key]));
  return Object.fromEntries(
    Object.keys(job.table('returns.csv')[0] ?? {}).map((column) => [column, cell(column)]),
  );
}

/** The pickups.csv row the ground truth says a pickup task adds. */
export function expectedPickupRow(task: Task): CsvRow {
  const params = paramsOf(task);
  return {
    pickup_id: String(params.pickup_id),
    return_id: String(params.return_id),
    carrier: String(params.carrier),
    pickup_date: String(params.pickup_date),
    booked_on: String(params.booked_on),
  };
}

/** The ANSWER a refund task expects. */
export function expectedReturnAnswer(task: Task): JsonValue {
  const params = paramsOf(task);
  return {
    decision: params.decision ?? null,
    refund_cents: params.refund_cents ?? null,
    refund_to: params.refund_to ?? null,
  };
}

/** The ANSWER an order task expects. */
export function expectedOrderAnswer(task: Task): Record<string, JsonValue> {
  return paramsOf(task).answer as Record<string, JsonValue>;
}
