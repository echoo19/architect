import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GuardError,
  type FieldView,
  type Job,
  type Organization,
  type RunEvent,
  type Task,
} from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectEngine, type EngineClient } from '../src/host/client';
import { createEngineHost, type EngineHost } from '../src/host/engine-host';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore } from '../src/store/engine-store';
import { releaseMentor, type MentorReleased } from '../src/vault/gate';
import { Vault } from '../src/vault/vault';
import { hypothesis } from './fakes/adapters';
import { portPair } from './fakes/ports';
import { createWorld, type World } from './fakes/world';
import { ORG_FILES, ORGS, orgTask, orgTasks, writeOrgJobFolder } from './support/organizations';
import { TYPES } from './fakes/job';

/*
 * An organization sealed into a field after it was made, and a frozen version qualified on it
 * (decision 085): its files checked against the field's, its tasks sealed beside the job's seal,
 * never shown to a mentor, and its results in the report marked as added later.
 */

const MAPLE_FILES: Record<string, string> = {
  'jobs.csv': 'id,tech,minutes\nMJ-7001,MT-701,35\nMJ-7002,MT-702,80\n',
  'policy.md': '# Maple policy\nLabor is billed per started 20 minutes.\n',
};

/** Two tasks of each type at Maple Grove, without `org`, as a person would write them. */
function mapleTasks(): Task[] {
  return TYPES.flatMap((type) =>
    [1, 2].map((n) => {
      const { org: _org, ...task } = orgTask('maple', 'maple-grove', type, n);
      return task;
    }),
  );
}

