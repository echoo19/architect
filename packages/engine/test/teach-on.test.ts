import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GuardError,
  type Job,
  type Organization,
  type RunEvent,
  type Task,
} from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectEngine, type EngineClient } from '../src/host/client';
import { createEngineHost, type EngineHost } from '../src/host/engine-host';
import { withVersions } from '../src/loop/job-versions';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore } from '../src/store/engine-store';
import { Vault } from '../src/vault/vault';
import { hypothesis } from './fakes/adapters';
import { TYPES } from './fakes/job';
import { portPair } from './fakes/ports';
import { createWorld, type World } from './fakes/world';
import { ORG_FILES, ORGS, orgJob, orgTask, writeOrgJobFolder } from './support/organizations';

/*
 * Teaching on a never-seen organization in a new version of the field (decision 089): the new
 * version teaches on its files and tasks, every other sealed organization stays sealed with
 * prints made afresh, and the field it came from, its runs and what they measured stay as they
 * were, read as measured before the organization was taught on.
 */

const MAPLE_FILES: Record<string, string> = {
  'jobs.csv': 'id,tech,minutes\nMJ-7001,MT-701,35\nMJ-7002,MT-702,80\n',
  'policy.md': '# Maple policy\nLabor is billed per started 20 minutes.\n',
};

/** As `orgTasks`, with Hillcrest's ids saying where the fake splitter puts them once taught on. */
function tasks(): Task[] {
  return TYPES.flatMap((type) => [
    ...['north', 'south'].flatMap((org) => [
      orgTask('train', org, type, 1),
      orgTask('dev', org, type, 1),
      orgTask('test', org, type, 1),
    ]),
    orgTask('train', 'hillcrest', type, 1),
    orgTask('dev', 'hillcrest', type, 2),
  ]);
}

/** Tasks of an organization added later, without `org`, as a person would write them. */
function addedTasks(org: string): Task[] {
  return TYPES.map((type) => {
    const { org: _org, ...task } = orgTask(org, org, type, 1);
    return task;
  });
}

