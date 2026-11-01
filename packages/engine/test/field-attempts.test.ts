import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessVersions } from '@architect/harness';
import {
  emptyTotals,
  FieldExportManifestSchema,
  type Harness,
  type Job,
  type Task,
  type Trace,
} from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChecker } from '../src/checker/checker';
import { runTaskAttempt } from '../src/eval/evaluate';
import { attemptEpisodes, loadPassedAttempts, type PassedAttempt } from '../src/field/attempts';
import { datasetFromExport, ExportDatasetError } from '../src/field/dataset';
import { exportField, fieldSource } from '../src/field/export';
import { DataPaths } from '../src/loop/paths';
import { createSandbox } from '../src/sandbox/sandbox';
import type { Sandbox } from '../src/sandbox/types';
import { openEngineStore } from '../src/store/engine-store';
import type { StoredAttempt } from '../src/store/records';
import { toolSpecs } from '../src/tools/toolbox';
import { Vault } from '../src/vault/vault';
import { importJobInto } from './support/field';
import { makeHarness } from './support/fixtures';
import { ScriptedStudent } from './support/scripted-student';

const AT = '2026-11-01T12:00:00.000Z';
const RUN = 'run_passed';

let root: string;
let paths: DataPaths;
let job: Job;
let train: Task[];
let dev: Task[];
let sandbox: Sandbox;
/** The harness as its run saved it, so its hash is the one the attempts ran with. */
let harness: Harness;

const readTasks = (file: string): Task[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Task);

/** The right answer to a diagnosis task, from its expected record. */
function answer(task: Task): string {
  const params = (task.expected as { params: Record<string, unknown> }).params;
  return `ANSWER: ${JSON.stringify({
    topic: params['topic'],
    correct: params['correct'],
    error: (params['errors'] as string[])[0],
  })}`;
}

/** One attempt through the runner: a call that fails, one that reads, then the answer given. */
async function attempt(task: Task, final: string) {
  return runTaskAttempt(task, {
    job,
    jobDir: paths.jobDir(job.id),
    harness,
    student: new ScriptedStudent([
      { toolCalls: [{ name: 'read', arguments: { path: 'data/no-such-file.csv' } }] },
      { toolCalls: [{ name: 'read', arguments: { path: 'data/policy.md' } }] },
      { text: final },
    ]),
    sandbox,
    checker: createChecker({ job, jobDir: paths.jobDir(job.id), sandbox }),
    seed: 1,
  });
}

function stored(id: string, task: Task, split: 'train' | 'dev', pass: boolean): StoredAttempt {
  return {
    id,
    runId: RUN,
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
    tracePath: `jobs/${job.id}/runs/${RUN}/traces/${id}.json`,
    createdAt: AT,
  };
}

/** A passing train attempt as the loader hands it over, for the builder's own checks. */
async function passed(id: string, change: Partial<PassedAttempt> = {}): Promise<PassedAttempt> {
  const task = train.find((candidate) => candidate.type === 'diagnose')!;
  const result = await attempt(task, answer(task));
  expect(result.check.pass, result.check.reason).toBe(true);
  return {
    attempt: stored(id, task, 'train', true),
    trace: result.trace,
    harness,
    writable: true,
    dataHashes: result.trace.replay!.data,
    ...change,
  };
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'architect-field-attempts-'));
  job = await importJobInto(join(root, 'data'));
  paths = new DataPaths(join(root, 'data'));
  train = readTasks(paths.tasksFile(job.id, 'train'));
  dev = readTasks(paths.tasksFile(job.id, 'dev'));
  harness = await new HarnessVersions(paths.harnessDir(job.id, RUN)).save(makeHarness());
  sandbox = createSandbox();
});

afterAll(async () => {
  await sandbox.dispose();
  rmSync(root, { recursive: true, force: true });
});

