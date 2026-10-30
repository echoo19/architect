import { fileURLToPath } from 'node:url';
import { createChecker, createSandbox, createToolbox, openAgentFiles } from '@architect/engine';
import { HarnessSchema } from '@architect/shared';
import type { CheckOutcome, JsonValue, Task } from '@architect/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { buildAcademy, buildRecordTasks, readAcademyFolder } from '../src';
import { parseCsv } from '../src/lib/csv';
import type { CsvRow } from '../src/lib/csv';
import { assign, diagnoseRecord, history } from '../src/reference/solver';
import { AgentTools, JobFiles } from '../src/reference/tools';
import type { AssignRequest, HistoryRequest, WrongAnswer } from '../src/tasks/records';
import { job, paramsOf } from './helpers';
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
    for (const task of tasks) {
      const { tools, answer } = solve(task);
      if (task.expected.kind === 'facts') {
        for (const fact of task.expected.facts) {
          expect((answer as Record<string, unknown>)[fact.path], task.id).toEqual(fact.value);
        }
        continue;
      }
      const rows = [...tools.appendedTo('assignments.csv')];
      expect(job.check(task, context(rows, answer)), task.id).toMatchObject({ pass: true });
      if (task.type === 'diagnose') {
        const wrong = { ...(answer as Record<string, JsonValue>), correct: 'Z' };
        expect(job.check(task, context(rows, wrong)).reason).toMatch(/^correct is/);
      }
    }
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
    for (const task of exported) {
      const { tools, answer } = solve(task, records, asOf);
      if (task.expected.kind === 'facts') {
        for (const fact of task.expected.facts) {
          expect((answer as Record<string, unknown>)[fact.path], task.id).toEqual(fact.value);
        }
        continue;
      }
      const rows = [...tools.appendedTo('assignments.csv')];
      expect(job.check(task, context(rows, answer, records)), task.id).toMatchObject({
        pass: true,
      });
    }
  });
});

describe("tasks from an academy folder through the runner's tools", () => {
  const sandbox = createSandbox();
  // The job's files, less the ones this folder doesn't have.
  const declared = job.job().data.files.filter((file) => files.has(file.name));
  const checker = createChecker({
    job: { ...job.job(), data: { files: declared } },
    jobDir: job.dir,
    sandbox,
  });
  const harness = HarnessSchema.parse({
    meta: { format: 2, name: 'Phil', version: 0, hash: '' },
    system: 'You are Phil, the academy tutor.',
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
