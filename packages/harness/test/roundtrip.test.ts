import { mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  blankHarness,
  filesToHarness,
  harnessToFiles,
  HarnessValidationError,
  readHarness,
  writeHarness,
} from '../src';
import { cleanTempDirsAfterEach, sampleHarness, tempDir } from './fixtures';

cleanTempDirsAfterEach();

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

describe('harness object and files', () => {
  it('survives a round trip through the file map', () => {
    const harness = sampleHarness();
    const files = harnessToFiles(harness);
    expect(filesToHarness(files, harness.meta)).toEqual(harness);
  });

  it('produces the same files again from the harness it read', () => {
    const harness = sampleHarness();
    const files = harnessToFiles(harness);
    expect(harnessToFiles(filesToHarness(files, harness.meta))).toEqual(files);
  });

  it('writes the documented file names with snake_case keys', () => {
    const files = harnessToFiles(sampleHarness());
    expect(Object.keys(files)).toEqual([
      'decoding.yaml',
      'examples/after-hours-plan-member.json',
      'guardrails.yaml',
      'retrieval.yaml',
      'skills/overdue-balances.md',
      'skills/price-a-job.md',
      'system.md',
      'tools/invoice_total.js',
      'tools/invoice_total.json',
    ]);
    expect(files['decoding.yaml']).toBe(
      'temperature: 0.7\ntop_p: 0.9\ntop_k: 40\nmax_steps: 12\nmax_output_tokens: 4096\nthinking: medium\n',
    );
    expect(files['retrieval.yaml']).toContain('list_skills: true');
    expect(files['retrieval.yaml']).toContain('max_loaded_skills: 3');
    expect(files['retrieval.yaml']).toContain('- when_any: [invoice, bill, price the job]');
    expect(files['retrieval.yaml']).toContain('load_skills: [price-a-job]');
    expect(files['guardrails.yaml']).toContain('task_type: scheduling');
    expect(files['skills/price-a-job.md']).toMatch(
      /^---\nname: Price a completed job\nsummary: .+\ntask_types: \[invoice, quote\]\n---\n1\. Read the job/,
    );
    expect(files['examples/after-hours-plan-member.json']).toContain('"tool_call_id": "call_1"');
    expect(files['examples/after-hours-plan-member.json']).toContain('"tool_calls"');
  });

  it('leaves out optional files that hold defaults', () => {
    const blank = blankHarness('Desk', 'Answers office requests.');
    expect(Object.keys(harnessToFiles(blank))).toEqual(['system.md']);
    expect(Object.keys(harnessToFiles(blank, { includeDefaults: true }))).toEqual([
      'decoding.yaml',
      'guardrails.yaml',
      'retrieval.yaml',
      'system.md',
    ]);
  });

  it('restores an equal harness when the defaults are written out', () => {
    const blank = blankHarness('Desk', 'Answers office requests.');
    const files = harnessToFiles(blank, { includeDefaults: true });
    expect(filesToHarness(files, blank.meta)).toEqual(blank);
  });

  it('keeps tricky text intact', () => {
    const harness = sampleHarness();
    const first = harness.skills[0];
    if (!first) throw new Error('fixture has skills');
    const tricky = {
      ...harness,
      skills: [
        {
          ...first,
          name: 'Colons: "quotes" and # hashes',
          summary: '- starts with a dash, ends with a space ',
          body: '---\nnot front matter\n---\n\ntrailing blank lines\n\n\n',
        },
        ...harness.skills.slice(1),
      ],
      guardrails: {
        refuse: [
          {
            taskType: 'a',
            whenAny: ['yes', 'no', '60', 'a, b', 'null'],
            reason: 'Line one\nLine two',
          },
        ],
      },
    };
    expect(filesToHarness(harnessToFiles(tricky), tricky.meta)).toEqual(tricky);
  });

  it('sorts skills, tools and examples by slug', () => {
    const harness = sampleHarness();
    const shuffled = { ...harness, skills: [...harness.skills].reverse() };
    const back = filesToHarness(harnessToFiles(shuffled), harness.meta);
    expect(back.skills.map((skill) => skill.slug)).toEqual(['overdue-balances', 'price-a-job']);
  });

  it('reads CRLF files and a byte-order mark as plain LF text', () => {
    const harness = sampleHarness();
    const files = Object.fromEntries(
      Object.entries(harnessToFiles(harness)).map(([path, text]) => [
        path,
        `${BYTE_ORDER_MARK}${text.replace(/\n/g, '\r\n')}`,
      ]),
    );
    expect(filesToHarness(files, harness.meta)).toEqual(harness);
  });

  it('applies defaults to an empty optional file and to missing keys', () => {
    const blank = blankHarness('Desk', 'About the desk.');
    const files = {
      'system.md': blank.system,
      'decoding.yaml': '',
      'retrieval.yaml': 'max_examples: 0\n',
    };
    const harness = filesToHarness(files, blank.meta);
    expect(harness.decoding).toEqual(blank.decoding);
    expect(harness.retrieval).toEqual({ ...blank.retrieval, maxExamples: 0 });
  });

  it('drops a seed left over from an older decoding.yaml', () => {
    const blank = blankHarness('Desk', 'About the desk.');
    const files = { 'system.md': blank.system, 'decoding.yaml': 'temperature: 0.5\nseed: 7\n' };
    const harness = filesToHarness(files, blank.meta);
    expect(harness.decoding.temperature).toBe(0.5);
    expect(harness.decoding).not.toHaveProperty('seed');
  });

  it('throws every problem when the files are not a harness', () => {
    const blank = blankHarness('Desk', 'About the desk.');
    try {
      filesToHarness(
        { 'system.md': blank.system, 'decoding.yaml': 'top_p: 4\n', 'retrieval.yaml': '[' },
        blank.meta,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessValidationError);
      expect((error as HarnessValidationError).errors).toHaveLength(2);
    }
  });
});