describe("the student's passing train attempts as demonstrations", () => {
  it('become episodes whose targets skip the turn whose tool call failed', async () => {
    const shared = { ...job, sharing: { remoteTraining: true, corrections: false } };
    const item = await passed('att_one');
    const { episodes, leftOut } = attemptEpisodes(shared, [item]);
    expect(leftOut).toEqual([]);
    const [episode] = episodes;
    const trace = item.trace as Trace;
    const assistant = trace.messages.flatMap((message, index) =>
      message.role === 'assistant' ? [index] : [],
    );
    expect(assistant).toHaveLength(3);
    // The first call read a file that isn't there: it is context, not a target.
    expect(episode?.verifiedTurns).toEqual(assistant.slice(1));
    expect(episode).toMatchObject({
      id: 'att_one',
      kind: 'passed_attempt',
      category: 'diagnose',
      origin: { kind: 'task', split: 'train' },
      tools: toolSpecs(harness, true),
      check: { pass: true },
      template: {
        reasoningStrength: harness.decoding.thinking,
        currentDate: trace.replay!.today,
      },
      provenance: {
        jobId: job.id,
        runId: RUN,
        attemptId: 'att_one',
        studentModel: 'scripted-student',
      },
      sharing: { remoteTraining: true },
    });
    expect(Object.values(episode!.provenance.inputHashes ?? {})[0]).toMatch(/^[0-9a-f]{64}$/);
    // Without the job's leave to train off this computer, the episode says so.
    expect(attemptEpisodes(job, [item]).episodes[0]?.sharing.remoteTraining).toBe(false);
  });

  it('leaves out an attempt whose conversation may not be what the student read', async () => {
    const item = await passed('att_two');
    const trace = item.trace as Trace;
    const cases: [PassedAttempt, string][] = [
      [{ ...item, trace: { nonsense: true } }, "its trace can't be read"],
      [{ ...item, trace: { ...trace, replay: undefined } }, 'made before traces recorded'],
      [{ ...item, harness: null }, "isn't the one it ran with"],
      [
        { ...item, harness: { ...harness, meta: { ...harness.meta, hash: 'sha256-other' } } },
        "isn't the one it ran with",
      ],
      [{ ...item, dataHashes: { 'data/policy.md': 'sha256-0' } }, 'files have changed'],
      [
        {
          ...item,
          trace: { ...trace, cleared: [{ turn: 2, callId: 'c', name: 'read', stub: '…' }] },
        },
        'taken out of its view',
      ],
    ];
    for (const [given, why] of cases) {
      const { episodes, leftOut } = attemptEpisodes(job, [given]);
      expect(episodes).toEqual([]);
      expect(leftOut).toHaveLength(1);
      expect(leftOut[0]?.what).toBe('attempt att_two');
      expect(leftOut[0]?.why).toContain(why);
    }
  });

  it("are read from the job's runs: passing train attempts only, never dev ones", async () => {
    const store = openEngineStore(paths.database);
    try {
      store.runs.insert({
        run: {
          id: RUN,
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
      const [diagnosis, other] = train.filter((task) => task.type === 'diagnose');
      const devTask = dev.find((task) => task.type === 'diagnose')!;
      const right = await attempt(diagnosis!, answer(diagnosis!));
      const rows: [StoredAttempt, Trace][] = [
        [stored('att_pass', diagnosis!, 'train', true), right.trace],
        [stored('att_fail', other!, 'train', false), right.trace],
        [stored('att_dev', devTask, 'dev', true), (await attempt(devTask, answer(devTask))).trace],
      ];
      for (const [row, trace] of rows) {
        const file = join(paths.root, ...row.tracePath!.split('/'));
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, JSON.stringify(trace));
        store.attempts.insert(row);
      }

      const loaded = await loadPassedAttempts(store, paths, job, train);
      expect(loaded.map((item) => item.attempt.id)).toEqual(['att_pass']);
      expect(loaded[0]?.harness?.meta.hash).toBe(harness.meta.hash);
      expect(loaded[0]?.dataHashes).toEqual(right.trace.replay!.data);
      // The Academy desk may append to its staff notes, so the write tools were offered.
      expect(loaded[0]?.writable).toBe(true);

      // The Academy desk keeps its data on this computer, so the export lists it and holds none.
      const source = await fieldSource(store, paths, job.id);
      expect(source.episodes).toHaveLength(1);
      const out = join(mkdtempSync(join(root, 'out-')), 'export');
      const manifest = exportField(source, out);
      expect(manifest.counts.demonstrations).toBe(0);
      expect(manifest.left_out).toContainEqual({
        what: 'demonstration att_pass',
        why: 'its data may not leave this computer',
      });
      expect(() => datasetFromExport(out)).toThrow(
        'has no demonstrations to train on: its data may not leave this computer',
      );
    } finally {
      store.close();
    }
  });
});

describe('a training dataset from a field export', () => {
  async function exported(): Promise<string> {
    const shared = { ...job, sharing: { remoteTraining: true, corrections: false } };
    const { episodes } = attemptEpisodes(shared, [await passed('att_three')]);
    const out = join(mkdtempSync(join(root, 'out-')), 'export');
    exportField(
      {
        job: shared,
        jobDir: paths.jobDir(job.id),
        trainTasks: train,
        episodes,
        vault: new Vault(paths.root),
      },
      out,
    );
    return out;
  }

  it("is the export's demonstrations as the dataset builder wrote them, verdicts and uses dropped", async () => {
    const out = await exported();
    const { dataset, manifest } = datasetFromExport(out);
    expect(manifest.job.id).toBe(job.id);
    expect(dataset.manifest).toMatchObject({
      example_count: 1,
      remote_training_allowed: true,
      kinds: { passed_attempt: 1 },
      categories: { diagnose: 1 },
    });
    expect(dataset.manifest.trained_turns).toBe(2);
    const [line] = dataset.jsonl.trimEnd().split('\n');
    const example = JSON.parse(line!) as Record<string, unknown>;
    expect(example).not.toHaveProperty('verdict');
    expect(example).not.toHaveProperty('permitted_uses');
    expect(createHash('sha256').update(dataset.jsonl).digest('hex')).toBe(
      dataset.manifest.examples_sha256,
    );
  });

  it('refuses an export whose demonstrations changed after it, or that permits no training off this computer', async () => {
    const out = await exported();
    const file = join(out, 'sft', 'demonstrations.jsonl');
    const text = readFileSync(file, 'utf8');
    writeFileSync(file, text.replace('"passed_attempt"', '"practice"'));
    expect(() => datasetFromExport(out)).toThrow('changed after the export');

    const relisted = text.replace(
      /"permitted_uses":\[[^\]]*\]/,
      '"permitted_uses":["supervised fine-tuning"]',
    );
    writeFileSync(file, relisted);
    const manifestFile = join(out, 'MANIFEST.json');
    const manifest = FieldExportManifestSchema.parse(
      JSON.parse(readFileSync(manifestFile, 'utf8')),
    );
    manifest.files['sft/demonstrations.jsonl'] = createHash('sha256')
      .update(relisted)
      .digest('hex');
    writeFileSync(manifestFile, JSON.stringify(manifest));
    expect(() => datasetFromExport(out)).toThrow(ExportDatasetError);
    expect(() => datasetFromExport(out)).toThrow('off this computer');

    expect(() => datasetFromExport(root)).toThrow('has no MANIFEST.json');
  });
});
