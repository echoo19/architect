import { fileURLToPath } from 'node:url';
import { createChecker, createSandbox, createToolbox, openAgentFiles } from '@architect/engine';
import { HarnessSchema } from '@architect/shared';
import type { CheckOutcome, JsonValue, Task } from '@architect/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildAcademy, buildRecordTasks, readAcademyFolder } from '../src';
import { parseCsv } from '../src/lib/csv';
import type { CsvRow } from '../src/lib/csv';
import { readPolicy, topicHistory } from '../src/reference/rules';
import { assign, diagnoseRecord, history } from '../src/reference/solver';
import { AgentTools, JobFiles } from '../src/reference/tools';
import type { AssignRequest, HistoryRequest, WrongAnswer } from '../src/tasks/records';
import { job, paramsOf, todayOf } from './helpers';
import type { CheckerContext } from './helpers';

/**
 * Tasks from an academy folder that has records but no question text, errors, hints, videos,
 * staff list or staff notes, the way a real academy's anonymized export arrives.
 */

const dir = fileURLToPath(new URL('./fixtures/records/', import.meta.url));
const files = readAcademyFolder(dir);
const AS_OF = '2026-10-31';
const options = { org: 'fixture', seed: 7, asOf: AS_OF };
const tasks = buildRecordTasks(files, options);

function solve(task: Task, folder: ReadonlyMap<string, string> = files, asOf = AS_OF) {
  const tools = new AgentTools(new JobFiles(folder), asOf);
  const request = task.meta?.request as unknown;
  const answer =
    task.type === 'diagnose'
      ? diagnoseRecord(tools, request as WrongAnswer)
      : task.type === 'history'
        ? history(tools, request as HistoryRequest)
        : assign(tools, request as AssignRequest);
  return { tools, answer };
}

/** A checker context on a folder's tables; a table the folder lacks throws, as in the runner. */
function context(
  appended: readonly CsvRow[],
  answer: JsonValue,
  folder: ReadonlyMap<string, string> = files,
): CheckerContext {
  const table = (name: string): CsvRow[] => {
    const text = folder.get(name);
    if (text === undefined) throw new Error(`There is no table ${name}.`);
    return parseCsv(text);
  };
  return {
    readTable: (name) => (name === 'assignments.csv' ? [...table(name), ...appended] : table(name)),
    readOriginalTable: table,
    answer,
    finalText: `ANSWER: ${JSON.stringify(answer)}`,
    toolCalls: [],
  };
}

describe('tasks from an academy folder without question text', () => {
  it('are the skills its records support, the same for the same seed and date', () => {
    expect(new Set(tasks.map((t) => t.type))).toEqual(new Set(['diagnose', 'history', 'assign']));
    expect(buildRecordTasks(files, options)).toEqual(tasks);
    for (const task of tasks) {
      expect(task.org).toBe('fixture');
      expect(task.id.startsWith('fixture-'), task.id).toBe(true);
      expect(task.prompt.startsWith("It's Saturday, October 31, 2026."), task.id).toBe(true);
    }
  });

  it('diagnose only the topic and the right choice', () => {
    const diagnoses = tasks.filter((t) => t.type === 'diagnose');
    expect(diagnoses.length).toBeGreaterThan(0);
    for (const task of diagnoses) {
      expect(Object.keys(paramsOf(task)).sort(), task.id).toEqual(['correct', 'topic']);
      expect(task.prompt, task.id).not.toMatch(/error/);
    }
  });

  it('number the first assignment A-0001 when the file has none', () => {
    const assigns = tasks.filter((t) => t.type === 'assign');
    expect(assigns.length).toBeGreaterThan(0);
    const first = assigns.find((t) => Number(paramsOf(t).expected_count) > 0)!;
    expect((paramsOf(first).assignment_ids as string[])[0]).toBe('A-0001');
  });

  it('are passed by the reference and failed by a wrong answer, with no staff notes file', () => {
    passedByTheReference(tasks, files);
  });

  it('come up to the count asked for of each skill', () => {
    const few = buildRecordTasks(files, { ...options, perSkill: 2 });
    for (const skill of ['diagnose', 'history', 'assign']) {
      expect(
        few.filter((t) => t.type === skill),
        skill,
      ).toHaveLength(2);
    }
    // More than the eight a skill had at most, from an academy with records enough for them.
    const academy = readAcademyFolder(job.dataDir('bramble'));
    const many = buildRecordTasks(academy, {
      org: 'bramble',
      seed: 7,
      asOf: todayOf(job.allTasks().find((t) => t.org === 'bramble')!),
      perSkill: 12,
    });
    for (const skill of ['diagnose', 'history', 'assign']) {
      expect(
        many.filter((t) => t.type === skill),
        skill,
      ).toHaveLength(12);
    }
  });

  it('name no module when the records leave it blank', () => {
    const blank = new Map([
      ...files,
      ['attempts.csv', blankColumn(files.get('attempts.csv')!, 'module')],
      ['tests.csv', blankColumn(files.get('tests.csv')!, 'module')],
    ]);
    const built = buildRecordTasks(blank, options);
    const diagnoses = built.filter((t) => t.type === 'diagnose');
    expect(diagnoses.length).toBeGreaterThan(0);
    for (const task of diagnoses) {
      expect(task.prompt, task.id).not.toMatch(/module/);
      expect(task.prompt, task.id).toMatch(/question \d+ of (Math|Reading and Writing) on /);
    }
    passedByTheReference(built, blank);
  });

  it('work from a policy without the escalation days or the first hint', () => {
    const policy = files
      .get('policy.md')!
      .split('\n')
      .filter((line) => !/^\| (Days those wrong answers|First hint) /.test(line))
      .join('\n');
    const shorter = new Map([...files, ['policy.md', policy]]);
    const built = buildRecordTasks(shorter, options);
    expect(new Set(built.map((t) => t.type))).toEqual(new Set(['diagnose', 'history', 'assign']));
    passedByTheReference(built, shorter);
    // Without the days, the wrong answers that call for a note are counted over the window:
    // two wrong answers a month back call for one, where a 14-day count would not.
    const policyRead = readPolicy(policy);
    expect(policyRead).toMatchObject({ escalateDays: null, hintRule: null, window: 3 });
    const rows = ['2026-09-20', '2026-09-21', '2026-09-22'].map((taken_on, i) => ({
      taken_on,
      module: '1',
      number: String(i + 1),
      question_id: `Q${i}`,
      result: i === 1 ? 'right' : 'wrong',
    }));
    expect(topicHistory(rows, policyRead, AS_OF).escalate).toBe(true);
    expect(topicHistory(rows, readPolicy(files.get('policy.md')!), AS_OF).escalate).toBe(false);
  });
});