describe('harness folder', () => {
  it('survives a round trip through a folder', async () => {
    const dir = await tempDir();
    const harness = sampleHarness();
    await writeHarness(dir, harness);
    expect(await readHarness(dir)).toEqual(harness);
  });

  it('writes harness.yaml with the format, name, version, parent and hash', async () => {
    const dir = await tempDir();
    const harness = sampleHarness();
    await writeHarness(dir, harness);
    expect(await readFile(join(dir, 'harness.yaml'), 'utf8')).toBe(
      `format: 1\nname: Service desk\nversion: 3\nparent: 2\nhash: ${harness.meta.hash}\n`,
    );
  });

  it('writes only LF line endings', async () => {
    const dir = await tempDir();
    const harness = sampleHarness();
    const crlf = { ...harness, system: 'Line one\r\nLine two\r\n' };
    await writeHarness(dir, crlf);
    for (const path of ['system.md', 'harness.yaml', 'retrieval.yaml', 'skills/price-a-job.md']) {
      expect(await readFile(join(dir, path), 'utf8'), path).not.toContain('\r');
    }
    expect((await readHarness(dir)).system).toBe('Line one\nLine two\n');
  });

  it('writes a blank harness as two files', async () => {
    const dir = await tempDir();
    await writeHarness(dir, blankHarness('Desk', 'Answers office requests.'));
    expect((await readdir(dir)).sort()).toEqual(['harness.yaml', 'system.md']);
  });

  it('removes files the harness no longer has and keeps files that are not part of a harness', async () => {
    const dir = await tempDir();
    await writeHarness(dir, sampleHarness());
    await writeFile(join(dir, 'graduate.yaml'), 'name: kept\n');

    const smaller = { ...sampleHarness(), skills: [], tools: [], examples: [] };
    await writeHarness(dir, { ...smaller, retrieval: { ...smaller.retrieval, rules: [] } });

    expect(
      await stat(join(dir, 'skills', 'price-a-job.md')).catch(() => undefined),
    ).toBeUndefined();
    expect(
      await stat(join(dir, 'tools', 'invoice_total.js')).catch(() => undefined),
    ).toBeUndefined();
    expect(await readFile(join(dir, 'graduate.yaml'), 'utf8')).toBe('name: kept\n');
    expect((await readHarness(dir)).skills).toEqual([]);
  });

  it('records the hash of the files it wrote, whatever the harness object said', async () => {
    const dir = await tempDir();
    const harness = sampleHarness();
    await writeHarness(dir, { ...harness, meta: { ...harness.meta, hash: 'stale' } });
    expect((await readHarness(dir)).meta.hash).toBe(harness.meta.hash);
  });

  it('refuses to write an invalid harness and writes nothing', async () => {
    const dir = await tempDir();
    const harness = sampleHarness();
    const bad = {
      ...harness,
      tools: [
        {
          ...(harness.tools[0] ?? {
            name: 'x',
            description: 'x',
            parameters: { type: 'object' as const },
            code: '',
          }),
          name: 'read_table',
        },
      ],
    };
    await expect(writeHarness(join(dir, 'out'), bad)).rejects.toBeInstanceOf(
      HarnessValidationError,
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses a skill whose slug would climb out of the folder', async () => {
    const dir = await tempDir();
    const harness = sampleHarness();
    const first = harness.skills[0];
    if (!first) throw new Error('fixture has skills');
    const bad = { ...harness, skills: [{ ...first, slug: '../../escape' }] };
    await expect(writeHarness(join(dir, 'out'), bad)).rejects.toBeInstanceOf(
      HarnessValidationError,
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it('reports a missing folder and a missing harness.yaml in plain words', async () => {
    const dir = await tempDir();
    await expect(readHarness(join(dir, 'nope'))).rejects.toThrow(/does not exist/);
    await mkdir(join(dir, 'empty'));
    await writeFile(join(dir, 'empty', 'system.md'), 'Hello.\n');
    await expect(readHarness(join(dir, 'empty'))).rejects.toThrow(/harness\.yaml: missing/);
  });

  it('ignores the files a file manager or editor leaves in a folder', async () => {
    const dir = await tempDir();
    const harness = sampleHarness();
    await writeHarness(dir, harness);
    for (const noise of [
      'skills/.DS_Store',
      'tools/Thumbs.db',
      'examples/desktop.ini',
      'skills/.price-a-job.md.swp',
    ]) {
      await writeFile(join(dir, noise), 'noise');
    }
    expect(await readHarness(dir)).toEqual(harness);
  });

  it('ignores a skills folder that is a link to somewhere else', async () => {
    const dir = await tempDir();
    const outside = await tempDir();
    await writeHarness(dir, blankHarness('Desk', 'About the desk.'));
    await writeFile(join(outside, 'secret.md'), '---\nname: s\nsummary: s\n---\nsecret\n');
    await symlink(outside, join(dir, 'skills'), 'junction');
    expect((await readHarness(dir)).skills).toEqual([]);
  });

  it('ignores symbolic links so a folder cannot read files from elsewhere', async (context) => {
    const dir = await tempDir();
    const outside = await tempDir();
    await writeHarness(dir, blankHarness('Desk', 'About the desk.'));
    await writeFile(join(outside, 'secret.md'), '---\nname: s\nsummary: s\n---\nsecret\n');
    await mkdir(join(dir, 'skills'));
    try {
      await symlink(join(outside, 'secret.md'), join(dir, 'skills', 'secret.md'));
    } catch {
      context.skip('this system does not allow creating symbolic links');
    }
    expect((await readHarness(dir)).skills).toEqual([]);
  });
});
