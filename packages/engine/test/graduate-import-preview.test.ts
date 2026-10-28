import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { INSTALL_CHECKS_LABEL } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { exportPackage, type ExportContext } from '../src/graduates/exporter';
import { importPackage, previewImport } from '../src/graduates/importer';
import { addVersion, newComputer, THIS_MACHINE, type Computer } from './support/computer';

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function computer(machine = THIS_MACHINE): Promise<Computer> {
  const made = await newComputer(machine);
  cleanups.push(() => made.remove());
  return made;
}

function exporter(made: Computer): ExportContext {
  return { library: made.library, secrets: { get: async () => undefined } };
}

/** Version 1 of the author's agent, exported as a package. */
async function exported(author: Computer): Promise<{ archive: string; folder: string }> {
  if (!author.store.graduates.get('grd_desk')) {
    await addVersion(author, { graduateId: 'grd_desk' });
  }
  const directory = join(
    author.dataDir,
    `exports-${author.store.versions.list('grd_desk').length}`,
  );
  return exportPackage(exporter(author), 'grd_desk', { directory });
}

describe('previewing an import, before anything is installed', () => {
  it('says it would be a new agent, and that this computer can run it and has its model', async () => {
    const author = await computer();
    const { archive } = await exported(author);
    const recipient = await computer();

    const preview = await previewImport({ library: recipient.library }, archive);
    expect(preview).toMatchObject({
      ok: true,
      place: { kind: 'new' },
      machine: THIS_MACHINE,
      model: { runtime: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'muse-glimmer:30b' },
      status: 'ready',
      reasons: [],
    });
    if (!preview.ok) return;
    expect(preview.manifest.identity).toMatchObject({ agentId: 'grd_desk', version: 1 });
    expect(preview.checks.map(({ kind, status }) => [kind, status])).toEqual([
      ['compatibility', 'passed'],
      ['model_available', 'passed'],
    ]);
    // Nothing installed, nothing loaded, nothing left in staging.
    expect(recipient.store.graduates.list()).toEqual([]);
    expect(recipient.students.flatMap((student) => student.chats)).toEqual([]);
    expect(recipient.loaded.filter((entry) => entry.startsWith('tool:'))).toEqual([]);
    expect(await readdir(recipient.paths.stagingDir())).toEqual([]);
  });

  it('says it would be the next version of an agent this computer has, as a candidate', async () => {
    const author = await computer();
    const first = await exported(author);
    const recipient = await computer();
    await importPackage({ library: recipient.library }, first.archive);
    await addVersion(author, { graduateId: 'grd_desk', parent: 1 });
    author.library.promote('grd_desk', 2);
    const second = await exported(author);

    const preview = await previewImport({ library: recipient.library }, second.archive);
    expect(preview).toMatchObject({
      ok: true,
      place: {
        kind: 'version',
        graduateId: 'grd_desk',
        name: 'Service desk',
        version: 2,
        parent: 1,
      },
    });
    const again = await previewImport({ library: recipient.library }, first.archive);
    expect(again).toMatchObject({
      ok: true,
      place: { kind: 'installed', graduateId: 'grd_desk', version: 1 },
    });
  });

  it("reports a computer that can't run it as blocked, and never asks its runtime", async () => {
    const author = await computer();
    const { archive } = await exported(author);
    const small = await computer({ os: 'linux', arch: 'arm64', memoryBytes: 1024 ** 3 });

    const preview = await previewImport({ library: small.library }, archive);
    expect(preview).toMatchObject({ ok: true, status: 'blocked' });
    if (!preview.ok) return;
    expect(preview.reasons[0]).toContain('This computer is linux/arm64');
    expect(preview.checks.find((check) => check.kind === 'model_available')).toMatchObject({
      status: 'skipped',
    });
    expect(small.loaded).toEqual([]);
    expect(JSON.stringify(preview)).not.toContain(INSTALL_CHECKS_LABEL);
  });

  it('says what a package needs when its model is not on this computer', async () => {
    const author = await computer();
    const { archive } = await exported(author);
    const recipient = await computer();
    const create = recipient.library.ctx.deps.adapters.createStudent;
    recipient.library.ctx.deps.adapters.createStudent = (endpoint, options) => {
      const student = create(endpoint, options);
      student.describe = () => Promise.reject(new Error('model "muse-glimmer:30b" not found'));
      return student;
    };
    const preview = await previewImport({ library: recipient.library }, archive);
    expect(preview).toMatchObject({ ok: true, status: 'needs_attention' });
    if (!preview.ok) return;
    expect(preview.reasons).toEqual([
      expect.stringContaining('Downloading muse-glimmer:30b takes about 1 GB.'),
    ]);
  });

  it('lists the problems with a package it refuses, without staging any of it', async () => {
    const recipient = await computer();
    const folder = join(recipient.dataDir, 'not-a-package');
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'notes.txt'), 'nothing to install\n');

    const preview = await previewImport({ library: recipient.library }, folder);
    expect(preview).toEqual({
      ok: false,
      code: 'not_a_package',
      problems: ["There is no graduate.json in it, so it isn't a graduate package."],
    });
    expect(await readdir(recipient.paths.stagingDir())).toEqual([]);
  });
});

describe("a version's own report travels with it", () => {
  it('reads the same report card on the computer it was imported to, held to its checksum', async () => {
    const author = await computer();
    const { archive } = await exported(author);
    const recipient = await computer();
    await importPackage({ library: recipient.library }, archive);

    const theirs = await author.library.report('grd_desk');
    expect(await recipient.library.report('grd_desk')).toEqual(theirs);
    expect(theirs.test.score).toEqual(
      author.store.versions.get('grd_desk', 1)?.manifest.evidence.summary?.score,
    );

    const folder = recipient.paths.fromStored(
      recipient.store.versions.get('grd_desk', 1)?.path ?? '',
    );
    await writeFile(join(folder, 'evidence', 'report.json'), '{"tampered": true}\n');
    await expect(recipient.library.report('grd_desk')).rejects.toThrow('changed on disk');
  });

  it('says so when no locked test measured the version', async () => {
    const author = await computer();
    await addVersion(author, { graduateId: 'grd_desk', unevaluated: true });
    await expect(author.library.report('grd_desk')).rejects.toThrow(
      'No locked test measured version 1',
    );
  });
});
