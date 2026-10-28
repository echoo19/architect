import { join } from 'node:path';
import { GuardError } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BudgetGuard } from '../src/loop/budget';
import { SessionResources } from '../src/loop/resources';
import { FileVersions } from './fakes/harness';
import { defaultJob } from './fakes/job';
import { createWorld, type World } from './fakes/world';

let world: World;

beforeEach(async () => {
  world = await createWorld();
});

afterEach(() => world.cleanup());

function session(): SessionResources {
  const job = defaultJob();
  return new SessionResources({
    deps: world.deps,
    job,
    jobDir: join(world.root, 'job'),
    dataDir: join(world.root, 'job', 'data'),
    runId: 'run_1',
    versions: new FileVersions(join(world.root, 'harness')),
    budget: new BudgetGuard(job.budget, { rounds: 0, usd: 0, wallMs: 0 }, world.clock),
    fromStored: (path) => join(world.dataDir, path),
    log: () => undefined,
  });
}

describe('a session’s mentor', () => {
  it('is released with no adapter when the session never made one, and never made after', async () => {
    const resources = session();
    await resources.releaseMentor();
    expect(world.runtime.releases).toEqual([
      { jobId: 'service-desk', runId: 'run_1', mentor: null },
    ]);

    await expect(resources.mentor()).rejects.toThrow(GuardError);
    await expect(resources.gate()).rejects.toMatchObject({
      guard: 'split',
      message: expect.stringContaining('released for the locked test'),
    });
    expect(world.mentorsCreated).toBe(0);
  });

  it('is dropped at the release when the session made one, and not made again', async () => {
    const resources = session();
    const gate = await resources.gate();
    expect(await resources.mentor()).toBe(world.mentor);
    await resources.releaseMentor();
    expect(world.runtime.releases[0]?.mentor).toBe(world.mentor);

    await expect(resources.mentor()).rejects.toThrow(GuardError);
    await expect(
      gate.complete(world.mentor, { system: '', messages: [], maxOutputTokens: 64 }),
    ).rejects.toMatchObject({ guard: 'split' });
    expect(world.mentorsCreated).toBe(1);
    expect(world.mentor.requests).toEqual([]);
  });
});
