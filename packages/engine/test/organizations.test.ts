import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CodedError,
  GuardError,
  type FileEdit,
  type Job,
  type Organization,
  type Task,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { JobStudy } from '../src/drafting/studying';
import { openAgentFiles } from '../src/files/agent-files';
import { exportPackage } from '../src/graduates/exporter';
import { orgFactsProblem } from '../src/loop/lookup';
import { organizationProblem, taskDataDir } from '../src/loop/organizations';
import { splitTasks } from '../src/splits/split';
import { releaseMentor, type MentorReleased } from '../src/vault/gate';
import { Vault } from '../src/vault/vault';
import { hypothesis } from './fakes/adapters';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';
import { attach, THIS_MACHINE, type Computer } from './support/computer';
import {
  filesHolding,
  ORG_FILES,
  ORGS,
  orgJob,
  orgTask,
  orgTasks,
  writeOrgJobFolder,
} from './support/organizations';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The tutor's job as it ships: its academies, tasks and checker, read-only. */
const ACADEMY_JOB = join(REPO, 'examples', 'academy', 'job');
/** An academy export with records only: no question text, errors, hints, staff or videos. */
const STEMLESS_ACADEMY = join(REPO, 'examples', 'academy', 'test', 'fixtures', 'records');

let world: World;
let engine: Engine;
const opened: { engine: Engine; world: World }[] = [];
const computers: Computer[] = [];

afterEach(async () => {
  for (const computer of computers.splice(0)) computer.close();
  for (const { engine: done, world: made } of opened.splice(0)) {
    await done.close();
    made.cleanup();
  }
});

async function importOrgJob(job?: Job, tasks?: Task[]): Promise<Job> {
  world = await createWorld();
  engine = openEngine(world);
  opened.push({ engine, world });
  return engine.jobs.importFile(await writeOrgJobFolder(join(world.root, 'branches'), job, tasks));
}

async function refusal(job: Job, tasks: Task[]): Promise<unknown> {
  return importOrgJob(job, tasks).then(
    () => null,
    (error: unknown) => error,
  );
}

