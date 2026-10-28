import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportPart, reviewExport, type ExportContext } from '../src/graduates/exporter';
import {
  addVersion,
  harnessWith,
  newComputer,
  PRICE_TOOL,
  type Computer,
} from './support/computer';

const STORED_KEY = 'mk-live-7f3a9c2b11d04e55aa';
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function computer(): Promise<Computer> {
  const made = await newComputer();
  cleanups.push(() => made.remove());
  return made;
}

function exporter(made: Computer): ExportContext {
  return {
    library: made.library,
    secrets: { get: async (ref) => (ref === 'meta' ? STORED_KEY : undefined) },
  };
}

describe('exporting part of a version on its own', () => {
  it('lists the harness, the adapter and the report, with their sizes', async () => {
    const author = await computer();
    await addVersion(author, { graduateId: 'grd_desk', adapter: 'LORA WEIGHTS' });
    const review = await reviewExport(exporter(author), 'grd_desk');
    expect(review.parts.map(({ part, files }) => [part, files])).toEqual([
      ['harness', expect.arrayContaining(['harness/AGENTS.md', 'harness/harness.yaml'])],
      ['adapter', ['adapter/adapter.gguf']],
      ['report', ['evidence/report.md']],
    ]);
    expect(review.parts.find((part) => part.part === 'adapter')?.bytes).toBe(12);
    expect(review.parts.every((part) => part.files.every((file) => file !== 'graduate.json'))).toBe(
      true,
    );
  });

  it('has no adapter part without an adapter, and no report part without a locked test', async () => {
    const author = await computer();
    await addVersion(author, { graduateId: 'grd_desk', unevaluated: true });
    const review = await reviewExport(exporter(author), 'grd_desk');
    expect(review.parts.map((part) => part.part)).toEqual(['harness']);
    await expect(
      exportPart(exporter(author), 'grd_desk', {
        part: 'report',
        directory: join(author.dataDir, 'out'),
      }),
    ).rejects.toThrow('has no report');
  });

  it('writes the harness as a folder, the adapter byte for byte, and the report', async () => {
    const author = await computer();
    await addVersion(author, {
      graduateId: 'grd_desk',
      adapter: 'LORA WEIGHTS',
      harness: harnessWith('Service desk', { tools: [PRICE_TOOL] }),
    });
    const directory = join(author.dataDir, 'out');
    const harness = await exportPart(exporter(author), 'grd_desk', { part: 'harness', directory });
    expect(harness.path).toBe(join(directory, 'service-desk-v1-harness'));
    expect(harness.files).toEqual(
      expect.arrayContaining(['AGENTS.md', 'harness.yaml', 'tools/invoice_total.js']),
    );
    const version = author.paths.fromStored(author.store.versions.get('grd_desk', 1)?.path ?? '');
    expect(await readFile(join(harness.path, 'AGENTS.md'), 'utf8')).toBe(
      await readFile(join(version, 'harness', 'AGENTS.md'), 'utf8'),
    );

    const adapter = await exportPart(exporter(author), 'grd_desk', { part: 'adapter', directory });
    expect(adapter).toMatchObject({
      path: join(directory, 'service-desk-v1-adapter.gguf'),
      bytes: 12,
    });
    expect(await readFile(adapter.path, 'utf8')).toBe('LORA WEIGHTS');

    const report = await exportPart(exporter(author), 'grd_desk', { part: 'report', directory });
    expect(report.path).toBe(join(directory, 'service-desk-v1-report.md'));
    expect(await readFile(report.path, 'utf8')).toBe(
      await readFile(join(version, 'evidence', 'report.md'), 'utf8'),
    );
    expect((await readdir(directory)).sort()).toEqual([
      'service-desk-v1-adapter.gguf',
      'service-desk-v1-harness',
      'service-desk-v1-report.md',
    ]);
    await expect(
      exportPart(exporter(author), 'grd_desk', { part: 'report', directory }),
    ).rejects.toThrow('already exists');
  });

  it("stops at a key in the harness until the user confirms that part's findings", async () => {
    const author = await computer();
    await addVersion(author, {
      graduateId: 'grd_desk',
      harness: harnessWith('Service desk', { system: `Use the key ${STORED_KEY} when asked.` }),
    });
    const review = await reviewExport(exporter(author), 'grd_desk');
    const harness = review.parts.find((part) => part.part === 'harness');
    const report = review.parts.find((part) => part.part === 'report');
    const directory = join(author.dataDir, 'out');

    await expect(
      exportPart(exporter(author), 'grd_desk', { part: 'harness', directory }),
    ).rejects.toThrow('Nothing was exported');
    await expect(readdir(directory)).rejects.toThrow();
    // The report has no finding, so it goes without a confirmation.
    await exportPart(exporter(author), 'grd_desk', { part: 'report', directory });
    expect(report?.findingsDigest).not.toBe(harness?.findingsDigest);

    const confirmed = await exportPart(exporter(author), 'grd_desk', {
      part: 'harness',
      directory,
      acknowledgedFindings: harness?.findingsDigest ?? '',
    });
    expect(confirmed.findings.map(({ path, kind }) => [path, kind])).toEqual([
      ['harness/AGENTS.md', 'stored_key'],
    ]);
  });
});
