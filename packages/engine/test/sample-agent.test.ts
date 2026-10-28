import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractTerms, JobContractSchema, JobSchema } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { tableColumns } from '../src/graduates/build';
import { exportPackage } from '../src/graduates/exporter';
import { importPackage, previewImport } from '../src/graduates/importer';
import { prepareSampleAgent, sampleAgentAvailable } from '../src/graduates/sample';
import type { SampleAgentFiles } from '../src/loop/deps';
import { DataPaths } from '../src/loop/paths';
import { addVersion, newComputer, type Computer } from './support/computer';

/** The returns desk as it ships: the job file, and the data its agent works on. */
const RETURNS_DESK = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'examples',
  'gear-returns',
  'job',
);

const TABLES: Record<string, string> = {
  'orders.csv': 'order_id,customer_id\nO-1,C-1\nO-2,C-2\n',
  'returns.csv': 'return_id,order_id\nR-1,O-1\n',
  'policy.md': '# Desk rules\n',
};

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A folder of a test's own, removed after it. */
async function scratch(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'architect-sample-'));
  cleanups.push(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

/** What an app build ships: a package and, beside it, the folder of data its agent works on. */
async function shipped(
  root: string,
  files: Record<string, string> = TABLES,
): Promise<SampleAgentFiles> {
  const dataDir = join(root, 'sample-agent', 'data');
  await mkdir(dataDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dataDir, name), content, 'utf8');
  }
  const packageFile = join(root, 'sample-agent', 'returns-desk.architect.zip');
  await writeFile(packageFile, 'the import reads this, not these tests', 'utf8');
  return { packageFile, dataDir };
}

/** Every file in a folder with its text, by name. */
async function textsIn(folder: string): Promise<Record<string, string>> {
  const names = (await readdir(folder)).sort();
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, await readFile(join(folder, name), 'utf8')] as const),
    ),
  );
}

describe('whether this build has a ready-made agent', () => {
  it('has one when its package and its data are both there', async () => {
    const root = await scratch();
    expect(await sampleAgentAvailable(await shipped(root))).toBe(true);
  });

  it('has none when the build names nothing', async () => {
    expect(await sampleAgentAvailable(undefined)).toBe(false);
  });

  it('has none without its package', async () => {
    const root = await scratch();
    const files = await shipped(root);
    await rm(files.packageFile);
    expect(await sampleAgentAvailable(files)).toBe(false);
  });

  it('has none when the package is a folder, not a file', async () => {
    const root = await scratch();
    const files = await shipped(root);
    await rm(files.packageFile);
    await mkdir(files.packageFile);
    expect(await sampleAgentAvailable(files)).toBe(false);
  });

  it('has none without its data, or with a data folder that holds no file', async () => {
    const root = await scratch();
    const files = await shipped(root);
    await rm(files.dataDir, { recursive: true });
    expect(await sampleAgentAvailable(files)).toBe(false);
    await mkdir(join(files.dataDir, 'tables'), { recursive: true });
    expect(await sampleAgentAvailable(files)).toBe(false);
  });
});

