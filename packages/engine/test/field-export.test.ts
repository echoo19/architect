import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import {
  FieldExportManifestSchema,
  GuardError,
  JobSchema,
  RewardScoreSchema,
  type Job,
  type Task,
  type VerifiedEpisode,
} from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChecker } from '../src/checker/checker';
import { runTaskAttempt } from '../src/eval/evaluate';
import { exportField, exportFieldFromData } from '../src/field/export';
import { openRewardScorer, type RewardScorer } from '../src/field/reward';
import { DataPaths } from '../src/loop/paths';
import { createSandbox } from '../src/sandbox/sandbox';
import type { Sandbox } from '../src/sandbox/types';
import { releaseMentor } from '../src/vault/gate';
import { Vault } from '../src/vault/vault';
import { orderEpisode } from './support/episodes';
import { importJobInto } from './support/field';
import { makeHarness } from './support/fixtures';
import { ScriptedStudent, type ScriptedTurn } from './support/scripted-student';

let root: string;
let paths: DataPaths;
let vault: Vault;
let job: Job;
const tasks: Record<'train' | 'dev' | 'calibration', Task[]> = {
  train: [],
  dev: [],
  calibration: [],
};
/** What the vault seals: the locked test (with the unseen academy's tasks) and its files. */
let sealedTasks: Task[];
let sealedFiles: { name: string; content: string }[];
let sealedOrgs: { id: string; name: string }[];

const readTasks = (file: string): Task[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Task);

/** Every file under a folder, by its path with forward slashes, with its text. */
function filesUnder(dir: string): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (folder: string) => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) walk(path);
      else found.set(relative(dir, path).split('\\').join('/'), readFileSync(path, 'utf8'));
    }
  };
  walk(dir);
  return found;
}

/** A verified episode of an academy train task, in the shape lessons keep. */
function academyEpisode(id: string, task: Task, overrides: Partial<VerifiedEpisode> = {}) {
  const base = orderEpisode(id);
  return {
    ...base,
    origin: { kind: 'task' as const, taskId: task.id, split: 'train' as const },
    messages: [
      { role: 'system' as const, content: 'You help the staff of a test-prep academy.' },
      { role: 'user' as const, content: task.prompt },
      { role: 'assistant' as const, content: 'ANSWER: {"assigned": 5}' },
    ],
    verifiedTurns: [2],
    provenance: { ...base.provenance, jobId: job.id },
    ...overrides,
  };
}

const source = (episodes: unknown[]) => ({
  job,
  jobDir: paths.jobDir(job.id),
  trainTasks: tasks.train,
  episodes,
  vault,
  now: () => new Date('2026-10-30T12:00:00.000Z'),
});

