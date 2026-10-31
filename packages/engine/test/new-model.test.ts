import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Job, MoveToModelRequest, RunEvent, Task } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectEngine, type EngineClient } from '../src/host/client';
import { createEngineHost, type EngineHost } from '../src/host/engine-host';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore } from '../src/store/engine-store';
import { hypothesis } from './fakes/adapters';
import { portPair } from './fakes/ports';
import { createWorld, type World } from './fakes/world';
import { orgJob, orgTasks, writeOrgJobFolder } from './support/organizations';

/*
 * Carrying a field to another model (decision 095): the next version is a new job on the chosen
 * model that starts from the field's harness and keeps its tasks, checker and sealed set as they
 * are; its trainings become versions of the agent it carried, and the agent switches models only
 * when the person makes one of them the version in use, which can be undone.
 */

const QWEN: MoveToModelRequest = {
  student: {
    runtime: 'ollama',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:8b',
    contextLength: 16_384,
  },
  label: 'Qwen3 8B',
};

let world: World;
let host: EngineHost | undefined;
let client: EngineClient | undefined;

beforeEach(async () => {
  world = await createWorld();
  host = await createEngineHost({ dataDir: world.dataDir, deps: world.deps, clock: world.clock });
  const [hostPort, clientPort] = portPair();
  host.serve(hostPort);
  client = connectEngine(clientPort);
});

afterEach(async () => {
  client?.close();
  await host?.close();
  host = undefined;
  client = undefined;
  world.cleanup();
});

const api = (): EngineClient => {
  if (!client) throw new Error('Not connected.');
  return client;
};

function finished(runId: string): Promise<void> {
  return new Promise((resolve) => {
    const stop = api().runs.onEvent((event: RunEvent) => {
      if (event.type !== 'graduate.ready' || event.runId !== runId) return;
      stop();
      resolve();
    });
  });
}

