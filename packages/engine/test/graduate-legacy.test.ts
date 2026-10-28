import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeGraduate } from '@architect/harness';
import type { GraduateManifest, Job, LineageEntry } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { activeVersion } from '../src/graduates/open';
import { DataPaths } from '../src/loop/paths';
import { migrate } from '../src/store/database';
import { MIGRATIONS } from '../src/store/migrations';
import { fixtureHarness, reportFor } from './agent-host/graduates';
import { ManualClock } from './fakes/clock';
import { attach, THIS_MACHINE } from './support/computer';
import { makeJob, SAMPLE_CONTENT } from './support/fixtures';

const AT = '2026-11-05T18:00:00.000Z';
const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const LINEAGE: LineageEntry = {
  id: 'lin_1',
  runId: 'run_old',
  round: 1,
  title: 'Add the invoice procedure',
  diagnosis: 'The invoice for Dana Whitlock at 12 Elm St was priced without the trip fee.',
  files: ['skills/price-a-job.md'],
  causeTaskIds: ['train-invoice-7'],
  predicted: { devDeltaMin: 1, devDeltaMax: 3, rationale: 'Invoices fail on the trip fee.' },
  measured: {
    devBefore: { pass: 3, total: 9 },
    devAfter: { pass: 6, total: 9 },
    delta: 3,
    perType: [{ type: 'invoice', before: 1, after: 4 }],
  },
  decision: 'kept',
  decisionReason: 'Net dev passes rose by 3.',
  versionFrom: 1,
  versionTo: 2,
  mentor: { model: 'muse-spark-1.3', costUsd: 0.01, inputTokens: 1000, outputTokens: 200 },
  at: AT,
};

function manifestOf(id: string, job: Job, hash: string, version: number): GraduateManifest {
  return {
    format: 1,
    id,
    name: job.name,
    jobId: job.id,
    runId: 'run_old',
    method: 'architect',
    createdAt: AT,
    acceptedAt: '2026-11-05T18:05:00.000Z',
    student: {
      label: 'Glimmer',
      runtime: 'ollama',
      baseUrl: 'http://127.0.0.1:11500',
      model: 'muse-glimmer:30b',
      quantization: 'Q4_K_M',
      digest: 'sha256:glimmer',
      contextLength: 16_384,
    },
    harness: { version, hash },
    requirements: { passRate: { target: 0.85, actual: 0.85, met: true } },
    test: { score: { pass: 17, total: 20 }, perType: reportFor(job).test.perType },
    mentor: { label: 'Spark', model: 'muse-spark-1.3' },
  };
}

/**
 * A data folder as the app left it before versions: format 1 graduate folders, the run's copy of
 * the job and its data, and a database at migration 8 with the graduates, a chat and replies.
 */
