import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AdapterError,
  InstallCheckSchema,
  type InstallCheck,
  type ResourceFile,
  type Installation,
  type StudentEndpoint,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { folderShortfalls } from '../src/graduates/checks';
import { FakeStudent } from './fakes/adapters';
import { fakeLlamaCommand, standInAdapter, storeBase } from './support/adapter-runtime';
import {
  addVersion,
  harnessWith,
  newComputer,
  PRICE_TOOL,
  THIS_MACHINE,
  type Computer,
  type ComputerOptions,
} from './support/computer';

/*
 * Install checks keep their sentences, which say what to do, and carry beside them what a screen
 * needs to word a check and offer its fix without reading those sentences: why a check wasn't
 * tried, llama.cpp's build, whether the base is the build that was tested, what stands in the way
 * of the base model, and which folders aren't ready.
 */

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function computer(options: ComputerOptions = {}): Promise<Computer> {
  const made = await newComputer(THIS_MACHINE, options);
  cleanups.push(() => made.remove());
  return made;
}

/** A computer with the stand-in llama-server, which never loads a model. */
async function withLlamaServer(): Promise<Computer> {
  const folder = await mkdtemp(join(tmpdir(), 'architect-check-fields-'));
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  return computer({ llamaServer: fakeLlamaCommand(join(folder, 'record.jsonl')) });
}

function checkOf(installation: Installation, kind: string): InstallCheck {
  const found = installation.checks.find((check) => check.kind === kind);
  if (!found) throw new Error(`No ${kind} check.`);
  // Every check is stored and read back through the shared schema.
  return InstallCheckSchema.parse(found);
}

/** Answers the model checks with a student whose `describe` does what `describe` says. */
function studentDescribing(made: Computer, describe: () => Promise<{ digest?: string }>): void {
  made.library.ctx.deps.adapters.createStudent = (endpoint: StudentEndpoint) => {
    const student = new FakeStudent(endpoint, () => 'ready');
    student.describe = async () => ({ model: endpoint.model, ...(await describe()) });
    return student;
  };
}