const outDir = () => join(mkdtempSync(join(root, 'out-')), 'export');

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'architect-field-'));
  const dataDir = join(root, 'data');
  job = await importJobInto(dataDir);
  paths = new DataPaths(dataDir);
  vault = new Vault(dataDir);
  for (const split of ['train', 'dev', 'calibration'] as const) {
    tasks[split] = readTasks(paths.tasksFile(job.id, split));
  }
  const proof = await releaseMentor({ dispose: () => undefined });
  sealedTasks = vault.openForLockedTest(job.id, proof);
  const opened = vault.openTransfer(job.id, proof);
  sealedOrgs = opened.organizations.map(({ id, name }) => ({ id, name }));
  sealedFiles = Object.values(opened.dataDirs).flatMap((dir) =>
    readdirSync(dir).map((name) => ({ name, content: readFileSync(join(dir, name), 'utf8') })),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a field export', () => {
  let out: string;
  let files: Map<string, string>;

  beforeAll(() => {
    out = outDir();
    const [first, second, third] = tasks.train;
    exportField(
      source([
        academyEpisode('ep-1', first!, { sharing: { remoteTraining: true } }),
        academyEpisode('ep-2', second!, { sharing: { remoteTraining: false } }),
        academyEpisode('ep-3', third!, {
          origin: { kind: 'workspace', chatId: 'chat_1', messageId: 'msg_1' },
        }),
      ]),
      out,
    );
    files = filesUnder(out);
  });

  it('holds the train demonstrations, the train environment, the sealed hashes and a manifest', () => {
    expect([...files.keys()].sort()).toEqual(
      [
        'MANIFEST.json',
        'env/checker.js',
        'env/job.json',
        'env/score_client.py',
        'env/tasks.jsonl',
        'eval/manifest.json',
        'sft/demonstrations.jsonl',
        ...['bramble', 'copperfield', 'thistlewood'].flatMap((org) =>
          readdirSync(paths.orgDataDir(job.id, org)).map((name) => `env/orgs/${org}/data/${name}`),
        ),
      ].sort(),
    );
    const manifest = FieldExportManifestSchema.parse(JSON.parse(files.get('MANIFEST.json')!));
    expect(manifest.counts).toEqual({
      demonstrations: 1,
      trained_turns: 1,
      train_tasks: tasks.train.length,
      train_organizations: 3,
      sealed_organizations: 1,
      locked_test_tasks: sealedTasks.length,
    });
    for (const [path, content] of files) {
      if (path === 'MANIFEST.json') continue;
      expect(manifest.files[path], path).toBe(createHash('sha256').update(content).digest('hex'));
    }
    expect(manifest.left_out.map((entry) => entry.why)).toEqual(
      expect.arrayContaining([
        'its data may not leave this computer',
        'it comes from a workspace chat, not a train task',
      ]),
    );

    const [demonstration, ...more] = files.get('sft/demonstrations.jsonl')!.trimEnd().split('\n');
    expect(more).toEqual([]);
    expect(JSON.parse(demonstration!)).toMatchObject({
      id: 'ep-1',
      provenance: { origin: `task ${tasks.train[0]!.id} (train)` },
      verdict: { pass: true },
      permitted_uses: ['supervised fine-tuning', 'training off this computer'],
      messages: [{ role: 'system' }, { role: 'user' }, { role: 'assistant', train: true }],
    });

    expect(readTasks(join(out, 'env', 'tasks.jsonl'))).toEqual(tasks.train);
    expect(files.get('env/checker.js')).toBe(
      readFileSync(join(paths.jobDir(job.id), 'checker.js'), 'utf8'),
    );
    const envJob = JobSchema.parse(JSON.parse(files.get('env/job.json')!));
    expect(envJob.organizations?.map((org) => org.role)).toEqual(['train', 'train', 'train']);
  });

  it('carries nothing of the unseen academy or the locked test, in any part', () => {
    const everything = [...files.values()].join('\n');
    for (const org of sealedOrgs) {
      expect(everything.toLowerCase()).not.toContain(org.id.toLowerCase());
      expect(everything.toLowerCase()).not.toContain(org.name.toLowerCase());
    }
    for (const task of sealedTasks) {
      expect(everything, task.id).not.toContain(task.id);
      expect(everything, task.id).not.toContain(task.prompt);
    }
    for (const file of sealedFiles) {
      const hash = createHash('sha256').update(file.content).digest('hex');
      expect(everything).not.toContain(hash);
      // The unseen academy's own rows: its students' ids and names.
      if (file.name === 'students.csv') {
        const rows = file.content.trimEnd().split('\n').slice(1);
        for (const row of rows) expect(everything).not.toContain(row);
      }
    }
    for (const task of [...tasks.dev, ...tasks.calibration]) {
      expect(files.get('env/tasks.jsonl')).not.toContain(task.id);
    }
    const sealed = JSON.parse(files.get('eval/manifest.json')!) as Record<string, unknown>;
    expect(Object.keys(sealed).sort()).toEqual([
      'format',
      'locked_test',
      'organizations',
      'permitted_uses',
    ]);
    expect(sealed['organizations']).toEqual([
      { sha256: expect.stringMatching(/^[0-9a-f]{64}$/), files: sealedFiles.length },
    ]);
  });
});

describe('the export guards', () => {
  it('stops on a demonstration that holds a locked-test task, with nothing written', () => {
    const test = sealedTasks.find((task) => task.org === 'copperfield')!;
    const out = outDir();
    const leaky = academyEpisode('ep-leak', tasks.train[0]!, {
      messages: [
        { role: 'user', content: test.prompt },
        { role: 'assistant', content: 'ANSWER: {}' },
      ],
      verifiedTurns: [1],
    });
    expect(() => exportField(source([leaky]), out)).toThrow(GuardError);
    expect(existsSync(out)).toBe(false);
  });

  it('stops on a demonstration that names the unseen academy, or one from another split', () => {
    const [name] = sealedOrgs.map((org) => org.name);
    const naming = academyEpisode('ep-name', tasks.train[0]!, {
      messages: [
        { role: 'user', content: `How do they do this at ${name}?` },
        { role: 'assistant', content: 'ANSWER: {}' },
      ],
      verifiedTurns: [1],
    });
    expect(() => exportField(source([naming]), outDir())).toThrow(GuardError);
    const dev = academyEpisode('ep-dev', tasks.dev[0]!, {
      origin: { kind: 'task', taskId: tasks.dev[0]!.id, split: 'dev' },
    });
    expect(() => exportField(source([dev]), outDir())).toThrow(GuardError);
    const relabeled = academyEpisode('ep-relabeled', tasks.dev[0]!);
    expect(() => exportField(source([relabeled]), outDir())).toThrow(GuardError);
  });

  it('refuses a folder that already has files', () => {
    expect(() => exportField(source([]), root)).toThrow('already has files');
  });

  it('exports a job of the app by its name, with no demonstrations yet', async () => {
    const out = outDir();
    const manifest = await exportFieldFromData({
      dataDir: paths.root,
      job: 'Academy desk',
      outDir: out,
    });
    expect(manifest.counts.demonstrations).toBe(0);
    expect(readFileSync(join(out, 'sft', 'demonstrations.jsonl'), 'utf8')).toBe('');
    await expect(
      exportFieldFromData({ dataDir: paths.root, job: 'nobody', outDir: outDir() }),
    ).rejects.toMatchObject({ code: 'job_not_found' });
  });
});

