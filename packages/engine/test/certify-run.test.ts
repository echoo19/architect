import { join } from 'node:path';
import type { Job, Task } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalAnswer, vote } from '../src/certify/agreement';
import { JobStudy } from '../src/drafting/studying';
import { packagedReport } from '../src/graduates/graduation';
import { buildCertificate, scoreTask } from '../src/loop/certify';
import type { StoredAttempt } from '../src/store/records';
import { hypothesis } from './fakes/adapters';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';
import {
  filesHolding,
  orgJob,
  orgTask,
  orgTasks,
  writeOrgJobFolder,
} from './support/organizations';

let world: World;
let engine: Engine;
let open = false;

afterEach(async () => {
  if (!open) return;
  open = false;
  await engine.close();
  world.cleanup();
});

/** Four calibration tasks per taught organization, of the job's first type. */
function calibrationTasks(): Task[] {
  return ['north', 'south'].flatMap((org) =>
    [1, 2, 3, 4].map((n) => orgTask('cert', org, 'invoice', n)),
  );
}

function certifiedJob(): Job {
  const job = orgJob();
  return {
    ...job,
    evaluation: {
      ...job.evaluation,
      certify: { k: 3, epsilon: 0.6, delta: 0.2, calibration: 8 },
    },
  };
}

async function certifiedRun(job: Job = certifiedJob()) {
  world = await createWorld();
  engine = openEngine(world);
  open = true;
  const imported = await engine.jobs.importFile(
    await writeOrgJobFolder(join(world.root, 'branches'), job, [
      ...orgTasks(),
      ...calibrationTasks(),
    ]),
  );
  world.mentor.script = () => ({
    skills: imported.taskTypes.map((type) => ({
      taskType: type.id,
      text: `Answer ${type.label} requests from the organization's own files.`,
      needs: [],
      steps: ["Read the organization's files for its facts."],
      quotes: [],
    })),
    connections: [],
    rules: [],
    differences: [],
    questions: [],
    outOfScope: [],
  });
  const study = new JobStudy({
    jobs: engine.jobs,
    paths: engine.paths,
    deps: world.deps,
    clock: world.clock,
  });
  await engine.jobs.confirmStudy(imported.id, (await study.study(imported.id)).token);
  world.mentor.script = () =>
    hypothesis('Read the records', 'Branches.\nfix:invoice fix:overdue fix:scheduling');
  // Calibration task 4 of each organization answers differently under each seed, so it abstains.
  const seen = new Map<string, number>();
  world.runtime.passes = (task, harness) => {
    const tries = (seen.get(task.id) ?? 0) + 1;
    seen.set(task.id, tries);
    if (task.id.startsWith('cert-') && task.id.endsWith('-4')) return tries === 1;
    return harness.system.includes(`fix:${task.type}`);
  };
  const run = await engine.controller.start(imported.id, 'architect', 7);
  await engine.controller.idle();
  expect(engine.errors).toEqual([]);
  const record = engine.store.runs.get(run.id);
  expect(record?.run.status).toBe('finished');
  return { job: imported, run };
}

describe('a certified run (decision 077)', () => {
  it('certifies on the sealed calibration split and checks the bound on the locked test', async () => {
    const { run } = await certifiedRun();
    const report = engine.store.reports.get(run.id, 'local');
    const certificate = report?.certificate;
    expect(certificate).toMatchObject({ issued: true, n: 8, k: 3, delta: 0.2, epsilon: 0.6 });
    if (certificate?.issued !== true) throw new Error('not issued');
    // Six of eight agree three ways and are right; two disagree and are handed off.
    expect(certificate.curve[0]).toMatchObject({ votes: 3, answered: 6, errors: 0 });
    expect(certificate.threshold.votes).toBeLessThanOrEqual(3);
    expect(certificate.checks).toEqual([
      expect.objectContaining({ seen: true, tasks: 6, answered: 6, errors: 0, held: true }),
      expect.objectContaining({ org: 'hillcrest', orgName: 'Hillcrest Prep', seen: false }),
    ]);
    // The test's score is its first seed's, as without a certificate.
    expect(report?.test.score).toEqual({ pass: 6, total: 6 });
  });

  it('attempts each calibration and test task k times, only after the mentor is released', async () => {
    const { run } = await certifiedRun();
    const release = world.runtime.sequence.indexOf(`release:${run.id}`);
    expect(release).toBeGreaterThanOrEqual(0);
    const calibrated = world.runtime.attempts.filter((attempt) =>
      attempt.taskId.startsWith('cert-'),
    );
    expect(calibrated).toHaveLength(8 * 3);
    const tested = world.runtime.attempts.filter((attempt) => /^(test|xfer)-/.test(attempt.taskId));
    expect(tested).toHaveLength((6 + 6) * 3);
    const firstTest = world.runtime.sequence.findIndex((step) => step.startsWith('test:'));
    expect(firstTest).toBeGreaterThan(release);
  });

  it('never shows the mentor a calibration task, and streams none of its attempts', async () => {
    const { job, run } = await certifiedRun();
    const sent = JSON.stringify(world.mentor.requests);
    expect(sent).not.toContain('cert-');
    const ready = engine.events.findIndex((event) => event.type === 'graduate.ready');
    expect(JSON.stringify(engine.events.slice(0, ready))).not.toContain('cert-');
    const runDir = engine.paths.runDir(job.id, run.id);
    for (const part of ['mentor', 'traces', 'harness', 'lineage.jsonl']) {
      expect(await filesHolding(join(runDir, part), 'cert-')).toEqual([]);
    }
    const sealed = engine.store.attempts.list({ runId: run.id, split: 'certify' });
    expect(sealed).toHaveLength(24);
    expect(sealed.every((attempt) => attempt.tracePath === null)).toBe(true);
    expect(sealed.every((attempt) => attempt.answerSummary === undefined)).toBe(true);
    expect(sealed.every((attempt) => /^[0-9a-f]{64}$/.test(attempt.answerKey ?? ''))).toBe(true);
  });

  it('leaves a job without the setting as it was: no calibration split, no certificate', async () => {
    const { run } = await certifiedRun(orgJob());
    expect(engine.store.reports.get(run.id, 'local')?.certificate).toBeUndefined();
    expect(engine.store.attempts.list({ runId: run.id, split: 'certify' })).toEqual([]);
    expect(world.runtime.attempts.some((attempt) => attempt.taskId.startsWith('cert-'))).toBe(
      false,
    );
  });
});