describe('install checks carry what the screens need beside their sentences', () => {
  it('says why a model check was not tried: not asked this time, or a check before it failed', async () => {
    const here = await computer();
    await addVersion(here, { graduateId: 'grd_desk' });
    const listed = await here.library.verify('grd_desk', { loadModel: false });
    expect(checkOf(listed, 'model_responds')).toMatchObject({
      status: 'skipped',
      skipped: 'not_asked',
    });

    const broken = await computer();
    await addVersion(broken, {
      graduateId: 'grd_desk',
      harness: harnessWith('Service desk', {
        tools: [{ ...PRICE_TOOL, code: 'function run(args, ctx) {\n  return syntax error;\n}\n' }],
      }),
    });
    const blocked = await broken.library.verify('grd_desk');
    expect(blocked.status).toBe('blocked');
    for (const kind of ['model_available', 'model_responds']) {
      expect(checkOf(blocked, kind)).toMatchObject({
        status: 'skipped',
        skipped: 'after_failure',
      });
    }
    // A passed check says nothing about skipping.
    expect(checkOf(blocked, 'harness_valid').skipped).toBeUndefined();
  });

  it('says when the base model is the build that was tested, and when it is another to choose', async () => {
    const here = await computer();
    await addVersion(here, { graduateId: 'grd_desk' });
    const same = await here.library.verify('grd_desk', { loadModel: false });
    const tested = checkOf(same, 'model_available');
    expect(tested).toMatchObject({ status: 'passed', sameBuild: true });
    expect(tested.modelProblem).toBeUndefined();

    studentDescribing(here, async () => ({ digest: 'sha256:another-build' }));
    const other = await here.library.verify('grd_desk', { loadModel: false });
    expect(other.status).toBe('needs_attention');
    expect(checkOf(other, 'model_available')).toMatchObject({
      status: 'failed',
      sameBuild: false,
      modelProblem: 'other_build',
    });

    // A runtime that names no build can't say whether it is the same one.
    studentDescribing(here, async () => ({}));
    const unknown = checkOf(
      await here.library.verify('grd_desk', { loadModel: false }),
      'model_available',
    );
    expect(unknown.status).toBe('passed');
    expect(unknown.sameBuild).toBeUndefined();
  });

  it('never calls a build the tested one when the final test ran on a hosted copy', async () => {
    const here = await computer();
    await addVersion(here, { graduateId: 'grd_desk', testedOn: 'hosted' });
    const listed = await here.library.verify('grd_desk', { loadModel: false });
    const check = checkOf(listed, 'model_available');
    expect(check.status).toBe('passed');
    expect(check.detail).toMatch(/, the same build it was made for\.$/);
    expect(check.sameBuild).toBeUndefined();

    studentDescribing(here, async () => ({ digest: 'sha256:another-build' }));
    const other = checkOf(
      await here.library.verify('grd_desk', { loadModel: false }),
      'model_available',
    );
    expect(other).toMatchObject({
      status: 'failed',
      sameBuild: false,
      modelProblem: 'other_build',
    });
    expect(other.detail).toMatch(/than the one it was made for \(/);
  });

  it("tells a model that isn't downloaded from a runtime that can't serve it", async () => {
    const here = await computer();
    await addVersion(here, { graduateId: 'grd_desk' });
    studentDescribing(here, () =>
      Promise.reject(new AdapterError('not_found', 'Ollama has no model muse-glimmer:30b.')),
    );
    const missing = await here.library.verify('grd_desk');
    expect(checkOf(missing, 'model_available')).toMatchObject({
      status: 'failed',
      modelProblem: 'not_downloaded',
    });
    expect(checkOf(missing, 'model_responds')).toMatchObject({ skipped: 'after_failure' });

    studentDescribing(here, () =>
      Promise.reject(new AdapterError('network', "Ollama isn't answering at 127.0.0.1:11434.")),
    );
    const down = await here.library.verify('grd_desk', { loadModel: false });
    expect(checkOf(down, 'model_available')).toMatchObject({
      status: 'failed',
      modelProblem: 'unavailable',
    });
  });

  it('names each folder that is not ready, and why', async () => {
    const here = await computer();
    await addVersion(here, { graduateId: 'grd_desk' });
    const ready = await here.library.verify('grd_desk', { loadModel: false });
    expect(checkOf(ready, 'resources_bound').folders).toBeUndefined();

    const refused = await here.library.bind('grd_desk', {
      grants: { resources: { data: 'none' } },
    });
    expect(checkOf(refused, 'resources_bound').folders).toEqual([
      { name: 'data', problem: 'not_allowed' },
    ]);

    await here.library.bind('grd_desk', { grants: { resources: { data: 'read_write' } } });
    await unlink(join(here.paths.workspaceDir('grd_desk'), 'customers.csv'));
    const short = await here.library.verify('grd_desk', { loadModel: false });
    expect(checkOf(short, 'resources_bound').folders).toEqual([{ name: 'data', problem: 'files' }]);

    await rm(here.paths.workspaceDir('grd_desk'), { recursive: true, force: true });
    const gone = await here.library.verify('grd_desk', { loadModel: false });
    expect(checkOf(gone, 'resources_bound').folders).toEqual([
      { name: 'data', problem: 'missing' },
    ]);

    const installation = here.store.installations.get('grd_desk');
    if (!installation) throw new Error('Not installed.');
    here.store.installations.put({ ...installation, bindings: {} });
    const unbound = await here.library.verify('grd_desk', { loadModel: false });
    expect(checkOf(unbound, 'resources_bound').folders).toEqual([
      { name: 'data', problem: 'not_chosen' },
    ]);
  });

  it('says in plain words what a folder lacks before it is chosen, and lets optional files be absent', async () => {
    const here = await computer();
    await addVersion(here, { graduateId: 'grd_desk' });
    const own = await mkdtemp(join(tmpdir(), 'architect-own-records-'));
    cleanups.push(() => rm(own, { recursive: true, force: true }));

    expect(await here.library.checkFolder('grd_desk', 'data', own)).toEqual({
      problems: [
        "customers.csv isn't in the folder.",
        "invoices.csv isn't in the folder.",
        "policy.md isn't in the folder.",
      ],
    });
    await writeFile(join(own, 'invoices.csv'), 'anything\n');
    await writeFile(join(own, 'policy.md'), 'Terms.\n');
    await writeFile(join(own, 'customers.csv'), 'customer_id,name\nC1,Ana\n');
    expect(await here.library.checkFolder('grd_desk', 'data', own)).toEqual({
      problems: ['customers.csv has no city, terms_days columns.'],
    });
    await writeFile(
      join(own, 'customers.csv'),
      'customer_id,name,city,terms_days\nC1,Ana,Reno,30\n',
    );
    expect(await here.library.checkFolder('grd_desk', 'data', own)).toEqual({ problems: [] });
    expect(
      (await here.library.checkFolder('grd_desk', 'data', join(own, 'customers.csv'))).problems,
    ).toHaveLength(1);
    await expect(here.library.checkFolder('grd_desk', 'notes', own)).rejects.toThrow(/no resource/);

    // Nothing was bound by looking.
    expect((await here.library.installation('grd_desk')).bindings['data']).not.toBe(own);

    const optional: ResourceFile[] = [
      { name: 'hints.csv', kind: 'table', access: 'read', optional: true, columns: ['hint_id'] },
      { name: 'rules.md', kind: 'text', access: 'read' },
    ];
    expect(await folderShortfalls(optional, own)).toEqual([{ file: 'rules.md', kind: 'absent' }]);
    await writeFile(join(own, 'hints.csv'), 'id\n1\n');
    expect(await folderShortfalls(optional, own)).toEqual([
      { file: 'hints.csv', kind: 'columns', columns: ['hint_id'] },
      { file: 'rules.md', kind: 'absent' },
    ]);
  });

  it("names llama.cpp's build, and a base of another build as the model to choose", async () => {
    const here = await withLlamaServer();
    const base = storeBase(here.modelsDir);
    await addVersion(here, {
      graduateId: 'grd_desk',
      adapter: standInAdapter(base.header),
      adapterIdentity: { baseDigest: base.digest },
    });
    const ready = await here.library.verify('grd_desk', { loadModel: false });
    expect(ready.status).toBe('ready');
    expect(checkOf(ready, 'adapter_runtime')).toMatchObject({ status: 'passed', build: 10472 });
    expect(checkOf(ready, 'model_available')).toMatchObject({ status: 'passed', sameBuild: true });

    // Another build of the base under the same name blocks it; the way out is another model.
    storeBase(here.modelsDir, 'muse-glimmer:30b', 3);
    const other = await here.library.verify('grd_desk', { loadModel: false });
    expect(other.status).toBe('blocked');
    expect(checkOf(other, 'model_available')).toMatchObject({
      status: 'failed',
      sameBuild: false,
      modelProblem: 'other_build',
    });
  });

  it('says a base missing from Ollama needs downloading, and llama.cpp missing has no build', async () => {
    const here = await computer();
    const base = storeBase(join(here.dataDir, 'another-computer'));
    await addVersion(here, {
      graduateId: 'grd_desk',
      adapter: standInAdapter(base.header),
      adapterIdentity: { baseDigest: base.digest },
    });
    const installation = await here.library.verify('grd_desk', { loadModel: false });
    const server = checkOf(installation, 'adapter_runtime');
    expect(server.status).toBe('failed');
    expect(server.build).toBeUndefined();
    expect(checkOf(installation, 'model_available')).toMatchObject({
      status: 'failed',
      modelProblem: 'not_downloaded',
    });
  });

  it('asks for a model on Ollama when a version with trained weights is set to another runtime', async () => {
    const here = await computer();
    const base = storeBase(here.modelsDir);
    await addVersion(here, {
      graduateId: 'grd_desk',
      adapter: standInAdapter(base.header),
      adapterIdentity: { baseDigest: base.digest },
    });
    const installation = await here.library.bind('grd_desk', {
      model: {
        runtime: 'openai_compatible',
        baseUrl: 'http://127.0.0.1:1234/v1',
        model: 'muse-glimmer',
      },
    });
    expect(checkOf(installation, 'compatibility')).toMatchObject({
      status: 'failed',
      modelProblem: 'wrong_runtime',
    });
  });
});
