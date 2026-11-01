import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HarnessVersions } from '@architect/harness';
import { emptyTotals, type Harness, type Job, type Task } from '@architect/shared';
import { createChecker } from '../../src/checker/checker';
import { runTaskAttempt } from '../../src/eval/evaluate';
import { DataPaths } from '../../src/loop/paths';
import { createSandbox } from '../../src/sandbox/sandbox';
import type { Sandbox } from '../../src/sandbox/types';
import { openEngineStore } from '../../src/store/engine-store';
import type { StoredAttempt } from '../../src/store/records';
import { importJobInto } from './field';
import { makeHarness } from './fixtures';
import { ScriptedStudent } from './scripted-student';

export const PASSED_RUN = 'run_passed';
const AT = '2026-11-01T12:00:00.000Z';

const readTasks = (file: string): Task[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Task);

/** The right answer to one of the Academy desk's diagnosis tasks, from its expected record. */
export function diagnosisAnswer(task: Task): string {
  const params = (task.expected as { params: Record<string, unknown> }).params;
  return `ANSWER: ${JSON.stringify({
    topic: params['topic'],
    correct: params['correct'],
    error: (params['errors'] as string[])[0],
  })}`;
}

/** One attempt through the runner: a call that fails, one that reads, then the answer given. */
export function scriptedAttempt(
  job: Job,
  jobDir: string,
  harness: Harness,
  sandbox: Sandbox,
  task: Task,
  final: string,
) {
  return runTaskAttempt(task, {
    job,
    jobDir,
    harness,
    student: new ScriptedStudent([
      { toolCalls: [{ name: 'read', arguments: { path: 'data/no-such-file.csv' } }] },
      { toolCalls: [{ name: 'read', arguments: { path: 'data/policy.md' } }] },
      { text: final },
    ]),
    sandbox,
    checker: createChecker({ job, jobDir, sandbox }),
    seed: 1,
  });
}

export interface PassedAttemptsWorld {
  job: Job;
  paths: DataPaths;
  harness: Harness;
  train: Task[];
  /** The rows written, each with its own trace file. */
  rows: StoredAttempt[];
}

/**
 * The Academy desk in a data folder, as the app imports it, with one finished run whose train
 * attempts at `count` diagnosis tasks the checker passed, beside one train attempt it failed and
 * one passing dev attempt, each with the trace the runner wrote. With `remoteTraining` the job
 * lets its demonstrations leave this computer, as its data-sharing setting says.
 */
export async function passedAttemptsWorld(
  dataDir: string,
  options: { count: number; remoteTraining: boolean },
): Promise<PassedAttemptsWorld> {
  const imported = await importJobInto(dataDir);
  const paths = new DataPaths(dataDir);
  const job: Job = options.remoteTraining
    ? { ...imported, sharing: { remoteTraining: true, corrections: false } }
    : imported;
  writeFileSync(paths.jobFile(job.id), `${JSON.stringify(job, null, 2)}\n`);
  const train = readTasks(paths.tasksFile(job.id, 'train'));
  const dev = readTasks(paths.tasksFile(job.id, 'dev'));
  const harness = await new HarnessVersions(paths.harnessDir(job.id, PASSED_RUN)).save(
    makeHarness(),
  );
  const row = (id: string, task: Task, split: 'train' | 'dev', pass: boolean): StoredAttempt => ({
    id,
    runId: PASSED_RUN,
    round: 1,
    taskId: task.id,
    taskType: task.type,
    split,
    harnessVersion: harness.meta.version,
    check: { pass, reason: pass ? 'Matches.' : 'Wrong topic.' },
    latencyMs: 10,
    usage: { inputTokens: 1, outputTokens: 1 },
    target: 'hosted',
    seed: 1,
    stopReason: 'answer',
    tracePath: `jobs/${job.id}/runs/${PASSED_RUN}/traces/${id}.json`,
    createdAt: AT,
  });
  const diagnoses = train.filter((task) => task.type === 'diagnose');
  const devTask = dev.find((task) => task.type === 'diagnose');
  if (diagnoses.length < options.count + 1 || devTask === undefined) {
    throw new Error('The Academy desk has too few diagnosis tasks for this world.');
  }
  const sandbox = createSandbox();
  const store = openEngineStore(paths.database);
  const rows: StoredAttempt[] = [];
  try {
    store.runs.insert({
      run: {
        id: PASSED_RUN,
        jobId: job.id,
        method: 'architect',
        seed: 7,
        status: 'finished',
        phase: 'done',
        createdAt: AT,
        updatedAt: AT,
        currentVersion: harness.meta.version,
        devBaseline: null,
        devCurrent: null,
        totals: emptyTotals(),
      },
      seeds: { trainBatch: 1, trainStudent: 2, devPanel: 3, test: 4, mentor: 5 },
      today: '2026-11-04',
      lockedTestOn: 'hosted',
      stopRequested: false,
      freeze: null,
    });
    const jobDir = paths.jobDir(job.id);
    const made: [StoredAttempt, Task][] = [
      ...diagnoses
        .slice(0, options.count)
        .map((task, index): [StoredAttempt, Task] => [
          row(`att_pass${index}`, task, 'train', true),
          task,
        ]),
      [row('att_fail', diagnoses[options.count]!, 'train', false), diagnoses[options.count]!],
      [row('att_dev', devTask, 'dev', true), devTask],
    ];
    for (const [stored, task] of made) {
      const result = await scriptedAttempt(
        job,
        jobDir,
        harness,
        sandbox,
        task,
        diagnosisAnswer(task),
      );
      const file = join(paths.root, ...stored.tracePath!.split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(result.trace));
      store.attempts.insert(stored);
      rows.push(stored);
    }
  } finally {
    store.close();
    await sandbox.dispose();
  }
  return { job, paths, harness, train, rows };
}
