import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BLANK_ANSWERS, type DraftTurn, type MentorConfig } from '@architect/shared';
import { JobDrafting } from '../../src/drafting/drafter';
import { createEngineDeps } from '../../src/host/wiring';
import type { EngineHostDeps } from '../../src/loop/deps';
import { JobLibrary } from '../../src/loop/jobs';
import { DataPaths } from '../../src/loop/paths';
import { openEngineStore, type EngineStore } from '../../src/store/engine-store';
import { Vault } from '../../src/vault/vault';
import { FakeMentor } from '../fakes/adapters';
import { ManualClock } from '../fakes/clock';

/** A teacher on this computer, so no key is looked up and nothing is billed. */
export const TEACHER: MentorConfig = {
  kind: 'model',
  provider: 'lmstudio',
  label: 'Muse Spark 1.3',
  baseUrl: 'http://127.0.0.1:1234/v1',
  model: 'scripted-spark',
  reasoningEffort: 'medium',
};

export interface DraftingWorld {
  root: string;
  dataDir: string;
  paths: DataPaths;
  store: EngineStore;
  vault: Vault;
  jobs: JobLibrary;
  deps: EngineHostDeps;
  mentor: FakeMentor;
  clock: ManualClock;
  /**
   * The conversation as the app holds it. By default the person who holds it answers every question
   * Architect asks about a mark such as N/A or a dash with "Leave those rows out", which is what a
   * rule did with one before the question was asked, so a test that is about something else reads
   * as it always did. `marks: 'ask'` gives the conversation as it is, question and all.
   */
  drafting: Pick<JobDrafting, 'start' | 'reply'>;
  /** The teachers the conversation created a mentor for, one per call. */
  teachers: MentorConfig[];
  /** Writes a file the person attaches and returns where it is. */
  attach(name: string, content: string | Buffer): string;
  cleanup(): void;
}

/** Whether a turn is Architect asking what a mark such as N/A or a dash in a column means. */
export function isMarkQuestion(turn: DraftTurn): boolean {
  return (
    turn.draft === undefined &&
    turn.ended !== true &&
    /^In \S+, \S+ sometimes (?:says|has) /.test(turn.message)
  );
}

/** A person who answers each question about a mark the same way, whatever the mark. */
class AnsweringMarks implements Pick<JobDrafting, 'start' | 'reply'> {
  constructor(
    private readonly real: JobDrafting,
    private readonly answer: string,
  ) {}

  async start(description: string, files: string[], teacher: MentorConfig): Promise<DraftTurn> {
    return this.answered(await this.real.start(description, files, teacher), teacher);
  }

  async reply(sessionId: string, text: string, teacher: MentorConfig): Promise<DraftTurn> {
    return this.answered(await this.real.reply(sessionId, text, teacher), teacher);
  }

  private async answered(first: DraftTurn, teacher: MentorConfig): Promise<DraftTurn> {
    let turn = first;
    while (isMarkQuestion(turn)) turn = await this.real.reply(turn.sessionId, this.answer, teacher);
    return turn;
  }
}

/**
 * The real splitter, vault and job library over a temporary data folder, with a scripted teacher
 * in place of the model: the drafting conversation as the app runs it, with nothing else faked.
 */