async function confirmStudy(job: Job): Promise<void> {
  world.mentor.script = () => ({
    skills: job.taskTypes.map((type) => ({
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
  await api().jobs.confirmStudy(job.id, (await api().jobs.study(job.id)).token);
}

async function trained(job: Job) {
  world.mentor.script = () =>
    hypothesis('Read the records', 'Branches.\nfix:invoice fix:overdue fix:scheduling');
  const run = await api().runs.start(job.id, { method: 'architect', seed: 7 });
  await finished(run.id);
  return api().runs.get(run.id);
}

/** A field of two taught organizations and a sealed real one, studied and trained once. */
async function field() {
  const job = await api().jobs.importFile(
    await writeOrgJobFolder(join(world.root, 'branches'), orgJob()),
  );
  await confirmStudy(job);
  const detail = await trained(job);
  const graduateId = detail.run.graduateId ?? '';
  return { job, graduateId };
}

async function visible(jobId: string, split: 'train' | 'dev'): Promise<Task[]> {
  const listing = await api().jobs.tasks(jobId, split);
  return 'tasks' in listing ? listing.tasks : [];
}

/** Every file under a folder, as text. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [readFileSync(path, 'utf8')];
  });
}

describe('carrying a field to another model', () => {
  it('makes the next version on the chosen model from the field, with the same sealed set', async () => {
    const { job, graduateId } = await field();
    const sealedBefore = world.vault.count(job.id);
    const before = await api().jobs.field(job.id);

    world.clock.advance(60_000);
    const view = await api().jobs.moveToModel(job.id, QWEN);
    const next = await api().jobs.get(view.jobId);

    expect(next.name).toBe(`${job.name} v2`);
    expect(next.student.local.model).toBe('qwen3:8b');
    expect(next.student.label).toBe('Qwen3 8B');
    expect(next.student.trainOn).toBe('local');
    expect(next.startingHarness).toEqual({ kind: 'import', path: 'carried-harness' });
    expect(next.organizations).toEqual(job.organizations);
    expect(next.splits).toEqual(job.splits);
    expect(next.checker).toEqual(job.checker);
    expect(await visible(next.id, 'train')).toEqual(await visible(job.id, 'train'));
    expect(await visible(next.id, 'dev')).toEqual(await visible(job.id, 'dev'));
    expect(view.versionOf).toEqual({
      jobId: job.id,
      name: job.name,
      version: 2,
      model: { from: job.student.label, to: 'Qwen3 8B', carried: { graduateId, version: 1 } },
    });

    // Nothing left the vault: the final test and every never-seen organization, sealed again.
    expect(world.vault.released).toEqual([]);
    expect(world.vault.count(next.id)).toBe(sealedBefore);
    expect(view.sealed.map((org) => org.name)).toEqual(before.sealed.map((org) => org.name));
    expect(view.lockedTestTasks).toBe(before.lockedTestTasks);

    // The carried harness is the version's own, held to its hash.
    const store = openEngineStore(new DataPaths(world.dataDir).database);
    const version = store.versions.get(graduateId, 1);
    const carried = join(new DataPaths(world.dataDir).jobDir(next.id), 'carried-harness');
    const shipped = join(new DataPaths(world.dataDir).fromStored(version?.path ?? ''), 'harness');
    expect(filesUnder(carried)).toEqual(filesUnder(shipped));

    // The field it came from is unchanged, and says where it went.
    const earlier = await api().jobs.field(job.id);
    expect(earlier.nextVersion).toEqual({ jobId: next.id, name: next.name, model: 'Qwen3 8B' });
    expect(world.vault.count(job.id)).toBe(sealedBefore);
    expect((await api().jobs.get(job.id)).student).toEqual(job.student);
    expect(store.counterexamples.list({ jobId: next.id })).toHaveLength(
      store.counterexamples.list({ jobId: job.id }).length,
    );
    store.close();
  });

  it('puts nothing sealed into the new version or what its teacher is sent', async () => {
    const { job } = await field();
    const { jobId } = await api().jobs.moveToModel(job.id, QWEN);
    const sealed = orgTasks().filter((task) => !/^(train|dev)-/.test(task.id));
    const material = filesUnder(new DataPaths(world.dataDir).jobDir(jobId)).join('\n');
    for (const task of sealed) expect(material).not.toContain(task.id);
    for (const secret of ['HJ-9001', 'HT-901', 'Hillcrest policy']) {
      expect(material).not.toContain(secret);
    }

    world.mentor.requests.length = 0;
    await trained(await api().jobs.get(jobId));
    const sent = JSON.stringify(world.mentor.requests);
    for (const secret of ['HJ-9001', 'Hillcrest policy', ...sealed.map((task) => task.id)]) {
      expect(sent).not.toContain(secret);
    }
  });

  it('teaches the new model into a version of the same agent, which is used only once switched', async () => {
    const { job, graduateId } = await field();
    const { jobId } = await api().jobs.moveToModel(job.id, QWEN);
    const detail = await trained(await api().jobs.get(jobId));

    expect(detail.run.graduateId).toBe(graduateId);
    const versions = await api().graduates.versions(graduateId);
    expect(versions.map((version) => [version.version, version.active])).toEqual([
      [1, true],
      [2, false],
    ]);
    expect(versions[1]?.parent).toBe(1);
    expect(versions[1]?.manifest.model.base.name).toBe('qwen3:8b');
    const report = await api().graduates.report(graduateId, 2);
    expect(report.jobId).toBe(jobId);
    const oldModel = (await api().graduates.installation(graduateId)).model.model;
    expect(oldModel).toBe(job.student.local.model);

    // Switching answers on the new model; going back answers on the old one again.
    await api().graduates.acceptVersion(graduateId, 1);
    await api().graduates.acceptVersion(graduateId, 2);
    await api().graduates.promote(graduateId, 2);
    expect((await api().graduates.installation(graduateId)).model).toMatchObject({
      model: 'qwen3:8b',
      baseUrl: 'http://127.0.0.1:11434',
    });
    await api().graduates.rollback(graduateId, 1);
    expect((await api().graduates.installation(graduateId)).model.model).toBe(oldModel);
    const history = await api().graduates.history(graduateId);
    expect(history.map((event) => [event.kind, event.version])).toEqual(
      expect.arrayContaining([
        ['promoted', 2],
        ['rolled_back', 1],
      ]),
    );
  });

  it('refuses the same model, an older version, and a version another field made', async () => {
    const { job } = await field();
    await expect(
      api().jobs.moveToModel(job.id, { ...QWEN, student: job.student.local, label: 'Same' }),
    ).rejects.toThrow(/already runs on Same/);
    await expect(
      api().jobs.moveToModel(job.id, { ...QWEN, from: { graduateId: 'grd_none', version: 1 } }),
    ).rejects.toThrow(/wasn't made by this field/);
    const { jobId } = await api().jobs.moveToModel(job.id, QWEN);
    await expect(api().jobs.moveToModel(job.id, QWEN)).rejects.toThrow(/has a newer version/);
    await expect(api().jobs.teachOn(job.id, 'Hillcrest Prep')).rejects.toThrow(
      /has a newer version/,
    );
    expect((await api().jobs.field(jobId)).versionOf?.version).toBe(2);
  });
});
