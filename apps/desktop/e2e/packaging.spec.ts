import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchApp, packagedExecutable, type LaunchedApp } from './app';

/*
 * What only a packaged build has: the app inside its archive, the tool sandbox beside the archive
 * in a real folder, and the sample job and the ready-made agent in the resources. Every other spec
 * runs the same way against either build, so this one also shows that a run of them was against
 * the packaged one.
 */

/** The ready-made agent's package where the repository keeps it, once the owner has added it. */
const SAMPLE_AGENT_PACKAGE = fileURLToPath(
  new URL('../../../examples/gear-returns/graduate/returns-desk.architect.zip', import.meta.url),
);

test.skip(!packagedExecutable(), 'Run `pnpm package`, then `pnpm e2e:packaged`.');

let launched: LaunchedApp;

test.beforeAll(async () => {
  launched = await launchApp();
});

test.afterAll(async () => {
  await launched?.close();
});

test('runs from its archive, with the sandbox and the sample job beside it', async () => {
  const where = await launched.app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resources: process.resourcesPath,
  }));
  expect(where.packaged).toBe(true);
  expect(where.appPath).toBe(join(where.resources, 'app.asar'));

  const sandbox = join(where.resources, 'app.asar.unpacked', 'out', 'sandbox');
  for (const file of [
    join(sandbox, 'child.mjs'),
    join(sandbox, 'emscripten-module.wasm'),
    join(where.resources, 'sample-job', 'job.json'),
    // Academy desk's job comes with all four academies, the one it is never taught on included.
    join(where.resources, 'academy-job', 'tasks.jsonl'),
    join(where.resources, 'academy-job', 'orgs', 'juniper', 'data', 'policy.md'),
    // The Assay desk's job comes with all four labs, the one it never sees included.
    join(where.resources, 'assay-job', 'tasks.jsonl'),
    join(where.resources, 'assay-job', 'orgs', 'corvid-hill', 'data', 'orbit_export.csv'),
    // The data the ready-made agent works on always comes along.
    join(where.resources, 'sample-agent', 'data', 'orders.csv'),
  ]) {
    expect(existsSync(file), `${file} exists`).toBe(true);
  }
  // Its package comes when the repository has it; electron-builder only warns about one that
  // isn't there, and the app then doesn't offer the agent.
  expect(existsSync(join(where.resources, 'sample-agent', 'returns-desk.architect.zip'))).toBe(
    existsSync(SAMPLE_AGENT_PACKAGE),
  );
});