describe("making the ready-made agent's data this computer's own", () => {
  it("copies its data into samples/returns-desk/data of the app's data folder the first time", async () => {
    const root = await scratch();
    const files = await shipped(root);
    const app = join(root, 'app-data');

    const sample = await prepareSampleAgent(new DataPaths(app), files);

    expect(sample).toEqual({
      package: files.packageFile,
      data: join(app, 'samples', 'returns-desk', 'data'),
    });
    expect(await textsIn(sample.data)).toEqual(TABLES);
    // The package is read where it is, the shipped data stays as shipped, and nothing half made
    // is left beside the copy.
    expect(await readdir(join(app, 'samples', 'returns-desk'))).toEqual(['data']);
    expect(await textsIn(files.dataDir)).toEqual(TABLES);
  });

  it('keeps a copy that is already there, whatever the agent changed in it', async () => {
    const root = await scratch();
    const files = await shipped(root);
    const paths = new DataPaths(join(root, 'app-data'));
    const first = await prepareSampleAgent(paths, files);

    // As the agent and its person would leave it: a row added, a file gone, a file of their own.
    const returns = join(first.data, 'returns.csv');
    await writeFile(returns, `${TABLES['returns.csv']}R-2,O-2\n`, 'utf8');
    await rm(join(first.data, 'orders.csv'));
    await writeFile(join(first.data, 'notes.txt'), 'mine\n', 'utf8');
    const before = await textsIn(first.data);

    const again = await prepareSampleAgent(paths, files);

    expect(again).toEqual(first);
    expect(await textsIn(again.data)).toEqual(before);
    expect(await readFile(returns, 'utf8')).toBe(`${TABLES['returns.csv']}R-2,O-2\n`);
    // Even new data in a newer build doesn't reach a copy that is there.
    await writeFile(join(files.dataDir, 'returns.csv'), 'return_id\nR-9\n', 'utf8');
    await prepareSampleAgent(paths, files);
    expect(await readFile(returns, 'utf8')).toBe(`${TABLES['returns.csv']}R-2,O-2\n`);
    expect(await readdir(join(root, 'app-data', 'samples', 'returns-desk'))).toEqual(['data']);
  });

  it("says where the copy couldn't be made, and makes it once the way is clear", async () => {
    const root = await scratch();
    const files = await shipped(root);
    const app = join(root, 'app-data');
    const paths = new DataPaths(app);
    // Something that isn't a folder stands where the samples folder goes.
    await mkdir(app, { recursive: true });
    await writeFile(join(app, 'samples'), 'in the way', 'utf8');

    const failure = await prepareSampleAgent(paths, files).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(
      `The ready-made agent's data couldn't be copied to ${join(app, 'samples', 'returns-desk', 'data')}.`,
    );
    expect((failure as Error).cause).toBeInstanceOf(Error);

    await rm(join(app, 'samples'));
    expect(await prepareSampleAgent(paths, files)).toMatchObject({
      data: join(app, 'samples', 'returns-desk', 'data'),
    });
  });

  it("refuses in a build that doesn't ship it, and makes nothing", async () => {
    const root = await scratch();
    const files = await shipped(root);
    const app = join(root, 'app-data');
    await rm(files.packageFile);

    await expect(prepareSampleAgent(new DataPaths(app), files)).rejects.toThrow(
      "The ready-made agent isn't available in this build.",
    );
    await expect(prepareSampleAgent(new DataPaths(app), undefined)).rejects.toThrow(
      "The ready-made agent isn't available in this build.",
    );
    await expect(readdir(join(app, 'samples'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('importing the ready-made agent with its data chosen', () => {
  /** An agent made from the returns desk job, exported as the package a build would ship. */
  async function authoredPackage(author: Computer): Promise<string> {
    const job = JobSchema.parse(JSON.parse(await readFile(join(RETURNS_DESK, 'job.json'), 'utf8')));
    const contract = JobContractSchema.parse({ ...contractTerms(job), version: 1 });
    await addVersion(author, {
      graduateId: 'grd_returns',
      job,
      columns: await tableColumns(join(RETURNS_DESK, 'data'), contract),
      unevaluated: true,
    });
    const { archive } = await exportPackage(
      { library: author.library, secrets: { get: async () => undefined } },
      'grd_returns',
      { directory: join(author.dataDir, 'exports') },
    );
    return archive;
  }

  async function computer(): Promise<Computer> {
    const made = await newComputer();
    cleanups.push(() => made.remove());
    return made;
  }

  it("installs ready from the package and the returns desk's own data, once it is allowed to open it", async () => {
    const author = await computer();
    const archive = await authoredPackage(author);
    const recipient = await computer();
    const sample = await prepareSampleAgent(recipient.paths, {
      packageFile: archive,
      dataDir: join(RETURNS_DESK, 'data'),
    });
    const library = { library: recipient.library };

    const preview = await previewImport(library, sample.package);
    expect(preview).toMatchObject({ ok: true, place: { kind: 'new' }, status: 'ready' });

    // Nothing is granted until it is chosen: the folder is there, and the agent can't open it yet.
    const closed = await importPackage(library, sample.package, {
      bindings: { data: sample.data },
    });
    expect(closed.installation.grants.resources['data']).toBe('none');
    expect(closed.installation.status).toBe('needs_attention');
    expect(closed.installation.reasons).toEqual([
      "data/ has a folder, but the agent isn't allowed to open it.",
    ]);
    await recipient.library.remove(closed.graduate.id);

    const result = await importPackage(library, sample.package, {
      bindings: { data: sample.data },
      grants: { writes: 'ask', resources: { data: 'read_write' } },
    });
    expect(result.installation.status).toBe('ready');
    expect(result.installation.checks.find((check) => check.kind === 'resources_bound')).toEqual(
      expect.objectContaining({ status: 'passed' }),
    );
    expect(result.installation.bindings['data']).toBe(sample.data);
    // Inside the app's data folder, so it is stored relative to it and moves with it.
    expect(recipient.store.installations.get(result.graduate.id)?.bindings['data']).toBe(
      'samples/returns-desk/data',
    );
    // Removing the agent leaves the copy, which is not part of the agent's own folders.
    await recipient.library.remove(result.graduate.id);
    expect(await readdir(sample.data)).toContain('returns.csv');
  });
});