describe('the certificate', () => {
  const scored = (votes: number, correct: boolean, count: number) =>
    Array.from({ length: count }, () => ({ votes, correct }));
  const task = (org: string, n: number) => orgTask('test', org, 'invoice', n);

  it('says why there is none and how many tasks would do', () => {
    const certificate = buildCertificate({
      settings: { k: 5, epsilon: 0.1, delta: 0.05 },
      calibration: scored(5, true, 10),
      test: [],
      unseen: [],
      taughtSynthetic: true,
    });
    expect(certificate).toMatchObject({ issued: false, reason: 'too_few', needed: 29, n: 10 });
  });

  it('holds or not per organization never seen', () => {
    const certificate = buildCertificate({
      settings: { k: 5, epsilon: 0.2, delta: 0.05 },
      calibration: scored(5, true, 40),
      test: [
        ...[1, 2, 3].map((n) => ({ task: task('north', n), scored: { votes: 5, correct: true } })),
        ...[1, 2].map((n) => ({ task: task('far', n), scored: { votes: 5, correct: false } })),
        { task: task('far', 3), scored: { votes: 2, correct: false } },
      ],
      unseen: [{ id: 'far', name: 'Far Academy', synthetic: false }],
      taughtSynthetic: true,
    });
    if (!certificate.issued) throw new Error('not issued');
    expect(certificate.threshold.votes).toBe(1);
    expect(certificate.checks).toEqual([
      { seen: true, synthetic: true, tasks: 3, answered: 3, errors: 0, held: true },
      {
        org: 'far',
        orgName: 'Far Academy',
        seen: false,
        synthetic: false,
        tasks: 3,
        answered: 3,
        errors: 3,
        held: false,
      },
    ]);
    const packaged = packagedReport({
      test: { perOrg: [] },
      certificate,
    } as unknown as Parameters<typeof packagedReport>[0]);
    const check = packaged.certificate?.issued ? packaged.certificate.checks[1] : undefined;
    expect(check).toMatchObject({ org: 'real-1', orgName: 'Real organization' });
  });

  it('scores a task by its most common answer, ties to the earlier attempt', () => {
    const attempt = (seed: number, key: string, pass: boolean) =>
      ({ id: `a${seed}`, seed, answerKey: key, check: { pass } }) as StoredAttempt;
    const seeds = [1, 2, 3, 4];
    expect(
      scoreTask(
        [
          attempt(2, 'b', false),
          attempt(1, 'a', true),
          attempt(3, 'b', false),
          attempt(4, 'a', true),
        ],
        seeds,
      ),
    ).toEqual({ votes: 2, correct: true });
    expect(vote([] as string[], (key) => key)).toBeNull();
  });

  it('reads two answers as one when only key order, row order or trailing space differ', () => {
    const rows = {
      columns: ['a', 'b'],
      added: [
        ['1', '2'],
        ['3', '4'],
      ],
      removed: [],
      changed: [],
    };
    const first = canonicalAnswer({ answer: { x: 1, y: [2, 3] }, stopReason: 'answer' }, [
      { path: 'data/t.csv', patch: 'p', rows },
      { path: 'output/n.md', patch: '+ hi  \n' },
    ]);
    const second = canonicalAnswer({ answer: { y: [2, 3], x: 1 }, stopReason: 'answer' }, [
      { path: 'output/n.md', patch: '+ hi' },
      {
        path: 'data/t.csv',
        patch: 'q',
        rows: {
          ...rows,
          added: [
            ['3', '4'],
            ['1', '2'],
          ],
        },
      },
    ]);
    expect(first).toBe(second);
    expect(canonicalAnswer({ answer: { x: 2 }, stopReason: 'answer' })).not.toBe(
      canonicalAnswer({ answer: { x: 1 }, stopReason: 'answer' }),
    );
    expect(canonicalAnswer({ answer: null, stopReason: 'refused' })).not.toBe(
      canonicalAnswer({ answer: null, stopReason: 'answer' }),
    );
  });
});
