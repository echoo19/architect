import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Task } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEngineHost } from '../src/host/engine-host';
import { createEngineDeps } from '../src/host/wiring';
import { DataPaths } from '../src/loop/paths';
import { Vault } from '../src/vault/vault';
import { deferred } from './fakes/clock';
import { defaultJob, defaultTasks, writeJobFolder } from './fakes/job';
import { shopData } from './support/drafting-data';
import { draft, draftingWorld, TEACHER, type DraftingWorld } from './support/drafting-world';

/*
 * A job is made all at once or not at all: its folder, its tasks, its sealed final test and its
 * place in the library. When a step fails nothing of the job is left, and when the app closes in
 * the middle the next start takes back what was left (decision 058).
 */

const data = shopData('finalize', 400, 150);
let world: DraftingWorld;

beforeEach(() => {
  world = draftingWorld();
  world.mentor.script = () => draft();
});

afterEach(() => {
  vi.restoreAllMocks();
  world.cleanup();
});

function attachShop(): string[] {
  return [
    world.attach('customers.csv', data.customersCsv),
    world.attach('orders.csv', data.ordersCsv),
    world.attach('policy.md', '# Shop policy\n\nReturns are accepted for 30 days.\n'),
  ];
}

const task: Task = {
  id: 't-1',
  type: 'lookup',
  family: 'f-1',
  prompt: 'What is the email of customer C-1?',
  expected: { kind: 'answer', value: 'a@example.com', compare: { mode: 'exact' } },
};

/** What a job that was being made when the app closed leaves: a folder, its mark, a sealed test. */
function leaveHalfMade(world: DraftingWorld, id: string, marked = true): void {
  mkdirSync(join(world.paths.dataDir(id)), { recursive: true });
  writeFileSync(world.paths.jobFile(id), '{}');
  if (marked) writeFileSync(world.paths.finalizingMark(id), '');
  world.vault.seal(id, [task], [], []);
}

describe('a job whose making failed', () => {
  it('leaves no folder and no sealed test, and can be made again under the same id', async () => {
    vi.spyOn(world.store.jobs, 'insert').mockImplementationOnce(() => {
      throw new Error('The database could not save the job.');
    });
    await expect(world.drafting.start('A desk', attachShop(), TEACHER)).rejects.toThrow(
      'The database could not save the job.',
    );
    expect(existsSync(world.paths.jobDir('shop-desk'))).toBe(false);
    expect(world.vault.isSealed('shop-desk')).toBe(false);
    expect(world.store.jobs.list()).toEqual([]);
    expect(world.jobs.summaries()).toEqual([]);

    // Before, the sealed test of the first try stayed, and the second took another id.
    const again = await world.drafting.start('A desk', attachShop(), TEACHER);
    expect(again.draft?.id).toBe('shop-desk');
    expect(world.vault.isSealed('shop-desk')).toBe(true);
    expect(existsSync(world.paths.finalizingMark('shop-desk'))).toBe(false);
    expect(world.jobs.summaries()).toMatchObject([{ id: 'shop-desk' }]);
  });

  it('is taken back when the final test could not be sealed, the data files too', async () => {
    const seal = vi.spyOn(world.deps.vault, 'seal').mockImplementationOnce(() => {
      throw new Error('The vault is full.');
    });
    await expect(world.drafting.start('A desk', attachShop(), TEACHER)).rejects.toThrow(
      'The vault is full.',
    );
    expect(seal).toHaveBeenCalledTimes(1);
    expect(existsSync(world.paths.jobDir('shop-desk'))).toBe(false);
    expect(world.vault.isSealed('shop-desk')).toBe(false);
  });
});

describe('an id that already has a folder', () => {
  /** What a person may keep in the jobs folder: their own file, with no job and no seal behind it. */
  function strayFolder(id: string): string {
    const folder = world.paths.jobDir(id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'notes.txt'), 'my own notes');
    return folder;
  }

  /** A job file whose data file is missing, so that importing it fails after its folder is made. */
  async function brokenImport(id: string): Promise<string> {
    const source = join(world.root, 'source');
    const file = await writeJobFolder(source, defaultJob({ id }), defaultTasks());
    rmSync(join(source, 'data', 'policy.md'));
    return file;
  }

  it('is never made under, so an import that fails leaves the folder and its files as they were', async () => {
    const folder = strayFolder('orders');
    await expect(world.jobs.importFile(await brokenImport('orders'))).rejects.toThrow(
      'The data file "policy.md" is missing',
    );
    expect(readFileSync(join(folder, 'notes.txt'), 'utf8')).toBe('my own notes');
    // The import was made under another id, and that one is taken back whole.
    expect(readdirSync(world.paths.jobs)).toEqual(['orders']);
    expect(world.store.jobs.list()).toEqual([]);
    expect(world.vault.isSealed('orders')).toBe(false);
  });

  it('gets a job of the same id another id, and leaves the folder alone when the job is made', async () => {
    const folder = strayFolder('orders');
    const source = join(world.root, 'source');
    const file = await writeJobFolder(source, defaultJob({ id: 'orders' }), defaultTasks());
    const job = await world.jobs.importFile(file);
    expect(job.id).not.toBe('orders');
    expect(world.store.jobs.list().map((record) => record.id)).toEqual([job.id]);
    expect(world.vault.isSealed(job.id)).toBe(true);
    expect(readdirSync(folder)).toEqual(['notes.txt']);
  });

  it('keeps a folder of a drafted job whose id is the same, when the database fails the job', async () => {
    const folder = strayFolder('shop-desk');
    vi.spyOn(world.store.jobs, 'insert').mockImplementationOnce(() => {
      throw new Error('The database could not save the job.');
    });
    await expect(world.drafting.start('A desk', attachShop(), TEACHER)).rejects.toThrow(
      'The database could not save the job.',
    );
    expect(readFileSync(join(folder, 'notes.txt'), 'utf8')).toBe('my own notes');
    expect(readdirSync(world.paths.jobs)).toEqual(['shop-desk']);
    expect(world.vault.isSealed('shop-desk')).toBe(false);
  });

  it('is refused, and the folder left as it is, when one appears after the id was chosen', async () => {
    // Another job of the same id began between choosing the id and making the folder: the split
    // that comes just before the folder is made is where it shows up.
    const rival = world.paths.jobDir('busy');
    const split = world.deps.runtime.splitTasks.bind(world.deps.runtime);
    vi.spyOn(world.deps.runtime, 'splitTasks').mockImplementationOnce((tasks, config) => {
      mkdirSync(rival, { recursive: true });
      writeFileSync(join(rival, 'notes.txt'), 'made in between');
      return split(tasks, config);
    });
    const made = world.jobs.create({
      job: defaultJob({ id: 'busy' }),
      files: [
        { name: 'jobs.csv', content: new TextEncoder().encode('id,tech\nJ-1,T-1\n') },
        { name: 'policy.md', content: new TextEncoder().encode('# Policy\n') },
      ],
      tasks: defaultTasks(),
      drafting: {
        format: 1,
        source: 'generated',
        createdAt: '2026-10-29T09:00:00.000Z',
        seed: 7,
        teacher: { label: 'Scripted', model: 'scripted' },
        cost: { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 },
        types: [],
        unresolved: [],
        notes: [],
      },
    });
    await expect(made).rejects.toThrow('There is already a folder for a job called "busy"');
    expect(readFileSync(join(rival, 'notes.txt'), 'utf8')).toBe('made in between');
    expect(readdirSync(rival)).toEqual(['notes.txt']);
    expect(world.vault.isSealed('busy')).toBe(false);
    expect(world.store.jobs.list()).toEqual([]);
  });
});

