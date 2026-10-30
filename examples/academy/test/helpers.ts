import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { CheckResultSchema, JobSchema, TaskSchema } from '@architect/shared';
import type { CheckResult, Job, JsonValue, Task } from '@architect/shared';
import { jobDir } from '../src';
import { parseCsv } from '../src/lib/csv';
import type { CsvRow } from '../src/lib/csv';
import { JobFiles } from '../src/reference/tools';

export const TODAY = '2026-11-16';

export interface CheckerContext {
  readTable(name: string): CsvRow[];
  readOriginalTable(name: string): CsvRow[];
  answer: JsonValue | null;
  finalText: string;
  toolCalls: [];
}

type Validator = (params: unknown, ctx: CheckerContext) => unknown;

/**
 * The committed job folder, read the way the runner reads it, with each organization's files
 * under orgs/<id>/data/. Until the engine binds a task to its organization by itself, these
 * helpers bind it here: a task's data is its organization's folder.
 */
export class JobFolder {
  readonly dir = jobDir;
  private tasks: Task[] | undefined;
  private readonly tables = new Map<string, CsvRow[]>();
  private readonly parsed = new Map<string, JobFiles>();
  private sandbox: vm.Context | undefined;

  file(path: string): string {
    return readFileSync(join(this.dir, ...path.split('/')), 'utf8');
  }

  job(): Job {
    return JobSchema.parse(JSON.parse(this.file('job.json')));
  }

  orgs(): string[] {
    return (this.job().organizations ?? []).map((org) => org.id);
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

  /** An organization's data folder, the one a task of it binds to. */
  dataDir(org: string): string {
    return join(this.dir, 'orgs', org, 'data');
  }

  /** A table of an organization as rows of strings (empty cells null), exactly as written. */
  table(org: string, name: string): CsvRow[] {
    const key = `${org}/${name}`;
    let rows = this.tables.get(key);
    if (!rows) {
      rows = parseCsv(this.file(`orgs/${org}/data/${name}`));
      this.tables.set(key, rows);
    }
    return rows;
  }

  /** Every file of an organization, the way the reference solutions' tools serve them. */
  data(org: string): JobFiles {
    let files = this.parsed.get(org);
    if (!files) {
      const names = readdirSync(this.dataDir(org));
      files = new JobFiles(
        new Map(names.map((name) => [name, this.file(`orgs/${org}/data/${name}`)])),
      );
      this.parsed.set(org, files);
    }
    return files;
  }

  /** A checker context for a task: its organization's tables, with `changed` swapped in. */
  contextWith(
    task: Task,
    changed: Record<string, CsvRow[]>,
    answer: JsonValue | null,
  ): CheckerContext {
    const org = orgOf(task);
    return {
      readTable: (name) => changed[name] ?? this.table(org, name),
      readOriginalTable: (name) => this.table(org, name),
      answer,
      finalText: answer === null ? '' : `ANSWER: ${JSON.stringify(answer)}`,
      toolCalls: [],
    };
  }

  /** The end state after appending rows to tables of the task's organization. */
  withAppended(
    task: Task,
    appended: Record<string, readonly CsvRow[]>,
    answer: JsonValue | null,
  ): CheckerContext {
    const org = orgOf(task);
    const changed = Object.fromEntries(
      Object.entries(appended).map(([name, rows]) => [name, [...this.table(org, name), ...rows]]),
    );
    return this.contextWith(task, changed, answer);
  }

  /** The V8 context checker.js runs in, with Date and Math.random removed. */
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

export function orgOf(task: Task): string {
  if (task.org === undefined) throw new Error(`${task.id} names no organization`);
  return task.org;
}

export function paramsOf(task: Task): Record<string, JsonValue> {
  if (task.expected.kind !== 'end_state') throw new Error(`${task.id} has no params`);
  return task.expected.params;
}