describe('the outcome scorer', () => {
  let envDir: string;
  let envJob: Job;
  let scorer: RewardScorer;
  let sandbox: Sandbox;

  beforeAll(() => {
    const out = outDir();
    exportField(source([]), out);
    envDir = join(out, 'env');
    envJob = JobSchema.parse(JSON.parse(readFileSync(join(envDir, 'job.json'), 'utf8')));
    scorer = openRewardScorer({ envDir });
    sandbox = createSandbox();
  });

  afterAll(async () => {
    await scorer.close();
    await sandbox.dispose();
  });

  const diagnosis = () => tasks.train.find((task) => task.type === 'diagnose')!;
  const truth = (task: Task) => {
    const params = (task.expected as { params: Record<string, unknown> }).params;
    return {
      topic: params['topic'],
      correct: params['correct'],
      error: (params['errors'] as string[])[0],
    };
  };
  const NOTE = 'N-999,S-1005,T-4,2026-11-04,Some topic,Please look at this.';

  /** One attempt through the runner itself: a scripted student, a scratch copy, the checker. */
  async function viaRunner(task: Task, turns: ScriptedTurn[]) {
    return runTaskAttempt(task, {
      job: envJob,
      jobDir: envDir,
      harness: makeHarness(),
      student: new ScriptedStudent(turns),
      sandbox,
      checker: createChecker({ job: envJob, jobDir: envDir, sandbox }),
      seed: 1,
    });
  }

  it('gives what the runner gives on a passing, a failing and a forbidden-write attempt', async () => {
    const task = diagnosis();
    const right = `ANSWER: ${JSON.stringify(truth(task))}`;
    const wrong = `ANSWER: ${JSON.stringify({ ...truth(task), correct: truth(task).correct === 'A' ? 'B' : 'A' })}`;
    const notes = readFileSync(join(envDir, 'orgs', task.org!, 'data', 'staff_notes.csv'), 'utf8');
    const cases = [
      { turns: [{ text: right }], changes: [] },
      { turns: [{ text: wrong }], changes: [] },
      {
        turns: [
          {
            toolCalls: [
              { name: 'append', arguments: { path: 'data/staff_notes.csv', text: NOTE } },
            ],
          },
          { text: right },
        ],
        changes: [{ path: 'data/staff_notes.csv', text: `${notes.trimEnd()}\n${NOTE}\n` }],
      },
    ];
    const rewards: number[] = [];
    for (const [index, { turns, changes }] of cases.entries()) {
      const runner = await viaRunner(task, turns);
      const score = RewardScoreSchema.parse(
        await scorer.score(
          JSON.stringify({
            id: index,
            task_id: task.id,
            final_text: runner.outcome.finalText,
            changes,
            tool_calls: runner.outcome.toolCalls,
            stop_reason: runner.outcome.stopReason,
          }),
        ),
      );
      expect(score).toEqual({
        id: index,
        reward: runner.check.pass ? 1 : 0,
        reason: runner.check.reason,
      });
      rewards.push(score.reward);
    }
    expect(rewards).toEqual([1, 0, 0]);
  });

  it('fails a change to a read-only file and a refusal, and keeps errors apart', async () => {
    const task = diagnosis();
    const right = `ANSWER: ${JSON.stringify(truth(task))}`;
    expect(
      await scorer.score(
        JSON.stringify({
          task_id: task.id,
          final_text: right,
          changes: [{ path: 'data/questions.csv', text: 'question_id\nQ-1\n' }],
        }),
      ),
    ).toMatchObject({ reward: 0, reason: expect.stringContaining('was refused') });
    expect(
      await scorer.score(
        JSON.stringify({ task_id: task.id, final_text: right, stop_reason: 'refused' }),
      ),
    ).toMatchObject({ reward: 0, reason: 'The agent refused the request instead of doing it.' });

    expect(await scorer.score('not json')).toMatchObject({
      reward: 0,
      error: { code: 'bad_request' },
    });
    expect(await scorer.score(JSON.stringify({ id: 'x', final_text: '' }))).toMatchObject({
      id: 'x',
      error: { code: 'bad_request' },
    });
    for (const other of [tasks.dev[0]!, sealedTasks[0]!]) {
      expect(
        await scorer.score(JSON.stringify({ task_id: other.id, final_text: right })),
      ).toMatchObject({ reward: 0, error: { code: 'unknown_task' } });
    }
  });
});
