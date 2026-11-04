import { readFile } from 'node:fs/promises';
import type * as fsPromises from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { exportPackage } from '../src/graduates/exporter';
import { importPackage } from '../src/graduates/importer';
import { addVersion, newComputer, type Computer } from './support/computer';
import { SAMPLE_CONTENT } from './support/fixtures';

const disk = vi.hoisted(() => ({ failingFolder: '' }));

// Only the bundled resource's destination runs out of space. Staging, hashing and the database
// remain real; both copying primitives obey the same disk failure.
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof fsPromises>();
  const check = (target: unknown) => {
    if (
      disk.failingFolder !== '' &&
      String(target).startsWith(disk.failingFolder) &&
      String(target).endsWith('invoices.csv')
    ) {
      throw Object.assign(new Error('No space left on device.'), { code: 'ENOSPC' });
    }
  };
  return {
    ...fs,
    copyFile: async (...args: Parameters<typeof fs.copyFile>) => {
      check(args[1]);
      return fs.copyFile(...args);
    },
    cp: async (...args: Parameters<typeof fs.cp>) => {
      check(args[1]);
      return fs.cp(...args);
    },
  };
});

const computers: Computer[] = [];
afterEach(async () => {
  disk.failingFolder = '';
  for (const computer of computers.splice(0).reverse()) await computer.remove();
});

it('retries a failed bundled-data import without retaining a partial resource folder', async () => {
  const author = await newComputer();
  const recipient = await newComputer();
  computers.push(author, recipient);
  await addVersion(author, { graduateId: 'grd_desk' });
  const exported = await exportPackage(
    { library: author.library, secrets: { get: async () => undefined } },
    'grd_desk',
    { directory: join(author.dataDir, 'exports'), include: ['resource:data'] },
  );
  disk.failingFolder = recipient.paths.workspaceDir('grd_desk');
  await expect(
    importPackage({ library: recipient.library }, exported.folder, { loadModel: false }),
  ).rejects.toMatchObject({ code: 'disk_full' });
  expect(recipient.library.list()).toEqual([]);

  disk.failingFolder = '';
  const installed = await importPackage({ library: recipient.library }, exported.folder, {
    loadModel: false,
  });
  expect(installed).toMatchObject({ version: 1, alreadyInstalled: false });
  for (const [name, text] of Object.entries(SAMPLE_CONTENT)) {
    expect(await readFile(join(installed.installation.bindings['data'] ?? '', name), 'utf8')).toBe(
      text,
    );
  }
});
