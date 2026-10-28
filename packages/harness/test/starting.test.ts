import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  blankHarness,
  harnessToFiles,
  HARNESS_TEMPLATES,
  hashHarness,
  HarnessValidationError,
  importHarness,
  templateHarness,
  writeHarness,
} from '../src';
import { cleanTempDirsAfterEach, sampleHarness, tempDir } from './fixtures';

cleanTempDirsAfterEach();

describe('blankHarness', () => {
  it('is harness.yaml and a short AGENTS.md, with default settings', async () => {
    const harness = blankHarness(
      'Service desk',
      'Handles the closing routine of a home-services office.',
    );
    expect(harness.system).toBe(
      'You are the Service desk agent.\n\nHandles the closing routine of a home-services office.\n',
    );
    expect(Object.keys(harnessToFiles(harness))).toEqual(['AGENTS.md']);
    expect(harness.skills).toEqual([]);
    expect(harness.tools).toEqual([]);
    expect(harness.examples).toEqual([]);
    expect(harness.meta).toEqual({
      format: 2,
      name: 'Service desk',
      version: 0,
      hash: hashHarness(harness),
    });
    expect(harness.decoding).toEqual({
      temperature: 1,
      topP: 0.95,
      topK: 64,
      maxSteps: 16,
      maxOutputTokens: 4096,
      thinking: 'low',
    });
    expect(harness.retrieval).toEqual({
      listSkills: true,
      maxLoadedSkills: 2,
      maxExamples: 2,
      rules: [],
    });
    expect(harness.guardrails).toEqual({ refuse: [] });

    const dir = await tempDir();
    await writeHarness(dir, harness);
    expect((await readdir(dir)).sort()).toEqual(['AGENTS.md', 'harness.yaml']);
  });

  it('copes with a missing description', () => {
    expect(blankHarness('Desk', '  \n').system).toBe('You are the Desk agent.\n');
  });
});

describe('templateHarness', () => {
  it('lists the one template', () => {
    expect(HARNESS_TEMPLATES.map((template) => template.id)).toEqual(['ops-analyst']);
  });

  it('opens with the job and continues with general operating rules', () => {
    const harness = templateHarness('Service desk', 'Handles the closing routine.', 'ops-analyst');
    expect(
      harness.system.startsWith(
        'You are the Service desk agent.\n\nHandles the closing routine.\n\n',
      ),
    ).toBe(true);
    expect(harness.system).toContain('How to work');
    expect(harness.system).toContain('csv.parse');
    expect(harness.meta.hash).toBe(hashHarness(harness));
    expect(Object.keys(harnessToFiles(harness))).toEqual(['AGENTS.md']);
  });

  it('has no task-specific content', () => {
    const { system } = templateHarness('Desk', 'About the desk.', 'ops-analyst');
    for (const word of ['invoice', 'plumb', 'heating', 'schedul', 'overdue', 'customer']) {
      expect(system.toLowerCase(), word).not.toContain(word);
    }
  });

  it('accepts the template with its folder prefix', () => {
    expect(templateHarness('Desk', 'About.', 'templates/ops-analyst')).toEqual(
      templateHarness('Desk', 'About.', 'ops-analyst'),
    );
  });

  it('names the templates that exist when asked for one that does not', () => {
    expect(() => templateHarness('Desk', 'About.', 'wizard')).toThrow(
      new HarnessValidationError(['Unknown template "wizard". Available: ops-analyst.']),
    );
  });
});

describe('importHarness', () => {
  it('reads a valid folder as a fresh starting point', async () => {
    const dir = await tempDir();
    const original = sampleHarness();
    await writeHarness(dir, original);
    const imported = await importHarness(dir);
    expect(imported).toEqual({
      ...original,
      meta: { format: 2, name: 'Service desk', version: 0, hash: original.meta.hash },
    });
    expect('parent' in imported.meta).toBe(false);
  });

  it('accepts a folder that is only its instructions, named after the folder', async () => {
    const root = await tempDir();
    const dir = join(root, 'my-agent');
    await mkdir(dir);
    await writeFile(join(dir, 'AGENTS.md'), 'You help.\r\n');
    const imported = await importHarness(dir);
    expect(imported.meta.name).toBe('my-agent');
    expect(imported.system).toBe('You help.\n');
    expect(imported.meta.hash).toBe(hashHarness(imported));
  });

  it('accepts a harness.yaml with only a format and a name', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'harness.yaml'), 'format: 2\nname: Hand made\n');
    await writeFile(join(dir, 'AGENTS.md'), 'You help.\n');
    expect((await importHarness(dir)).meta).toMatchObject({ name: 'Hand made', version: 0 });
  });

  it('reads a format 1 folder, with or without harness.yaml, in the current format', async () => {
    const root = await tempDir();
    const dir = join(root, 'old-agent');
    await mkdir(join(dir, 'skills'), { recursive: true });
    await writeFile(join(dir, 'system.md'), 'You help.\n');
    await writeFile(
      join(dir, 'skills', 'price-a-job.md'),
      '---\nname: Price a job\nsummary: Prices a job.\ntask_types: [invoice]\n---\n1. Read it.\n',
    );
    const bare = await importHarness(dir);
    expect(bare.meta).toMatchObject({ format: 2, name: 'old-agent', version: 0 });
    expect(bare.system).toBe('You help.\n');
    expect(bare.skills).toEqual([
      { name: 'price-a-job', description: 'Prices a job.', body: '# Price a job\n\n1. Read it.\n' },
    ]);
    await writeFile(join(dir, 'harness.yaml'), 'format: 1\nname: Hand made\n');
    expect(await importHarness(dir)).toEqual({
      ...bare,
      meta: { ...bare.meta, name: 'Hand made' },
    });
  });

  it('lists every problem in a folder that does not validate', async () => {
    const dir = await tempDir();
    await mkdir(join(dir, 'skills', 'broken'), { recursive: true });
    await writeFile(join(dir, 'AGENTS.md'), 'You help.\n');
    await writeFile(join(dir, 'skills', 'broken', 'SKILL.md'), 'no front matter\n');
    await writeFile(join(dir, 'decoding.yaml'), 'top_p: 3\n');
    await expect(importHarness(dir)).rejects.toThrow(
      /skills\/broken\/SKILL\.md: has no front matter[\s\S]*decoding\.yaml: top_p/,
    );
  });

  it('rejects a folder that does not exist', async () => {
    const dir = await tempDir();
    await expect(importHarness(join(dir, 'missing'))).rejects.toBeInstanceOf(
      HarnessValidationError,
    );
  });
});
