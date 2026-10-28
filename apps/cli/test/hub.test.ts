import { cpSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  FAKE_HUB_TOKEN,
  openEngineStore,
  SAMPLE_CONTENT,
  startFakeHub,
  startFakeOllama,
  type FakeHub,
} from '@architect/engine/testing';
import { RunResultSchema } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanUp, cli, machineWith, spawnCli, tempDir, testEnv } from './support';

const REPO = 'jake/service-desk';
const hubs: FakeHub[] = [];

afterEach(async () => {
  for (const hub of hubs.splice(0)) await hub.close();
  await cleanUp();
});

async function fakeHub(): Promise<FakeHub> {
  const hub = await startFakeHub();
  hubs.push(hub);
  return hub;
}

/** The author's computer, signed in to the fake Hub with HF_TOKEN. */
async function author(hub: FakeHub) {
  const machine = await machineWith([]);
  return { ...machine, env: { ...machine.env, HF_ENDPOINT: hub.url, HF_TOKEN: FAKE_HUB_TOKEN } };
}

/** A clean computer: its own data folder and records, a local model, and the same Hub. */
async function recipient(hub: FakeHub, token: string | null) {
  const env = await testEnv({ HF_ENDPOINT: hub.url, ...(token ? { HF_TOKEN: token } : {}) });
  const records = await tempDir('records');
  await mkdir(records, { recursive: true });
  for (const [name, content] of Object.entries(SAMPLE_CONTENT)) {
    await writeFile(join(records, name), content, 'utf8');
  }
  // One short request for the installation check, then the run's two turns.
  const model = await startFakeOllama([
    { text: 'Ready.' },
    { toolCalls: [{ name: 'read', arguments: { path: 'data/invoices.csv' } }] },
    { text: 'There are 3 invoices on file.' },
  ]);
  return { env, records, model };
}