describe('a job with organizations, when it is made', () => {
  it('keeps the trained organizations in the job folder and seals the unseen one in the vault', async () => {
    const job = await importOrgJob();
    expect(job.organizations?.map((org) => org.id)).toEqual(['north', 'south']);
    const jobDir = engine.paths.jobDir(job.id);
    expect(readFileSync(join(jobDir, 'orgs', 'north', 'data', 'jobs.csv'), 'utf8')).toBe(
      ORG_FILES['north']?.['jobs.csv'],
    );
    expect(readFileSync(join(jobDir, 'orgs', 'south', 'data', 'policy.md'), 'utf8')).toBe(
      ORG_FILES['south']?.['policy.md'],
    );
    // Nothing the job folder holds names the unseen organization or any of its records.
    expect(await filesHolding(jobDir, 'hillcrest')).toEqual([]);
    expect(await filesHolding(jobDir, 'HJ-9001')).toEqual([]);

    const visible = [
      ...(await engine.jobs.tasks(job.id, 'train')),
      ...(await engine.jobs.tasks(job.id, 'dev')),
      ...(await engine.jobs.tasks(job.id, 'calibration')),
    ];
    expect(visible.some((task) => task.org === 'hillcrest')).toBe(false);
    const sealed = world.vault.openForLockedTest(
      job.id,
      await world.runtime.releaseMentor({
        jobId: job.id,
        runId: 'run_peek',
        mentor: null,
      }),
    );
    expect(sealed.filter((task) => task.org === 'hillcrest')).toHaveLength(6);
    expect(sealed.filter((task) => task.id.startsWith('test-'))).toHaveLength(6);
    const [transfer] = world.vault.transfer.get(job.id) ?? [];
    expect(transfer?.org).toMatchObject({ id: 'hillcrest', role: 'transfer', synthetic: false });
    expect(transfer?.files.map((file) => file.name)).toEqual(['jobs.csv', 'policy.md']);
  });

  it('refuses tasks that do not fit the organizations, saying why', async () => {
    const tasks = orgTasks();
    const { org: _org, ...unnamed } = orgTask('train', 'north', 'invoice', 9);
    expect(await refusal(orgJob(), [...tasks, unnamed])).toMatchObject({
      code: 'not_a_job',
      message: expect.stringContaining('names no organization'),
    });
    expect(
      await refusal(orgJob(), [...tasks, orgTask('train', 'east', 'invoice', 9)]),
    ).toBeInstanceOf(CodedError);
    expect(
      await refusal(
        orgJob(),
        tasks.filter((task) => task.org !== 'hillcrest'),
      ),
    ).toMatchObject({
      code: 'not_a_job',
      message: expect.stringContaining('nothing would test it'),
    });
  });

  it('seals an unseen academy whose export lacks the optional files, and opens its folder', async () => {
    world = await createWorld();
    engine = openEngine(world);
    opened.push({ engine, world });
    // The tutor's job, with a real-style academy that has records but no question text, errors,
    // hints, staff, topics, videos or staff notes, and a policy without the optional rows.
    const dir = join(world.root, 'academy');
    cpSync(ACADEMY_JOB, dir, { recursive: true });
    const fixture = join(dir, 'orgs', 'fixture', 'data');
    cpSync(STEMLESS_ACADEMY, fixture, { recursive: true });
    const policy = readFileSync(join(fixture, 'policy.md'), 'utf8')
      .split('\n')
      .filter((line) => !/^\| (Days those wrong answers|First hint) /.test(line))
      .join('\n');
    writeFileSync(join(fixture, 'policy.md'), policy);
    const source = JSON.parse(readFileSync(join(dir, 'job.json'), 'utf8')) as Job;
    const academy: Organization = {
      id: 'fixture',
      name: 'Fixture Academy',
      synthetic: false,
      role: 'transfer',
    };
    writeFileSync(
      join(dir, 'job.json'),
      JSON.stringify({ ...source, organizations: [...(source.organizations ?? []), academy] }),
    );
    const extra: Task = {
      id: 'fixture-history-01',
      type: 'history',
      family: 'fixture:P1:Transitions',
      org: 'fixture',
      prompt: 'How is P1 doing on Transitions?',
      expected: { kind: 'facts', facts: [{ path: 'attempts', value: 2 }] },
    };
    writeFileSync(
      join(dir, 'tasks.jsonl'),
      `${readFileSync(join(dir, 'tasks.jsonl'), 'utf8').trimEnd()}\n${JSON.stringify(extra)}\n`,
    );

    const job = await engine.jobs.importFile(join(dir, 'job.json'));
    const sealed = (world.vault.transfer.get(job.id) ?? []).find(
      (item) => item.org.id === 'fixture',
    );
    const present = readdirSync(STEMLESS_ACADEMY).sort();
    const declared = job.data.files.map((file) => file.name);
    expect(sealed?.files.map((file) => file.name).sort()).toEqual(
      present.filter((name) => declared.includes(name)),
    );
    // The agent's folder opens on it with every file the job declares, the absent optional ones
    // simply not there.
    const files = await openAgentFiles({
      dataDir: fixture,
      files: job.data.files,
      mode: 'scratch',
    });
    const paths = files.list().map((file) => file.path);
    expect(paths).toContain('data/attempts.csv');
    expect(paths).not.toContain('data/hints.csv');
    expect(paths).not.toContain('data/errors.csv');
  });

  it('does not name the unseen organization when one of its files is missing', async () => {
    world = await createWorld();
    engine = openEngine(world);
    opened.push({ engine, world });
    const dir = join(world.root, 'branches');
    const file = await writeOrgJobFolder(dir);
    rmSync(join(dir, 'orgs', 'hillcrest', 'data', 'jobs.csv'));
    const error = await engine.jobs.importFile(file).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/sealed organization is missing/);
    expect((error as Error).message).not.toMatch(/hillcrest|jobs\.csv/i);
  });

  it('says what is wrong with organizations before anything is made', () => {
    const job = orgJob();
    const north = orgTask('train', 'north', 'invoice', 1);
    expect(organizationProblem(job, [north, { ...north, id: 'x-1', org: 'south' }])).toContain(
      'a family stays in one organization',
    );
    expect(
      organizationProblem(
        orgJob({ organizations: job.organizations?.filter((org) => org.role === 'transfer') }),
        [],
      ),
    ).toContain('no organization to train on');
    const { organizations: _orgs, ...plain } = job;
    expect(organizationProblem(plain, [north])).toContain('lists no organizations');
    expect(organizationProblem(plain, [{ ...north, org: undefined }])).toBeNull();
  });

  it('binds a task of an organization to its files, and a sealed one only through the test', () => {
    expect(taskDataDir('/jobs/b', {})).toBe(join('/jobs/b', 'data'));
    expect(taskDataDir('/jobs/b', { org: 'north' })).toBe(join('/jobs/b', 'orgs', 'north', 'data'));
    expect(taskDataDir('/jobs/b', { org: 'hillcrest' }, { hillcrest: '/vault/h' })).toBe(
      '/vault/h',
    );
    // An id that names an inherited property is an organization's folder like any other.
    for (const org of ['constructor', 'toString', '__proto__']) {
      expect(taskDataDir('/jobs/b', { org }, {})).toBe(join('/jobs/b', 'orgs', org, 'data'));
    }
  });

  it('spreads every organization over every split', () => {
    const tasks: Task[] = [];
    for (const org of ['north', 'south']) {
      for (let n = 1; n <= 6; n += 1) tasks.push(orgTask('t', org, 'invoice', n));
    }
    const splits = splitTasks(tasks, { seed: 3, calibration: 0, train: 4, dev: 4, test: 4 });
    for (const split of [splits.train, splits.dev, splits.test]) {
      expect(split.filter((task) => task.org === 'north')).toHaveLength(2);
      expect(split.filter((task) => task.org === 'south')).toHaveLength(2);
    }
  });
});