export function draftingWorld(
  options: { capUsd?: number; marks?: 'ask' | 'leave_out' | 'zero' } = {},
): DraftingWorld {
  const root = mkdtempSync(join(tmpdir(), 'architect-drafting-'));
  const dataDir = join(root, 'data');
  const filesDir = join(root, 'attached');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(filesDir, { recursive: true });
  const mentor = new FakeMentor();
  const teachers: MentorConfig[] = [];
  const { marks = 'leave_out', ...rest } = options;
  const real = createEngineDeps({ dataDir, getSecret: async () => undefined });
  const deps: EngineHostDeps = {
    ...real,
    adapters: {
      ...real.adapters,
      createMentor: (config) => {
        teachers.push(config);
        return mentor;
      },
    },
  };
  const paths = new DataPaths(dataDir);
  const store = openEngineStore(paths.database);
  const clock = new ManualClock();
  const jobs = new JobLibrary(store, paths, deps, clock);
  const drafting = new JobDrafting({ jobs, deps, clock, ...rest });
  return {
    root,
    dataDir,
    paths,
    store,
    vault: new Vault(dataDir),
    jobs,
    deps,
    mentor,
    clock,
    drafting:
      marks === 'ask'
        ? drafting
        : new AnsweringMarks(
            drafting,
            marks === 'zero' ? BLANK_ANSWERS.zero : BLANK_ANSWERS.leave_out,
          ),
    teachers,
    attach(name, content) {
      const path = join(filesDir, name);
      writeFileSync(path, content);
      return path;
    },
    cleanup() {
      store.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}

/** A reply's job, as the teacher fills it. */
export interface JobFields {
  name: string;
  summary: string;
  description: string;
  does: string[];
  doesNot: string[];
  businessDate: string;
  passRate: number;
  files: object[];
  unresolved: string[];
  taskTypes: object[];
}

/** The fields of a reply's job that an action leaves empty. */
export const NO_JOB: JobFields = {
  name: '',
  summary: '',
  description: '',
  does: [],
  doesNot: [],
  businessDate: '',
  passRate: 0,
  files: [],
  unresolved: [],
  taskTypes: [],
};

/** The empty fields of a task type, which a template leaves unused. */
export const NO_TYPE = {
  id: '',
  label: '',
  description: '',
  template: '' as const,
  table: '',
  keyColumn: '',
  columns: [],
  filters: [],
  groupColumn: '',
  measure: '' as const,
  valueColumn: '',
  dateColumn: '',
  dateOrder: '' as const,
  unit: '' as const,
  request: '',
};

/** A question as the teacher sends it. */
export function question(message: string, options: string[]) {
  return { action: 'ask', message, options, job: NO_JOB };
}

/** A lookup of customers' emails, which the shop's files support 150 times. */
export const EMAIL_TYPE = {
  ...NO_TYPE,
  id: 'email',
  label: 'Customer emails',
  description: 'Look up the email of a customer.',
  template: 'lookup' as const,
  table: 'customers.csv',
  keyColumn: 'customer_id',
  columns: ['email'],
  request: 'What is the email of customer {key}?',
};

/** Which orders of a customer are still pending. */
export const PENDING_TYPE = {
  ...NO_TYPE,
  id: 'pending',
  label: 'Pending orders',
  description: 'List the pending orders of a customer.',
  template: 'filtered_list' as const,
  table: 'orders.csv',
  keyColumn: 'order_id',
  filters: [
    { column: 'status', op: 'equals' as const, value: 'Pending', varies: false },
    { column: 'customer_id', op: 'equals' as const, value: '', varies: true },
  ],
  request: 'Which orders of customer {customer_id} are still pending?',
};

/** The total of a region's orders within a range of dates. */
export const TOTAL_TYPE = {
  ...NO_TYPE,
  id: 'totals',
  label: 'Region totals',
  description: 'Add up the orders of a region between two dates.',
  template: 'group_total' as const,
  table: 'orders.csv',
  groupColumn: 'region',
  measure: 'sum' as const,
  valueColumn: 'amount',
  dateColumn: 'order_date',
  unit: 'as_written' as const,
  request: 'What is the total of orders in the {group} region from {from} to {to}?',
};

/** A draft as the teacher sends it. */
export function draft(overrides: Partial<JobFields> = {}) {
  return {
    action: 'draft',
    message: '',
    options: [],
    job: {
      name: 'Shop desk',
      summary: "Answers questions about the shop's customers and orders.",
      description:
        'Shop desk answers questions about the orders and customers of a small online shop, from its exported records.',
      does: ['Looks up a customer', "Lists a customer's pending orders"],
      doesNot: ['Changes any record'],
      businessDate: '2026-11-24',
      passRate: 0.9,
      files: [
        { name: 'customers.csv', description: 'One row per customer.', access: 'read' },
        { name: 'orders.csv', description: 'One row per order.', access: 'read' },
      ],
      unresolved: [],
      taskTypes: [EMAIL_TYPE, PENDING_TYPE, TOTAL_TYPE],
      ...overrides,
    },
  };
}