describe('tasks from an export with full tests, labels written several ways and grid-ins', () => {
  // A generated academy laid out like a real one: tests listed as "Full", and only its records.
  const { academy, files: all } = buildAcademy(2088);
  const records = new Map(
    [...all].filter(([name]) =>
      [
        'policy.md',
        'students.csv',
        'questions.csv',
        'tests.csv',
        'attempts.csv',
        'assignments.csv',
      ].includes(name),
    ),
  );
  const asOf = academy.style.today;
  const exported = buildRecordTasks(records, { org: 'export', seed: 3, asOf });

  it('are built from its records alone, asking about questions on its "Full" tests', () => {
    expect(academy.style.layout).toBe('full');
    expect(exported).toHaveLength(24);
    for (const task of exported) expect(task.prompt.startsWith(`It's `), task.id).toBe(true);
  });

  it('are passed by the reference', () => {
    passedByTheReference(exported, records, asOf);
  });
});
/** Every task is passed by the reference, and a diagnosis with the wrong choice is failed. */
function passedByTheReference(
  built: readonly Task[],
  folder: ReadonlyMap<string, string>,
  asOf = AS_OF,
) {
  for (const task of built) {
    const { tools, answer } = solve(task, folder, asOf);
    if (task.expected.kind === 'facts') {
      for (const fact of task.expected.facts) {
        expect((answer as Record<string, unknown>)[fact.path], task.id).toEqual(fact.value);
      }
      continue;
    }
    const rows = [...tools.appendedTo('assignments.csv')];
    expect(job.check(task, context(rows, answer, folder)), task.id).toMatchObject({ pass: true });
    if (task.type === 'diagnose') {
      const wrong = { ...(answer as Record<string, JsonValue>), correct: 'Z' };
      expect(job.check(task, context(rows, wrong, folder)).reason).toMatch(/^correct is/);
    }
  }
}

/** A CSV with one column's cells left blank, as an export that doesn't record it. */
function blankColumn(text: string, column: string): string {
  const [header = '', ...rows] = text.trimEnd().split('\n');
  const at = header.split(',').indexOf(column);
  return `${[
    header,
    ...rows.map((row) =>
      row
        .split(',')
        .map((cell, i) => (i === at ? '' : cell))
        .join(','),
    ),
  ].join('\n')}\n`;
}

describe("tasks from an academy folder through the runner's tools", () => {
  const sandbox = createSandbox();
  // Every file the job declares: the optional ones this folder lacks are simply not there.
  const declared = job.job().data.files;
  const checker = createChecker({
    job: job.job(),
    jobDir: job.dir,
    sandbox,
  });
  const harness = HarnessSchema.parse({
    meta: { format: 2, name: 'Academy desk', version: 0, hash: '' },
    system: 'You are the Academy desk, the staff-facing academy agent.',
    retrieval: {},
    decoding: {},
    guardrails: {},
  });
  afterAll(() => sandbox.dispose());

  it('get back exactly the text the model of the tools gives, and pass every task', async () => {
    for (const task of tasks) {
      const { tools, answer } = solve(task);
      const agentFiles = await openAgentFiles({ dataDir: dir, files: declared, mode: 'scratch' });
      const toolbox = createToolbox({ harness, files: agentFiles, sandbox, today: AS_OF });
      for (const [index, call] of tools.calls.entries()) {
        const outcome = await toolbox.run({
          id: `call_${index}`,
          name: call.name,
          arguments: call.arguments,
        });
        expect(outcome.content, `${task.id}, call ${index + 1}`).toBe(call.content);
      }
      const outcome: CheckOutcome = {
        finalText: `ANSWER: ${JSON.stringify(answer)}`,
        answer,
        toolCalls: [],
        stopReason: 'answer',
      };
      expect(await checker.check(task, outcome, agentFiles), task.id).toMatchObject({
        pass: true,
      });
    }
  }, 120_000);
});