/** Studies the job's train organizations with a scripted brief and confirms it, as a run needs. */
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
  const study = new JobStudy({
    jobs: engine.jobs,
    paths: engine.paths,
    deps: world.deps,
    clock: world.clock,
  });
  const state = await study.study(job.id);
  await engine.jobs.confirmStudy(job.id, state.token);
}

describe('a run of a job with organizations', () => {
  async function graduated() {
    const job = await importOrgJob();
    await confirmStudy(job);
    world.mentor.script = () =>
      hypothesis('Read the records', 'Branches.\nfix:invoice fix:overdue fix:scheduling');
    const bound: { taskId: string; sealed: string | undefined }[] = [];
    world.runtime.beforeAttempt = (task, ctx) => {
      bound.push({ taskId: task.id, sealed: ctx.sealedData?.[task.org ?? ''] });
    };
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);
    const record = engine.store.runs.get(run.id);
    expect(record?.run.status).toBe('finished');
    return { job, run, bound, graduateId: record?.run.graduateId ?? '' };
  }

  it('streams nothing of the locked test that could name the unseen organization', async () => {
    await graduated();
    const ready = engine.events.findIndex((event) => event.type === 'graduate.ready');
    expect(ready).toBeGreaterThan(0);
    expect(JSON.stringify(engine.events.slice(0, ready)).toLowerCase()).not.toContain('hillcrest');
  });

  it('takes the unseen organization only in the locked test, on its sealed files', async () => {
    const { bound } = await graduated();
    const sealed = bound.filter((attempt) => attempt.taskId.startsWith('xfer-'));
    expect(sealed).toHaveLength(6);
    expect(sealed.every((attempt) => attempt.sealed === `sealed:branches/hillcrest`)).toBe(true);
    const first = bound.findIndex((attempt) => attempt.taskId.startsWith('xfer-'));
    expect(bound.slice(first).some((attempt) => /^(train|dev)-/.test(attempt.taskId))).toBe(false);
    const unsealed = bound.filter((attempt) => !attempt.taskId.startsWith('xfer-'));
    expect(unsealed.every((attempt) => attempt.sealed === undefined)).toBe(true);
  });

  it('never shows the mentor the unseen organization, in prompts, traces or lineage', async () => {
    const { job, run } = await graduated();
    const sent = JSON.stringify(world.mentor.requests);
    expect(sent).toContain('North Branch');
    expect(sent).toContain('# Organizations');
    for (const secret of ['hillcrest', 'Hillcrest', 'HJ-9001', 'xfer-']) {
      expect(sent).not.toContain(secret);
    }
    const runDir = engine.paths.runDir(job.id, run.id);
    for (const part of ['mentor', 'traces', 'harness', 'lineage.jsonl', 'job.json']) {
      expect(await filesHolding(join(runDir, part), 'hillcrest')).toEqual([]);
    }
  });

  it('reports each type at each organization, seen or unseen, synthetic or real', async () => {
    const { run } = await graduated();
    const report = engine.store.reports.get(run.id, 'local');
    // The score is the organizations it trained on; the unseen one is reported on its own.
    expect(report?.test.score).toEqual({ pass: 6, total: 6 });
    expect(report?.test.perType.map((type) => type.total)).toEqual([2, 2, 2]);
    expect(report?.test.perOrg?.filter((row) => row.type === 'invoice')).toEqual([
      expect.objectContaining({ org: 'north', seen: true, synthetic: true, pass: 1, total: 1 }),
      expect.objectContaining({ org: 'south', seen: true, synthetic: true, pass: 1, total: 1 }),
      expect.objectContaining({
        org: 'hillcrest',
        orgName: 'Hillcrest Prep',
        seen: false,
        synthetic: false,
        pass: 2,
        total: 2,
      }),
    ]);
  });

  it('installs the graduate on one organization, exports it, and binds it to another', async () => {
    const { graduateId, run } = await graduated();
    const workspace = engine.paths.workspaceDir(graduateId);
    expect(await readFile(join(workspace, 'jobs.csv'), 'utf8')).toBe(
      ORG_FILES['north']?.['jobs.csv'],
    );

    const author = attach(world.dataDir, THIS_MACHINE, world.clock);
    computers.push(author);
    const exported = await exportPackage(
      { library: author.library, secrets: { get: async () => undefined } },
      graduateId,
      { directory: join(world.root, 'exports') },
    );
    // The package carries the real organization's results under an anonymous label only.
    expect(await filesHolding(exported.folder, 'hillcrest')).toEqual([]);
    expect(await filesHolding(exported.folder, 'HJ-9001')).toEqual([]);
    const packaged = JSON.parse(
      await readFile(join(exported.folder, 'evidence', 'report.json'), 'utf8'),
    ) as { test: { per_org: { org: string; org_name: string; seen: boolean }[] } };
    expect(packaged.test.per_org.filter((row) => !row.seen)).toEqual([
      expect.objectContaining({ org: 'real-1', org_name: 'Real organization' }),
      expect.objectContaining({ org: 'real-1', org_name: 'Real organization' }),
      expect.objectContaining({ org: 'real-1', org_name: 'Real organization' }),
    ]);
    // The app's own card keeps the name.
    expect(
      engine.store.reports
        .get(run.id, 'local')
        ?.test.perOrg?.some((row) => row.orgName === 'Hillcrest Prep'),
    ).toBe(true);
    const south = join(world.root, 'branches', 'orgs', 'south', 'data');
    const installation = await author.library.bind(graduateId, { bindings: { data: south } });
    expect(installation.bindings['data']).toBe(south);
  });
});

