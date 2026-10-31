import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { CheckResultSchema, JobSchema, TaskSchema } from '@architect/shared';
import type { CheckResult, Job, JsonValue, Task } from '@architect/shared';
import { jobDir } from '../src';
import { parseCsv } from '../src/lib/csv';
import type { CsvRow } from '../src/lib/csv';

export interface CheckerContext {
  readTable(name: string): CsvRow[];
  readOriginalTable(name: string): CsvRow[];
  answer: JsonValue | null;
  finalText: string;
  toolCalls: [];
}

type Validator = (params: unknown, ctx: CheckerContext) => unknown;

/**
 * The committed job folder, read the way the runner reads it, with each group's files under
 * orgs/<id>/data/. A task's data is its group's folder.
 */
export class JobFolder {
  readonly dir = jobDir;
  private tasks: Task[] | undefined;
  private readonly tables = new Map<string, CsvRow[]>();
  private readonly texts = new Map<string, Map<string, string>>();
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

  dataDir(org: string): string {
    return join(this.dir, 'orgs', org, 'data');
  }

  /** A table of a group as rows of strings (empty cells null), exactly as written. */
  table(org: string, name: string): CsvRow[] {
    const key = `${org}/${name}`;
    let rows = this.tables.get(key);
    if (!rows) {
      rows = parseCsv(this.file(`orgs/${org}/data/${name}`));
      this.tables.set(key, rows);
    }
    return rows;
  }

  /** Every file of a group by name, the way the reference solutions' tools serve them. */
  data(org: string): Map<string, string> {
    let files = this.texts.get(org);
    if (!files) {
      const names = readdirSync(this.dataDir(org));
      files = new Map(names.map((name) => [name, this.file(`orgs/${org}/data/${name}`)]));
      this.texts.set(org, files);
    }
    return files;
  }

  /** A checker context for a task: its group's tables, with rows appended to some of them. */
  withAppended(
    task: Task,
    appended: Record<string, readonly CsvRow[]>,
    answer: JsonValue | null,
  ): CheckerContext {
    const org = orgOf(task);
    return {
      readTable: (name) => [...this.table(org, name), ...(appended[name] ?? [])],
      readOriginalTable: (name) => this.table(org, name),
      answer,
      finalText: answer === null ? '' : `ANSWER: ${JSON.stringify(answer)}`,
      toolCalls: [],
    };
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
  if (task.org === undefined) throw new Error(`${task.id} names no group`);
  return task.org;
}

export function paramsOf(task: Task): Record<string, JsonValue> {
  if (task.expected.kind !== 'end_state') throw new Error(`${task.id} has no params`);
  return task.expected.params;
}