async function before(ids: readonly string[]): Promise<{ dataDir: string; job: Job }> {
  const dataDir = await mkdtemp(join(tmpdir(), 'architect-before-versions-'));
  dirs.push(dataDir);
  const paths = new DataPaths(dataDir);
  const job = makeJob({ id: 'job_old' });
  await mkdir(join(paths.runDir(job.id, 'run_old')), { recursive: true });
  await writeFile(paths.runJobFile(job.id, 'run_old'), JSON.stringify(job), 'utf8');
  await mkdir(paths.dataDir(job.id), { recursive: true });
  for (const [name, content] of Object.entries(SAMPLE_CONTENT)) {
    await writeFile(join(paths.dataDir(job.id), name), content, 'utf8');
  }

  const db = new DatabaseSync(paths.database, { enableForeignKeyConstraints: true });
  migrate(
    db,
    MIGRATIONS.filter(({ version }) => version <= 8),
  );
  db.prepare(
    'INSERT INTO jobs (id, name, path, task_count, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
  ).run(job.id, job.name, `jobs/${job.id}`, AT, AT);
  for (const id of ids) {
    const harness = fixtureHarness(job.name);
    const manifest = manifestOf(id, job, harness.meta.hash, harness.meta.version);
    await writeGraduate(paths.graduateDir(id), {
      harness,
      manifest,
      report: reportFor(job),
      lineage: [LINEAGE],
    });
    db.prepare(
      'INSERT INTO graduates (id, run_id, name, path, manifest, settings, created_at) VALUES (?, NULL, ?, ?, ?, ?, ?)',
    ).run(id, job.name, `graduates/${id}`, JSON.stringify(manifest), '{"writeMode":"allow"}', AT);
    db.prepare(
      'INSERT INTO chats (id, graduate_id, title, running, waiting, created_at, updated_at) VALUES (?, ?, ?, 0, 0, ?, ?)',
    ).run(`cht_${id}`, id, 'Who owes us?', AT, AT);
    for (const [index, role] of ['user', 'agent'].entries()) {
      const body = {
        id: `msg_${id}_${index}`,
        chatId: `cht_${id}`,
        role,
        createdAt: AT,
        text: role === 'user' ? 'Who owes us?' : 'Ruiz, Ben owes $45.50.',
        steps: [],
        blocks: [],
        status: 'done',
      };
      db.prepare(
        'INSERT INTO messages (id, chat_id, role, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(body.id, body.chatId, role, 'done', JSON.stringify(body), AT);
    }
  }
  db.close();
  return { dataDir, job };
}

describe('graduates from before versions', () => {
  it('become version 1, with their machine settings moved into the installation', async () => {
    const { dataDir, job } = await before(['grd_old']);
    const legacyFile = join(dataDir, 'graduates', 'grd_old', 'graduate.yaml');
    const legacy = await readFile(legacyFile, 'utf8');
    const made = attach(dataDir, THIS_MACHINE, new ManualClock());
    try {
      await made.library.upgrade();

      expect(made.library.summary('grd_old')).toMatchObject({
        activeVersion: 1,
        versions: 1,
        status: 'unchecked',
        manifest: {
          acceptedAt: '2026-11-05T18:05:00.000Z',
          student: { baseUrl: 'http://127.0.0.1:11500' },
          test: { score: { pass: 17, total: 20 } },
        },
      });
      expect(made.store.versions.get('grd_old', 1)).toMatchObject({
        state: 'accepted',
        evaluation: 'ready',
        contractVersion: 1,
        acceptedAt: '2026-11-05T18:05:00.000Z',
      });
      expect(made.store.installations.get('grd_old')).toMatchObject({
        model: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11500', model: 'muse-glimmer:30b' },
        bindings: { data: 'workspace/grd_old', output: 'outputs/grd_old' },
        grants: { writes: 'allow', resources: { data: 'read_write', output: 'read_write' } },
      });
      expect(made.store.contracts.list(job.id).map(({ version }) => version)).toEqual([1]);
      expect((await readdir(made.paths.workspaceDir('grd_old'))).sort()).toEqual(
        Object.keys(SAMPLE_CONTENT).sort(),
      );

      const folder = made.paths.versionDir('grd_old', 1);
      const text = await readFile(join(folder, 'graduate.json'), 'utf8');
      expect(text).not.toContain('11500');
      const lineage = await readFile(join(folder, 'evidence', 'lineage.jsonl'), 'utf8');
      expect(lineage).toContain('Add the invoice procedure');
      expect(lineage).not.toContain('Dana Whitlock');
      expect(lineage).not.toContain('train-invoice-7');
      expect(await readFile(legacyFile, 'utf8')).toBe(legacy);

      expect(made.store.chats.list('grd_old')).toMatchObject([{ graduateVersion: 1 }]);
      expect(
        made.store.messages.list('cht_grd_old').map((message) => message.graduateVersion),
      ).toEqual([undefined, 1]);
      await expect(activeVersion(made.store, made.paths, 'grd_old')).resolves.toMatchObject({
        model: { baseUrl: 'http://127.0.0.1:11500' },
      });

      await made.library.upgrade();
      expect(made.store.versions.list('grd_old')).toHaveLength(1);
    } finally {
      made.close();
    }
  });

  it('leave one whose files changed as it was, say why, and convert the rest', async () => {
    const { dataDir } = await before(['grd_changed', 'grd_fine']);
    await writeFile(
      join(dataDir, 'graduates', 'grd_changed', 'system.md'),
      'You are someone else now.\n',
    );
    const made = attach(dataDir, THIS_MACHINE, new ManualClock());
    try {
      await made.library.upgrade();
      expect(made.library.summary('grd_changed')).toMatchObject({
        activeVersion: null,
        versions: 0,
        status: 'blocked',
        reasons: [expect.stringContaining("couldn't be converted")],
      });
      expect(made.library.summary('grd_changed').reasons[0]).toContain('do not match the hash');
      expect(made.library.summary('grd_fine')).toMatchObject({ activeVersion: 1 });
      expect(made.store.chats.list('grd_changed')).toHaveLength(1);
    } finally {
      made.close();
    }
  });
});