describe('A12: publishing to the Hub and installing from it by commit', () => {
  it('publishes privately, then a clean computer installs that commit and runs it', async () => {
    const hub = await fakeHub();
    const from = await author(hub);
    const published = await cli(['publish', 'service-desk', '--repo', REPO, '--json'], {
      env: from.env,
    });
    expect(published.code, published.stderr).toBe(0);
    const { publication, install } = JSON.parse(published.stdout) as {
      publication: { revision: string; visibility: string; status: string };
      install: string;
    };
    expect(publication).toMatchObject({ visibility: 'private', status: 'complete' });
    expect(hub.repos.get(REPO)?.private).toBe(true);
    expect(install).toBe(`architect install hf://${REPO} --revision ${publication.revision}`);
    expect(published.stderr).toContain('graduate.json');
    expect(published.stderr).toContain('README.md');
    expect(published.stderr).toContain('Using the Hugging Face token from HF_TOKEN.');
    expect(published.stderr + published.stdout).not.toContain(FAKE_HUB_TOKEN);

    // Another computer installs exactly that commit, binds its own folder, and runs it there.
    const to = await recipient(hub, FAKE_HUB_TOKEN);
    try {
      const installed = await cli(
        [
          'install',
          `hf://${REPO}`,
          '--revision',
          publication.revision,
          '--bind',
          `data=${to.records}`,
          '--grant',
          'data=read_write',
          '--model',
          'muse-glimmer:30b',
          '--model-url',
          to.model.url,
          '--json',
        ],
        { env: to.env },
      );
      expect(installed.code, installed.stdout).toBe(0);
      expect(JSON.parse(installed.stdout)).toMatchObject({
        format: 'architect.install/1',
        version: 1,
        already_installed: false,
        source: { kind: 'huggingface', repository: REPO, revision: publication.revision },
        installation: { status: 'ready', label: 'Installation checks on this computer' },
      });
      expect(installed.guards).toBe(1);

      const inspected = await cli(['inspect', 'service-desk', '--json'], { env: to.env });
      expect(JSON.parse(inspected.stdout)).toMatchObject({
        versions: [{ version: 1, source: { revision: publication.revision } }],
      });

      const work = await tempDir('a12');
      const request = join(work, 'request.json');
      await writeFile(
        request,
        JSON.stringify({ format: 'architect.run-request/1', task: 'How many invoices are there?' }),
      );
      const run = await cli(['run', 'service-desk', '--input', request, '--non-interactive'], {
        env: to.env,
      });
      expect(run.code, run.stderr).toBe(0);
      expect(RunResultSchema.parse(JSON.parse(run.stdout))).toMatchObject({
        status: 'succeeded',
        answer: 'There are 3 invoices on file.',
        steps: [{ tool: 'read', detail: 'data/invoices.csv', summary: '3 rows' }],
      });
    } finally {
      await to.model.close();
    }
  });

  it('reports a failed upload as a failure, never as a release, and finishes it when run again', async () => {
    const hub = await fakeHub();
    const from = await author(hub);
    hub.failNext(`/api/models/${REPO}/commit/`, 503, 'Service unavailable');
    const failed = await cli(['publish', 'service-desk', '--repo', REPO], { env: from.env });
    expect(failed.code).toBe(1);
    expect(failed.stdout).toBe('');
    expect(failed.stderr).toContain('503');
    const afterFailure = JSON.parse(
      (await cli(['inspect', 'service-desk', '--json'], { env: from.env })).stdout,
    ) as { publications: { id: string; status: string; revision?: string }[] };
    expect(afterFailure.publications).toEqual([
      expect.objectContaining({ status: 'failed', repository: REPO }),
    ]);
    expect(afterFailure.publications[0]?.revision).toBeUndefined();

    const retried = await cli(['publish', 'service-desk', '--repo', REPO], { env: from.env });
    expect(retried.code, retried.stderr).toBe(0);
    expect(retried.stderr).not.toContain("didn't finish");
    const afterRetry = JSON.parse(
      (await cli(['inspect', 'service-desk', '--json'], { env: from.env })).stdout,
    ) as { publications: { id: string; status: string }[] };
    expect(afterRetry.publications).toEqual([
      expect.objectContaining({ id: afterFailure.publications[0]?.id, status: 'complete' }),
    ]);
  });

  it('says which version an unfinished publication was for, so trying again sends that one', async () => {
    const hub = await fakeHub();
    const from = await author(hub);
    hub.failNext(`/api/models/${REPO}/commit/`, 503, 'Service unavailable');
    expect((await cli(['publish', 'service-desk', '--repo', REPO], { env: from.env })).code).toBe(
      1,
    );
    // A newer version (here a copy of the first) became the active one meanwhile.
    const store = openEngineStore(join(from.dataDir, 'architect.db'));
    const first = store.versions.get('grd_desk', 1);
    if (!first) throw new Error('no version 1');
    const second = first.path.replace(/v0001$/, 'v0002');
    cpSync(join(from.dataDir, ...first.path.split('/')), join(from.dataDir, ...second.split('/')), {
      recursive: true,
    });
    store.versions.insert({ ...first, version: 2, path: second });
    const agent = store.graduates.get('grd_desk');
    if (!agent) throw new Error('no agent');
    store.graduates.update({ ...agent, activeVersion: 2 });
    store.close();
    const dry = await cli(['publish', 'service-desk', '--repo', REPO, '--dry-run'], {
      env: from.env,
    });
    expect(dry.stderr).toContain(
      `Version 1's publication to ${REPO} didn't finish. To finish it instead of sending version 2, run this again with --version 1.`,
    );
  });

  it('needs a token, and says where it looks, with exit 3', async () => {
    const hub = await fakeHub();
    const from = await author(hub);
    const { HF_TOKEN: _token, ...env } = from.env;
    const run = await cli(['publish', 'service-desk', '--repo', REPO], { env });
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('HF_TOKEN');
    expect(run.stderr).toContain('hf auth login');
    expect(hub.repos.has(REPO)).toBe(false);
  });

  it('refuses to publish a private version into a public repository, with exit 3', async () => {
    const hub = await fakeHub();
    const from = await author(hub);
    hub.repos.set(REPO, { private: false, commits: [] });
    const run = await cli(['publish', 'service-desk', '--repo', REPO], { env: from.env });
    expect(run.code).toBe(3);
    expect(run.stderr).toContain('is public');
    expect(hub.repos.get(REPO)?.commits).toEqual([]);
  });

  it('shows what it would send on a dry run, and sends nothing', async () => {
    const hub = await fakeHub();
    const from = await author(hub);
    const run = await cli(['publish', 'service-desk', '--repo', REPO, '--dry-run'], {
      env: from.env,
    });
    expect(run.code).toBe(0);
    expect(run.stdout).toContain('Nothing was sent');
    expect(run.stderr).toContain("doesn't make the agent runnable through hosted inference");
    expect(hub.requests).toEqual([]);
  });

  it('works the same from the real process, reading the token and the Hub from the environment', async () => {
    const hub = await fakeHub();
    const from = await author(hub);
    const published = await spawnCli(['publish', 'service-desk', '--repo', REPO, '--json'], {
      env: from.env,
    });
    expect(published.code, published.stderr).toBe(0);
    const { publication } = JSON.parse(published.stdout) as { publication: { revision: string } };

    const to = await recipient(hub, FAKE_HUB_TOKEN);
    try {
      const installed = await spawnCli(
        [
          'install',
          `hf://${REPO}`,
          '--revision',
          publication.revision,
          '--no-model-check',
          '--json',
        ],
        { env: to.env },
      );
      // Nothing was granted that the install didn't name, so it needs its folder first.
      expect(installed.code).toBe(3);
      const result = JSON.parse(installed.stdout) as {
        source: { revision: string };
        installation: { status: string; reasons: string[] };
      };
      expect(result).toMatchObject({
        source: { revision: publication.revision },
        installation: { status: 'needs_attention' },
      });
      expect(result.installation.reasons.join(' ')).toContain('data/');
    } finally {
      await to.model.close();
    }
  }, 60_000);
});