function folderOf(root: string, files: Record<string, string>, tasks?: Task[]): string {
  const dir = mkdtempSync(join(root, 'maple-'));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  if (tasks !== undefined) {
    writeFileSync(join(dir, 'tasks.jsonl'), tasks.map((task) => JSON.stringify(task)).join('\n'));
  }
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

/** The run's graduate is ready. */
function finished(runId: string): Promise<void> {
  return new Promise((resolve) => {
    const stop = api().runs.onEvent((event: RunEvent) => {
      if (event.type !== 'graduate.ready' || event.runId !== runId) return;
      stop();
      resolve();
    });
  });
}

async function importOrgJob(): Promise<Job> {
  return api().jobs.importFile(await writeOrgJobFolder(join(world.root, 'branches')));
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

/** The qualifications once none is testing. */
async function settled(jobId: string): Promise<FieldView['qualifications']> {
  for (;;) {
    const { qualifications } = await api().jobs.field(jobId);
    if (qualifications?.every((item) => item.status !== 'testing')) return qualifications;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('an organization added to a field later', () => {
  it('is sealed, qualified on and reported as added later, and never reaches a mentor', async () => {
    const job = await importOrgJob();
    await confirmStudy(job);
    const run = await graduated(job);
    const store = openEngineStore(new DataPaths(world.dataDir).database);
    const card = store.reports.get(run.id, 'local');

    // While it trained, the check score was kept at each organization it is taught on too.
    const trained = store.runs.get(run.id)?.run;
    expect(trained?.devByOrg?.map((org) => org.org)).toEqual(['north', 'south']);
    expect(trained?.devByOrg?.reduce((sum, org) => sum + org.total, 0)).toBe(
      trained?.devCurrent?.total,
    );
    const measured = store.experiments.list(run.id).flatMap((item) => item.measurements);
    expect(measured.length).toBeGreaterThan(0);
    expect(measured.every((item) => item.perOrg?.length === 2)).toBe(true);

    await api().jobs.addOrganization(job.id, {
      folder: folderOf(world.root, MAPLE_FILES, mapleTasks()),
      name: 'Maple Grove',
      synthetic: true,
    });
    const [added] = world.vault.added.get(job.id) ?? [];
    expect(added?.org).toEqual({
      id: 'maple-grove',
      name: 'Maple Grove',
      synthetic: true,
      role: 'transfer',
    });
    expect(added?.tasks.map((task) => task.org)).toEqual(Array(6).fill('maple-grove'));
    // Nothing of it is written to the job.
    expect(JSON.stringify(await api().jobs.get(job.id))).not.toContain('maple');
    expect((await world.vault.transferIdentifiers(job.id)).map((org) => org.name)).toContain(
      'Maple Grove',
    );

    await api().runs.qualify(run.id, 'Maple Grove');
    expect(await settled(job.id)).toEqual([
      expect.objectContaining({
        runId: run.id,
        org: 'Maple Grove',
        status: 'finished',
        score: { pass: 6, total: 6 },
      }),
    ]);
    const report = await api().reports.get(run.id);
    const rows = report.test.perOrg?.filter((row) => row.org === 'maple-grove') ?? [];
    expect(rows).toHaveLength(TYPES.length);
    expect(rows.every((row) => row.addedLater === true && !row.seen && row.total === 2)).toBe(true);
    // The card as filed, its score and the run's own locked test stay as they were.
    expect(store.reports.get(run.id, 'local')).toEqual(card);
    expect(report.test.score).toEqual(card?.test.score);
    store.close();
    await expect(api().runs.qualify(run.id, 'Maple Grove')).rejects.toThrow(/already qualified/);

    // A later run's mentor never sees it.
    world.mentor.requests.length = 0;
    await graduated(job);
    const sent = JSON.stringify(world.mentor.requests);
    expect(sent).toContain('North Branch');
    for (const secret of ['maple', 'Maple', 'MJ-7001']) expect(sent).not.toContain(secret);
  });

  it('refuses a folder that lacks a column, a name taken, and tasks with no source', async () => {
    const job = await importOrgJob();
    const lacking = folderOf(
      world.root,
      { ...MAPLE_FILES, 'jobs.csv': 'id,minutes\nMJ-1,3\n' },
      mapleTasks(),
    );
    await expect(
      api().jobs.addOrganization(job.id, { folder: lacking, name: 'Maple Grove', synthetic: true }),
    ).rejects.toThrow('jobs.csv has no tech column.');
    const fits = folderOf(world.root, MAPLE_FILES, mapleTasks());
    await expect(
      api().jobs.addOrganization(job.id, { folder: fits, name: 'Hillcrest Prep', synthetic: true }),
    ).rejects.toThrow(/already has an organization called Hillcrest Prep/);
    await expect(
      api().jobs.addOrganization(job.id, {
        folder: folderOf(world.root, MAPLE_FILES),
        name: 'Maple Grove',
        synthetic: true,
      }),
    ).rejects.toThrow(/has no tasks.jsonl/);
    const stranger = [{ ...orgTask('maple', 'north', 'invoice', 9) }];
    await expect(
      api().jobs.addOrganization(job.id, {
        folder: folderOf(world.root, MAPLE_FILES, stranger),
        name: 'Maple Grove',
        synthetic: true,
      }),
    ).rejects.toThrow(/must be Maple Grove's/);
    expect(world.vault.added.get(job.id)).toBeUndefined();
  });
});

describe('the vault around an organization added later', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  const maple: Organization = {
    id: 'maple-grove',
    name: 'Maple Grove',
    synthetic: true,
    role: 'transfer',
  };
  const files = Object.entries(MAPLE_FILES).map(([name, content]) => ({ name, content }));
  const tasks = () => mapleTasks().map((task) => ({ ...task, org: maple.id }));

  function sealed() {
    const root = mkdtempSync(join(tmpdir(), 'architect-added-vault-'));
    roots.push(root);
    const vault = new Vault(root);
    const all = orgTasks();
    const hidden = all.filter((task) => task.org === 'hillcrest' || task.id.startsWith('test-'));
    const others = all.filter((task) => !hidden.includes(task));
    const hillcrest = ORGS.find((org) => org.id === 'hillcrest') as Organization;
    const hillFiles = Object.entries(ORG_FILES['hillcrest'] ?? {}).map(([name, content]) => ({
      name,
      content,
    }));
    vault.seal('branches', hidden, others, [], [{ org: hillcrest, files: hillFiles }]);
    return { vault, root, others };
  }

  it("leaves the job's seal as it was and holds the mentor to the new tasks and name", () => {
    const { vault, root, others } = sealed();
    const dir = join(root, 'vault', 'branches');
    const before = ['fingerprint.json', 'test.jsonl'].map((name) =>
      readFileSync(join(dir, name), 'utf8'),
    );
    const detector = vault.leakDetector('branches');
    const prompt = tasks()[0]?.prompt ?? '';
    expect(detector.scan(prompt).leaked).toBe(false);

    vault.addOrganization('branches', { org: maple, files }, tasks(), others, []);
    expect(
      ['fingerprint.json', 'test.jsonl'].map((name) => readFileSync(join(dir, name), 'utf8')),
    ).toEqual(before);
    const after = vault.leakDetector('branches');
    expect(after.scan(prompt).leaked).toBe(true);
    expect(after.scan('It should work at Maple Grove as well.').leaked).toBe(true);
    // What was refused before still is.
    expect(after.scan('The agent should work for Hillcrest Prep too.').leaked).toBe(true);
    expect(vault.sealedOrganizations('branches').at(-1)).toEqual({
      name: 'Maple Grove',
      synthetic: true,
      files: 2,
      addedLater: true,
    });
  });

  it('opens its tasks only on the release proof, and refuses them once changed', async () => {
    const { vault, root, others } = sealed();
    vault.addOrganization('branches', { org: maple, files }, tasks(), others, []);
    expect(() => vault.openAdded('branches', maple.id, {} as MentorReleased)).toThrow(GuardError);
    const proof = await releaseMentor({ dispose: () => undefined });
    expect(vault.openAdded('branches', maple.id, proof)).toEqual(tasks());
    expect(vault.openTransfer('branches', proof).dataDirs[maple.id]).toBeDefined();
    const file = join(root, 'vault', 'branches', 'added', maple.id, 'tasks.jsonl');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n`);
    expect(() => vault.openAdded('branches', maple.id, proof)).toThrow(GuardError);
  });

  it('refuses a second organization of the same name, a task id taken, and an unsealed job', () => {
    const { vault, others } = sealed();
    vault.addOrganization('branches', { org: maple, files }, tasks(), others, []);
    expect(() =>
      vault.addOrganization(
        'branches',
        { org: { ...maple, id: 'maple-2' }, files },
        [],
        others,
        [],
      ),
    ).toThrow(/already sealed/);
    const taken = [{ ...tasks()[0], id: others[0]?.id ?? '', org: 'oak' } as Task];
    expect(() =>
      vault.addOrganization(
        'branches',
        { org: { ...maple, id: 'oak', name: 'Oak' }, files },
        taken,
        others,
        [],
      ),
    ).toThrow(/already taken/);
    expect(() =>
      vault.addOrganization('other', { org: maple, files }, tasks(), others, []),
    ).toThrow(/has not been sealed/);
  });
});