function folderOf(root: string, files: Record<string, string>, list: Task[]): string {
  const dir = mkdtempSync(join(root, 'added-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  writeFileSync(join(dir, 'tasks.jsonl'), list.map((task) => JSON.stringify(task)).join('\n'));
  return dir;
}

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

/** A job's practice or check tasks, as the app lists them. */
async function visible(jobId: string, split: 'train' | 'dev'): Promise<Task[]> {
  const listing = await api().jobs.tasks(jobId, split);
  return 'tasks' in listing ? listing.tasks : [];
}

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

async function graduated(job: Job) {
  world.mentor.script = () =>
    hypothesis('Read the records', 'Branches.\nfix:invoice fix:overdue fix:scheduling');
  const run = await api().runs.start(job.id, { method: 'architect', seed: 7 });
  await finished(run.id);
  return run;
}

describe('teaching on a never-seen organization', () => {
  it('makes a new version and leaves the field it came from as it was, labeled', async () => {
    const job = await api().jobs.importFile(
      await writeOrgJobFolder(join(world.root, 'branches'), orgJob(), tasks()),
    );
    await confirmStudy(job);
    const run = await graduated(job);
    await api().jobs.addOrganization(job.id, {
      folder: folderOf(world.root, MAPLE_FILES, addedTasks('maple')),
      name: 'Maple Grove',
      synthetic: true,
    });
    const store = openEngineStore(new DataPaths(world.dataDir).database);
    const filed = store.reports.get(run.id, 'local');
    const ranBefore = store.runs.get(run.id);
    const sealedBefore = world.vault.count(job.id);
    const visibleBefore = await visible(job.id, 'train');

    const view = await api().jobs.teachOn(job.id, 'Hillcrest Prep');
    const next = await api().jobs.get(view.jobId);
    expect(next.id).toBe('branches-v2');
    expect(next.name).toBe(`${job.name} v2`);
    expect(view.versionOf).toEqual({
      jobId: job.id,
      name: job.name,
      version: 2,
      org: 'Hillcrest Prep',
    });
    expect(next.organizations?.map((org) => [org.id, org.role])).toEqual([
      ['north', 'train'],
      ['south', 'train'],
      ['hillcrest', 'train'],
    ]);
    // Its files are material now, and its tasks are practice and check tasks.
    expect(view.organizations.find((org) => org.id === 'hillcrest')?.files).toHaveLength(2);
    const train = await visible(next.id, 'train');
    const dev = await visible(next.id, 'dev');
    expect(train.filter((task) => task.org === 'hillcrest')).toHaveLength(TYPES.length);
    expect(dev.filter((task) => task.org === 'hillcrest')).toHaveLength(TYPES.length);
    expect(next.splits).toEqual({
      ...job.splits,
      train: job.splits.train + TYPES.length,
      dev: job.splits.dev + TYPES.length,
    });
    // Budgets are the field's own, untouched.
    expect(next.budget).toEqual(job.budget);
    // The final test keeps the taught organizations' tasks; Maple Grove is sealed again.
    const sealed = world.vault.transfer.get(next.id)?.map(({ org }) => org.id);
    expect(sealed).toEqual(['maple-grove']);
    expect(world.vault.count(next.id)).toBe(sealedBefore - 2 * TYPES.length + TYPES.length);

    // The field it came from is unchanged, and says where Hillcrest Prep is taught on now.
    expect(await api().jobs.get(job.id)).toEqual(job);
    expect(await visible(job.id, 'train')).toEqual(visibleBefore);
    expect(world.vault.count(job.id)).toBe(sealedBefore);
    const sealedView = { name: 'Hillcrest Prep', synthetic: false, files: 2 };
    const old = withVersions({ ...(await api().jobs.field(job.id)), sealed: [sealedView] }, store);
    expect(old.sealed).toEqual([{ ...sealedView, taughtIn: { jobId: next.id, name: next.name } }]);
    expect(old.versionOf).toBeUndefined();
    // Its results are kept as measured and read as measured before it was taught on.
    const report = await api().reports.get(run.id);
    const rows = report.test.perOrg ?? [];
    const hillcrest = rows.filter((row) => row.org === 'hillcrest');
    expect(hillcrest.length).toBeGreaterThan(0);
    expect(hillcrest.every((row) => row.taughtLater === true && !row.seen)).toBe(true);
    expect(rows.filter((row) => row.org !== 'hillcrest').some((row) => row.taughtLater)).toBe(
      false,
    );
    expect(store.reports.get(run.id, 'local')).toEqual(filed);
    expect(store.runs.get(run.id)).toEqual(ranBefore);
    store.close();

    // One line of versions: the next one is taught on from the newest.
    await expect(api().jobs.teachOn(job.id, 'Maple Grove')).rejects.toThrow(
      /already has a newer version, .* v2/,
    );
    await expect(api().jobs.teachOn(next.id, 'Nowhere Prep')).rejects.toThrow(
      /no never-seen organization called Nowhere Prep/,
    );
  });

  it("teaches the new version with the organization's files, never the ones still sealed", async () => {
    const job = await api().jobs.importFile(
      await writeOrgJobFolder(join(world.root, 'branches'), orgJob(), tasks()),
    );
    await confirmStudy(job);
    await api().jobs.addOrganization(job.id, {
      folder: folderOf(world.root, MAPLE_FILES, addedTasks('maple')),
      name: 'Maple Grove',
      synthetic: true,
    });
    const { jobId } = await api().jobs.teachOn(job.id, 'Hillcrest Prep');
    const next = await api().jobs.get(jobId);
    // The study read other files, so the new version is studied again before it trains.
    await expect(api().runs.start(next.id, { method: 'architect', seed: 7 })).rejects.toThrow(
      /study|studied/i,
    );
    world.mentor.requests.length = 0;
    await confirmStudy(next);
    await graduated(next);
    const sent = JSON.stringify(world.mentor.requests);
    expect(sent).toContain('Hillcrest Prep');
    expect(sent).toContain('HJ-9001');
    for (const secret of ['maple', 'Maple', 'MJ-7001']) expect(sent).not.toContain(secret);
    // The new version's final test never opened a task of the organization it now teaches on.
    expect(world.vault.released).toEqual([`${job.id}:hillcrest`]);

    // A fresh cohort of Hillcrest Prep's work is sealed as a new never-seen organization.
    const fresh = await api().jobs.addOrganization(next.id, {
      folder: folderOf(world.root, ORG_FILES['hillcrest'] ?? {}, addedTasks('hill2')),
      name: 'Hillcrest Prep fresh cohort',
      synthetic: false,
    });
    expect(world.vault.transferIdentifiers(next.id).map((org) => org.name)).toEqual([
      'Maple Grove',
      'Hillcrest Prep fresh cohort',
    ]);
    expect(fresh.versionOf?.org).toBe('Hillcrest Prep');
  });
});

describe('the vault around a new version', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const hillcrest = ORGS.find((org) => org.id === 'hillcrest') as Organization;
  const maple: Organization = {
    id: 'maple',
    name: 'Maple Grove',
    synthetic: true,
    role: 'transfer',
  };
  const filesOf = (files: Record<string, string>) =>
    Object.entries(files).map(([name, content]) => ({ name, content }));
  const mapleTasks = () => addedTasks('maple').map((task) => ({ ...task, org: 'maple' }));

  function sealed() {
    const root = mkdtempSync(join(tmpdir(), 'architect-version-vault-'));
    roots.push(root);
    const vault = new Vault(root);
    const all = tasks();
    const hidden = all.filter((task) => task.org === 'hillcrest' || task.id.startsWith('test-'));
    const others = all.filter((task) => !hidden.includes(task));
    vault.seal(
      'branches',
      hidden,
      others,
      [],
      [{ org: hillcrest, files: filesOf(ORG_FILES['hillcrest'] ?? {}) }],
    );
    vault.addOrganization(
      'branches',
      { org: maple, files: filesOf(MAPLE_FILES) },
      mapleTasks(),
      others,
      [],
    );
    return { vault, root, all, others };
  }

  it('reseals what stays never seen and lets through what is now taught on', () => {
    const { vault, root, all, others } = sealed();
    const dir = join(root, 'vault', 'branches');
    const before = ['fingerprint.json', 'test.jsonl', join('added', 'maple', 'seal.json')].map(
      (name) => readFileSync(join(dir, name), 'utf8'),
    );
    const released = vault.releaseOrganization('branches', 'hillcrest');
    expect(released.org).toEqual(hillcrest);
    expect(released.files.map((file) => file.name).sort()).toEqual(['jobs.csv', 'policy.md']);
    expect(released.tasks.map((task) => task.id)).toEqual(
      all.filter((task) => task.org === 'hillcrest').map((task) => task.id),
    );

    const visible = [...others, ...released.tasks];
    vault.sealVersion('branches', 'branches-v2', 'hillcrest', visible, [
      ORG_FILES['hillcrest']?.['jobs.csv'] ?? '',
    ]);
    // The field it came from is read, never written.
    expect(
      ['fingerprint.json', 'test.jsonl', join('added', 'maple', 'seal.json')].map((name) =>
        readFileSync(join(dir, name), 'utf8'),
      ),
    ).toEqual(before);
    expect(vault.transferIdentifiers('branches-v2')).toEqual([
      { id: 'maple', name: 'Maple Grove' },
    ]);
    expect(vault.count('branches-v2')).toBe(
      all.filter((task) => task.id.startsWith('test-')).length + mapleTasks().length,
    );

    const detector = vault.leakDetector('branches-v2');
    // Hillcrest Prep is taught on now: its name, records and tasks may reach the teacher.
    expect(detector.scan('Hillcrest Prep bills per started 10 minutes; see HJ-9001.').leaked).toBe(
      false,
    );
    expect(detector.scan(released.tasks[0]?.prompt ?? '').leaked).toBe(false);
    // What stays sealed is still refused: a taught test task, Maple Grove's tasks and its name.
    const test = all.find((task) => task.id.startsWith('test-'));
    expect(detector.scan(test?.prompt ?? '').leaked).toBe(true);
    expect(detector.scan(mapleTasks()[0]?.prompt ?? '').leaked).toBe(true);
    expect(detector.scan('It should work at Maple Grove as well.').leaked).toBe(true);

    // A fresh cohort of Hillcrest Prep's work joins the new version as never seen, fingerprinted.
    const cohort: Organization = {
      id: 'hillcrest-fresh-cohort',
      name: 'Hillcrest Prep fresh cohort',
      synthetic: false,
      role: 'transfer',
    };
    const cohortTasks = addedTasks('hill2').map((task) => ({ ...task, org: cohort.id }));
    vault.addOrganization(
      'branches-v2',
      { org: cohort, files: filesOf(ORG_FILES['hillcrest'] ?? {}) },
      cohortTasks,
      visible,
      [],
    );
    const after = vault.leakDetector('branches-v2');
    expect(after.scan(cohortTasks[0]?.prompt ?? '').leaked).toBe(true);
    expect(after.scan('Try the Hillcrest Prep fresh cohort next.').leaked).toBe(true);
  });

  it('refuses a sealed file changed since sealing, and an organization it never sealed', () => {
    const { vault, root } = sealed();
    expect(() => vault.releaseOrganization('branches', 'north')).toThrow(GuardError);
    const file = join(root, 'vault', 'branches', 'transfer', 'hillcrest', 'data', 'jobs.csv');
    writeFileSync(file, `${readFileSync(file, 'utf8')}HJ-9999,HT-999,5\n`);
    expect(() => vault.releaseOrganization('branches', 'hillcrest')).toThrow(/changed/);
    expect(() => vault.sealVersion('branches', 'branches-v2', 'maple', [], [])).toThrow(/changed/);
    expect(vault.isSealed('branches-v2')).toBe(false);
  });
});
