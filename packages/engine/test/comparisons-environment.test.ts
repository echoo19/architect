import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { realEnvironment } from '../src/comparisons';

/** The pinned training recipe, which the environment's training wiring reads. */
const TRAINER_DIR = join(import.meta.dirname, '..', '..', '..', 'trainer');

let dir: string | undefined;

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("the comparisons runner's real environment", () => {
  it("starts its tools' sandbox from the entry it is given, as a built app's experiments need", async () => {
    dir = await mkdtemp(join(tmpdir(), 'architect-environment-'));
    // A built app has no sandbox beside its bundled engine, only the entry it passes in.
    const entry = join(dir, 'no-sandbox-here.mjs');
    const { env, close } = realEnvironment({
      dataDir: join(dir, 'data'),
      appDataDir: dir,
      trainerDir: TRAINER_DIR,
      meter: false,
      parallel: 1,
      commit: null,
      log: () => undefined,
      sandboxEntryPath: entry,
    });
    const sandbox = await env.deps.runtime.createSandbox();
    try {
      // The given entry isn't there, so loading a tool reaches it and fails to start it.
      await expect(
        env.deps.runtime.toolLoadProblem(sandbox, {
          name: 'probe',
          description: 'Returns one.',
          parameters: { type: 'object', properties: {} },
          code: 'function run() { return 1; }',
        }),
      ).rejects.toThrow('The sandbox process could not start');
    } finally {
      await sandbox.dispose();
      await close();
    }
  });
});
