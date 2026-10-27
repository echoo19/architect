import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, packagedExecutable, type LaunchedApp } from './app';

/*
 * What only a packaged build has: the app inside its archive, the tool sandbox beside the archive
 * in a real folder, and the sample job in the resources. Every other spec runs the same way
 * against either build, so this one also shows that a run of them was against the packaged one.
 */

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
  ]) {
    expect(existsSync(file), `${file} exists`).toBe(true);
  }
});
