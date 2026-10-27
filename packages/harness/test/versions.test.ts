import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyEdits,
  blankHarness,
  hashHarness,
  HarnessValidationError,
  HarnessVersions,
} from '../src';
import { cleanTempDirsAfterEach, sampleHarness, tempDir } from './fixtures';

cleanTempDirsAfterEach();

async function newVersions(): Promise<{ versions: HarnessVersions; dir: string }> {
  const dir = join(await tempDir(), 'harness');
  return { versions: new HarnessVersions(dir), dir };
}

describe('HarnessVersions', () => {
  it('starts empty', async () => {
    const { versions } = await newVersions();
    expect(await versions.list()).toEqual([]);
    expect(await versions.latest()).toBeUndefined();
  });

  it('numbers versions from 1 in folders named v0001, v0002', async () => {
    const { versions, dir } = await newVersions();
    const first = await versions.save(blankHarness('Desk', 'About the desk.'));
    const second = await versions.save(
      applyEdits(first, [{ op: 'write', path: 'system.md', content: 'Second\n' }]),
      first.meta.version,
    );
    expect(first.meta).toEqual({
      format: 1,
      name: 'Desk',
      version: 1,
      hash: hashHarness(first),
    });
    expect(second.meta).toMatchObject({ version: 2, parent: 1, hash: hashHarness(second) });
    expect((await readdir(dir)).sort()).toEqual(['v0001', 'v0002']);
    expect(await readFile(join(dir, 'v0002', 'harness.yaml'), 'utf8')).toBe(
      `format: 1\nname: Desk\nversion: 2\nparent: 1\nhash: ${second.meta.hash}\n`,
    );
  });

  it('overwrites the version, parent and hash of the harness it is given', async () => {
    const { versions } = await newVersions();
    const saved = await versions.save(sampleHarness());
    expect(saved.meta).toMatchObject({ version: 1, hash: sampleHarness().meta.hash });
    expect(saved.meta.parent).toBeUndefined();
    expect('parent' in saved.meta).toBe(false);
    const again = await versions.save(saved, 1);
    expect(again.meta).toMatchObject({ version: 2, parent: 1 });
  });

  it('loads what was saved, list and latest included', async () => {
    const { versions } = await newVersions();
    const first = await versions.save(sampleHarness());
    const second = await versions.save(
      applyEdits(first, [{ op: 'write', path: 'system.md', content: 'Second\n' }]),
      1,
    );
    expect(await versions.load(1)).toEqual(first);
    expect(await versions.load(2)).toEqual(second);
    expect(await versions.latest()).toEqual(second);
    expect((await versions.list()).map((meta) => [meta.version, meta.parent])).toEqual([
      [1, undefined],
      [2, 1],
    ]);
  });

  it('never rewrites a saved version', async () => {
    const { versions, dir } = await newVersions();
    const first = await versions.save(sampleHarness());
    const before = await readFile(join(dir, 'v0001', 'system.md'), 'utf8');
    await versions.save(
      applyEdits(first, [{ op: 'write', path: 'system.md', content: 'Different\n' }]),
      1,
    );
    expect(await readFile(join(dir, 'v0001', 'system.md'), 'utf8')).toBe(before);
    expect((await versions.load(1)).system).toBe(first.system);
  });

  it('continues from the highest number, even when a folder in between is gone', async () => {
    const { versions, dir } = await newVersions();
    for (const text of ['A.', 'B.', 'C.']) await versions.save(blankHarness('Desk', text));
    await rm(join(dir, 'v0002'), { recursive: true });
    expect((await versions.save(blankHarness('Desk', 'D.'))).meta.version).toBe(4);
    expect((await versions.list()).map((meta) => meta.version)).toEqual([1, 3, 4]);
  });

  it('refuses a parent that does not exist', async () => {
    const { versions } = await newVersions();
    await versions.save(blankHarness('Desk', 'A.'));
    await expect(versions.save(blankHarness('Desk', 'B.'), 7)).rejects.toThrow(
      'Version 7 does not exist, so it cannot be a parent.',
    );
    expect((await versions.list()).map((meta) => meta.version)).toEqual([1]);
  });

  it('refuses an invalid harness and leaves no folder behind', async () => {
    const { versions, dir } = await newVersions();
    const harness = sampleHarness();
    const tool = harness.tools[0];
    if (!tool) throw new Error('fixture has a tool');
    const bad = { ...harness, tools: [{ ...tool, name: 'calculate' }] };
    await expect(versions.save(bad)).rejects.toBeInstanceOf(HarnessValidationError);
    expect(await readdir(dir)).toEqual([]);
    expect((await versions.save(harness)).meta.version).toBe(1);
  });

  it('reports a version that does not exist', async () => {
    const { versions } = await newVersions();
    await expect(versions.load(3)).rejects.toThrow('Harness version 3 does not exist');
  });

  it('ignores a folder that was never finished and does not reuse its number', async () => {
    const { versions, dir } = await newVersions();
    await versions.save(blankHarness('Desk', 'A.'));
    await mkdir(join(dir, 'v0002'));
    await writeFile(join(dir, 'v0002', 'system.md'), 'half written\n');
    await mkdir(join(dir, 'notes'));
    expect((await versions.list()).map((meta) => meta.version)).toEqual([1]);
    expect((await versions.latest())?.meta.version).toBe(1);
    await expect(versions.load(2)).rejects.toThrow('does not exist');
    expect((await versions.save(blankHarness('Desk', 'B.'))).meta.version).toBe(3);
  });

  it('notices when a saved version was edited by hand', async () => {
    const { versions, dir } = await newVersions();
    await versions.save(sampleHarness());
    await writeFile(join(dir, 'v0001', 'system.md'), 'Quietly changed\n');
    await expect(versions.load(1)).rejects.toThrow(
      'v0001: files changed after the version was saved. Saved versions are never edited.',
    );
  });

  it('returns the harness as stored, with skills in slug order', async () => {
    const { versions } = await newVersions();
    const harness = sampleHarness();
    const saved = await versions.save({ ...harness, skills: [...harness.skills].reverse() });
    expect(saved.skills.map((skill) => skill.slug)).toEqual(['overdue-balances', 'price-a-job']);
    expect(saved).toEqual(await versions.load(1));
  });

  it('gives the folder of a version', async () => {
    const { versions, dir } = await newVersions();
    expect(versions.pathOf(12)).toBe(join(dir, 'v0012'));
  });
});