describe('a job that was being made when the app closed', () => {
  it('is taken back with its sealed test, and its id is free again', async () => {
    leaveHalfMade(world, 'half-made');
    expect(world.vault.isSealed('half-made')).toBe(true);
    const taken = await world.jobs.recoverInterrupted();
    expect(taken).toEqual(['half-made']);
    expect(existsSync(world.paths.jobDir('half-made'))).toBe(false);
    expect(world.vault.isSealed('half-made')).toBe(false);
  });

  it('is left alone when it reached the library, and only its mark is cleared', async () => {
    const turn = await world.drafting.start('A desk', attachShop(), TEACHER);
    const id = turn.draft?.id ?? '';
    writeFileSync(world.paths.finalizingMark(id), '');
    expect(await world.jobs.recoverInterrupted()).toEqual([]);
    expect(existsSync(world.paths.finalizingMark(id))).toBe(false);
    expect(world.vault.isSealed(id)).toBe(true);
    expect(world.jobs.summaries()).toMatchObject([{ id }]);
  });

  it('is told from a folder nobody marked, which is not touched', async () => {
    leaveHalfMade(world, 'someone-elses', false);
    expect(await world.jobs.recoverInterrupted()).toEqual([]);
    expect(existsSync(world.paths.jobDir('someone-elses'))).toBe(true);
    expect(world.vault.isSealed('someone-elses')).toBe(true);
  });

  it('is told from a job being made at that moment, which is not touched', async () => {
    const reached = deferred<void>();
    const go = deferred<void>();
    const seal = world.deps.vault.seal.bind(world.deps.vault);
    vi.spyOn(world.deps.vault, 'seal').mockImplementation(async (...args) => {
      reached.resolve();
      await go.promise;
      await seal(...args);
    });
    const making = world.drafting.start('A desk', attachShop(), TEACHER);
    await reached.promise;
    expect(existsSync(world.paths.finalizingMark('shop-desk'))).toBe(true);
    expect(await world.jobs.recoverInterrupted()).toEqual([]);
    expect(existsSync(world.paths.jobDir('shop-desk'))).toBe(true);
    go.resolve();
    const turn = await making;
    expect(turn.draft?.id).toBe('shop-desk');
    expect(world.vault.isSealed('shop-desk')).toBe(true);
  });

  it('is reported, not hidden, when it cannot be cleared, and tried again next time', async () => {
    leaveHalfMade(world, 'stuck');
    vi.spyOn(world.deps.vault, 'discard').mockImplementationOnce(() => {
      throw new Error('The vault is locked.');
    });
    const errors: unknown[] = [];
    expect(await world.jobs.recoverInterrupted((error) => errors.push(error))).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toContain('The job "stuck" was left half made');
    expect(existsSync(world.paths.finalizingMark('stuck'))).toBe(true);
    expect(await world.jobs.recoverInterrupted()).toEqual(['stuck']);
  });
});

describe('the engine at its start', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'architect-finalize-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('takes back a job the last run of the app left half made', async () => {
    const dataDir = join(root, 'data');
    const left = new DataPaths(dataDir);
    mkdirSync(left.dataDir('half-made'), { recursive: true });
    writeFileSync(left.jobFile('half-made'), '{}');
    writeFileSync(left.finalizingMark('half-made'), '');
    new Vault(dataDir).seal('half-made', [task], [], []);

    const deps = createEngineDeps({ dataDir, getSecret: async () => undefined });
    const host = await createEngineHost({ dataDir, deps });
    try {
      expect(await host.api.jobs.list()).toEqual([]);
      expect(existsSync(left.jobDir('half-made'))).toBe(false);
      expect(new Vault(dataDir).isSealed('half-made')).toBe(false);
    } finally {
      await host.close();
    }
  });
});