describe('the vault around an organization the job never trains on', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function sealed() {
    const root = mkdtempSync(join(tmpdir(), 'architect-orgs-vault-'));
    roots.push(root);
    const vault = new Vault(root);
    const tasks = orgTasks();
    const hidden = tasks.filter((task) => task.org === 'hillcrest' || task.id.startsWith('test-'));
    const others = tasks.filter((task) => !hidden.includes(task));
    const files = Object.entries(ORG_FILES['hillcrest'] ?? {}).map(([name, content]) => ({
      name,
      content,
    }));
    const hillcrest = ORGS.find((org) => org.id === 'hillcrest') as Organization;
    vault.seal('branches', hidden, others, [], [{ org: hillcrest, files }]);
    return { vault, root };
  }

  it('counts its name and id as test content in any text bound for the mentor', () => {
    const { vault } = sealed();
    const detector = vault.leakDetector('branches');
    expect(detector.scan('The agent should work for Hillcrest Prep too.').leaked).toBe(true);
    expect(detector.scan('Read data/policy.md for hillcrest.').leaked).toBe(true);
    expect(detector.scan('North Branch bills per started 15 minutes.').leaked).toBe(false);
  });

  it('opens its files only on the release proof, and refuses them once changed', async () => {
    const { vault, root } = sealed();
    expect(() => vault.openTransfer('branches', {} as MentorReleased)).toThrow(GuardError);
    const proof = await releaseMentor({ dispose: () => undefined });
    const opened = vault.openTransfer('branches', proof);
    expect(opened.organizations.map((org) => org.name)).toEqual(['Hillcrest Prep']);
    const folder = opened.dataDirs['hillcrest'] ?? '';
    expect(folder.startsWith(join(root, 'vault', 'branches'))).toBe(true);
    expect(readFileSync(join(folder, 'jobs.csv'), 'utf8')).toBe(
      ORG_FILES['hillcrest']?.['jobs.csv'],
    );
    writeFileSync(join(folder, 'policy.md'), '# Hillcrest policy\nBill nothing.\n');
    expect(() => vault.openTransfer('branches', proof)).toThrow(GuardError);
  });
});

describe("a change set that writes one organization's facts into the harness", () => {
  const texts = Object.entries(ORG_FILES)
    .filter(([org]) => org !== 'hillcrest')
    .map(([org, files]) => ({ org, text: Object.values(files).join('\n') }));
  const write = (content: string): FileEdit[] => [{ op: 'write', path: 'AGENTS.md', content }];

  it('is refused when it holds a table of values only that organization has', () => {
    const table = 'Jobs: NJ-1001 by NT-301, NJ-1002 by NT-302, NJ-1003 by NT-303.';
    expect(orgFactsProblem(write(table), texts)).toContain("only north's files have");
  });

  it('passes a procedure, and a value or two of one organization in an example', () => {
    expect(
      orgFactsProblem(write('Read data/jobs.csv and data/policy.md first.'), texts),
    ).toBeNull();
    expect(orgFactsProblem(write('For example, NJ-1001 took 90 minutes.'), texts)).toBeNull();
    expect(orgFactsProblem(write('NJ-1001 NJ-1002 NJ-1003 NT-301'), texts.slice(0, 1))).toBeNull();
  });
});
