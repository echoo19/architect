import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HarnessValidationError,
  HarnessVersions,
  hashFiles,
  hashHarness,
  migrateFormat1,
  readGraduate,
  readHarness,
  readStoredHarness,
  renderReportMarkdown,
  writeHarness,
} from '../src';
import { stringifyYaml } from '../src/codec';
import { camelToSnake, mapKeys } from '../src/keys';
import { lineageToLine } from '../src/lineage';
import {
  cleanTempDirsAfterEach,
  sampleLineage,
  sampleManifest,
  sampleReport,
  tempDir,
} from './fixtures';

cleanTempDirsAfterEach();

/** The files of a harness as format 1 wrote them, harness.yaml aside. */
const FORMAT_1_FILES: Record<string, string> = {
  'system.md': 'You are the Service desk agent.\n',
  'skills/price-a-job.md':
    '---\nname: Price a completed job\nsummary: Turn a job into invoice lines.\ntask_types: [invoice]\n---\n1. Read the job.\n',
  'retrieval.yaml':
    'list_skills: true\nmax_loaded_skills: 2\nmax_examples: 2\nrules:\n  - when_any: [invoice]\n    load_skills: [price-a-job]\n',
};

/** Writes a folder the way format 1 did, harness.yaml last with the hash of the files. */
async function writeFormat1(dir: string, version = 1): Promise<string> {
  for (const [path, text] of Object.entries(FORMAT_1_FILES)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  const hash = hashFiles(FORMAT_1_FILES);
  await writeFile(
    join(dir, 'harness.yaml'),
    stringifyYaml({ format: 1, name: 'Service desk', version, hash }),
  );
  return hash;
}

describe('format 1 files', () => {
  it('move the instructions to AGENTS.md and each skill into its folder', () => {
    const problems: string[] = [];
    expect(migrateFormat1(FORMAT_1_FILES, problems)).toEqual({
      'AGENTS.md': 'You are the Service desk agent.\n',
      'skills/price-a-job/SKILL.md':
        '---\nname: price-a-job\ndescription: Turn a job into invoice lines.\n---\n# Price a completed job\n\n1. Read the job.\n',
      'retrieval.yaml': FORMAT_1_FILES['retrieval.yaml'],
    });
    expect(problems).toEqual([]);
  });

  it('rename a helper that has the name of a built-in tool today, so the harness loads', () => {
    const problems: string[] = [];
    const manifest = (name: string) =>
      JSON.stringify({ name, description: 'Finds lines.', parameters: { type: 'object' } });
    const code = 'function run(args, ctx) {\n  return 1;\n}\n';
    const migrated = migrateFormat1(
      {
        'system.md': 'Hi.\n',
        'tools/grep.json': manifest('grep'),
        'tools/grep.js': code,
        'tools/grep_helper.json': manifest('grep_helper'),
        'tools/grep_helper.js': code,
      },
      problems,
    );
    expect(problems).toEqual([]);
    expect(Object.keys(migrated).sort()).toEqual([
      'AGENTS.md',
      'tools/grep_helper.js',
      'tools/grep_helper.json',
      'tools/grep_helper2.js',
      'tools/grep_helper2.json',
    ]);
    expect(JSON.parse(migrated['tools/grep_helper2.json'] ?? '{}').name).toBe('grep_helper2');
    expect(migrated['tools/grep_helper2.js']).toBe(code);
  });

  it('name the old file when one of them is broken', () => {
    const problems: string[] = [];
    migrateFormat1(
      {
        'system.md': 'Hi.\n',
        'AGENTS.md': 'Hello.\n',
        'skills/a.md': 'no front matter\n',
        'skills/b.md': '---\nname: B\n---\nsteps\n',
      },
      problems,
    );
    expect(problems).toEqual([
      'system.md: the folder also has AGENTS.md. Keep the instructions in AGENTS.md only.',
      'skills/a.md: has no front matter between "---" lines.',
      'skills/b.md: a format 1 skill needs a name and a summary in its front matter.',
    ]);
  });
});

describe('a format 1 folder', () => {
  it('is read in the current format, with a hash over the files it would write', async () => {
    const dir = await tempDir();
    const recorded = await writeFormat1(dir);
    const stored = await readStoredHarness(dir);
    expect(stored).toMatchObject({ format: 1, recordedHash: recorded, filesHash: recorded });
    expect(stored.harness.meta).toEqual({
      format: 2,
      name: 'Service desk',
      version: 1,
      hash: hashHarness(stored.harness),
    });
    expect(stored.harness.meta.hash).not.toBe(recorded);
    expect(stored.harness.system).toBe('You are the Service desk agent.\n');
    expect(stored.harness.skills.map((skill) => skill.name)).toEqual(['price-a-job']);
    expect(await readHarness(dir)).toEqual(stored.harness);
  });

  it('loads as a saved version, and not once a file changed', async () => {
    const root = await tempDir();
    await writeFormat1(join(root, 'v0001'));
    const versions = new HarnessVersions(root);
    const loaded = await versions.load(1);
    expect(loaded.skills[0]?.description).toBe('Turn a job into invoice lines.');
    const next = await versions.save({ ...loaded, system: 'Changed.\n' }, 1);
    expect(next.meta).toMatchObject({ format: 2, version: 2, parent: 1 });
    expect((await readdir(join(root, 'v0002'))).sort()).toEqual([
      'AGENTS.md',
      'harness.yaml',
      'retrieval.yaml',
      'skills',
    ]);
    await writeFile(join(root, 'v0001', 'system.md'), 'Quietly changed.\n');
    await expect(versions.load(1)).rejects.toThrow(
      'v0001: files changed after the version was saved.',
    );
  });

  it('loads as a graduate checked against its files as stored', async () => {
    const dir = await tempDir();
    const recorded = await writeFormat1(dir, 3);
    const harness = await readHarness(dir);
    const manifest = { ...sampleManifest(harness), harness: { version: 3, hash: recorded } };
    await writeFile(join(dir, 'graduate.yaml'), stringifyYaml(mapKeys(manifest, camelToSnake)));
    await writeFile(
      join(dir, 'report.json'),
      JSON.stringify(mapKeys(sampleReport(), camelToSnake)),
    );
    await writeFile(join(dir, 'report.md'), renderReportMarkdown(sampleReport()));
    await writeFile(
      join(dir, 'lineage.jsonl'),
      `${sampleLineage().map(lineageToLine).join('\n')}\n`,
    );

    const graduate = await readGraduate(dir);
    expect(graduate.manifest.harness.hash).toBe(recorded);
    expect(graduate.harness).toEqual(harness);
    await writeFile(join(dir, 'skills', 'price-a-job.md'), '---\nname: X\nsummary: Y\n---\n');
    await expect(readGraduate(dir)).rejects.toThrow('do not match the hash');
  });

  it('is rewritten in the current format, its old files removed', async () => {
    const dir = await tempDir();
    await writeFormat1(dir);
    const harness = await readHarness(dir);
    await writeFile(join(dir, 'graduate.yaml'), 'kept: true\n');
    await writeHarness(dir, harness);
    expect((await readdir(dir)).sort()).toEqual([
      'AGENTS.md',
      'graduate.yaml',
      'harness.yaml',
      'retrieval.yaml',
      'skills',
    ]);
    expect(await readdir(join(dir, 'skills'))).toEqual(['price-a-job']);
    expect(await readFile(join(dir, 'harness.yaml'), 'utf8')).toContain('format: 2');
    expect(await readHarness(dir)).toEqual(harness);
  });

  it('with both system.md and AGENTS.md is refused', async () => {
    const dir = await tempDir();
    await writeFormat1(dir);
    await writeFile(join(dir, 'AGENTS.md'), 'Which one?\n');
    await expect(readHarness(dir)).rejects.toBeInstanceOf(HarnessValidationError);
  });
});
