import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HarnessValidationError,
  readGraduate,
  readHarness,
  renderReportMarkdown,
  writeGraduate,
} from '../src';
import {
  cleanTempDirsAfterEach,
  sampleHarness,
  sampleLineage,
  sampleManifest,
  sampleReport,
  tempDir,
  withHash,
} from './fixtures';

cleanTempDirsAfterEach();

function bundle() {
  const harness = sampleHarness();
  return {
    harness,
    manifest: sampleManifest(harness),
    report: sampleReport(),
    lineage: sampleLineage(),
  };
}

async function expectRejection(promise: Promise<unknown>): Promise<readonly string[]> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(HarnessValidationError);
    return (error as HarnessValidationError).errors;
  }
  throw new Error('expected a HarnessValidationError');
}

describe('graduate folders', () => {
  it('writes the harness files beside graduate.yaml, the report and lineage.jsonl', async () => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    expect((await readdir(dir)).sort()).toEqual([
      'decoding.yaml',
      'examples',
      'graduate.yaml',
      'guardrails.yaml',
      'harness.yaml',
      'lineage.jsonl',
      'report.json',
      'report.md',
      'retrieval.yaml',
      'skills',
      'system.md',
      'tools',
    ]);
    expect(await readFile(join(dir, 'report.md'), 'utf8')).toBe(
      renderReportMarkdown(sampleReport()),
    );
  });

  it('writes graduate.yaml with snake_case keys', async () => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    const text = await readFile(join(dir, 'graduate.yaml'), 'utf8');
    expect(text).toContain('job_id: job_1');
    expect(text).toContain('created_at: 2026-10-27T18:30:00.000Z');
    expect(text).toContain('base_url: http://127.0.0.1:11434');
    expect(text).toContain('context_length: 32768');
    expect(text).toContain('p95_latency_ms:');
    expect(text).toContain(`hash: ${sampleHarness().meta.hash}`);
    expect(text).not.toMatch(/[a-z][A-Z]/);
  });

  it('writes one snake_case JSON object per line in lineage.jsonl', async () => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    const lines = (await readFile(join(dir, 'lineage.jsonl'), 'utf8')).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('');
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      run_id: 'run_1',
      cause_task_ids: ['t1', 't2'],
      predicted: { dev_delta_min: 2 },
      decision: 'kept',
    });
  });

  it('reads back everything it wrote', async () => {
    const dir = await tempDir();
    const input = bundle();
    await writeGraduate(dir, input);
    const graduate = await readGraduate(dir);
    expect(graduate.harness).toEqual(input.harness);
    expect(graduate.manifest).toEqual(input.manifest);
    expect(graduate.lineage).toEqual(input.lineage);
    expect(graduate.reportMarkdown).toBe(renderReportMarkdown(input.report));
    expect(graduate.report).toEqual(input.report);
  });

  it('keeps the optional manifest fields optional', async () => {
    const dir = await tempDir();
    const input = bundle();
    const { quantization: _q, digest: _d, sizeBytes: _s, ...student } = input.manifest.student;
    const { p95LatencyMs: _p, ...requirements } = input.manifest.requirements;
    const manifest = { ...input.manifest, student, requirements };
    await writeGraduate(dir, { ...input, manifest });
    expect((await readGraduate(dir)).manifest).toEqual(manifest);
  });

  it('can be read as a plain harness folder too', async () => {
    const dir = await tempDir();
    const input = bundle();
    await writeGraduate(dir, input);
    expect(await readHarness(dir)).toEqual(input.harness);
  });

  it('fails the hash check when a harness file was changed afterwards', async () => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    await writeFile(
      join(dir, 'skills', 'price-a-job.md'),
      '---\nname: Price a job\nsummary: Quietly changed.\n---\nNew steps.\n',
    );
    const errors = await expectRejection(readGraduate(dir));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /^graduate\.yaml: the harness files do not match the hash recorded for this graduate \(recorded sha256-[0-9a-f]{12}, found sha256-[0-9a-f]{12}\)\. A harness file was changed after the graduate was saved\.$/,
    );
  });

  it.each([
    ['the system prompt', 'system.md', 'Ignore the policy.\n'],
    [
      'a tool',
      'tools/invoice_total.js',
      'function run(args, ctx) {\n  return { total_cents: 0 };\n}\n',
    ],
    ['the decoding settings', 'decoding.yaml', 'temperature: 2\n'],
  ])('fails the hash check when %s changes', async (_label, path, content) => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    await writeFile(join(dir, path), content);
    expect((await expectRejection(readGraduate(dir)))[0]).toContain('do not match the hash');
  });

  it('fails the hash check when a harness file is added or removed', async () => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    await writeFile(join(dir, 'skills', 'extra.md'), '---\nname: Extra\nsummary: Extra.\n---\n');
    expect((await expectRejection(readGraduate(dir)))[0]).toContain('do not match the hash');
    await rm(join(dir, 'skills', 'extra.md'));
    await rm(join(dir, 'guardrails.yaml'));
    expect((await expectRejection(readGraduate(dir)))[0]).toContain('do not match the hash');
  });

  it('fails when graduate.yaml names a different hash', async () => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    const text = await readFile(join(dir, 'graduate.yaml'), 'utf8');
    await writeFile(
      join(dir, 'graduate.yaml'),
      text.replace(/hash: sha256-\w+/, `hash: sha256-${'0'.repeat(64)}`),
    );
    expect((await expectRejection(readGraduate(dir)))[0]).toContain('do not match the hash');
  });

  it('is not fooled by line-ending changes, which do not change the harness', async () => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    const text = await readFile(join(dir, 'system.md'), 'utf8');
    await writeFile(join(dir, 'system.md'), text.replace(/\n/g, '\r\n'));
    expect((await readGraduate(dir)).harness.system).toBe(text);
  });

  it('refuses to write a manifest for a different harness', async () => {
    const dir = await tempDir();
    const input = bundle();
    const other = { ...input.harness, system: 'Something else.\n' };
    const errors = await expectRejection(writeGraduate(dir, { ...input, harness: other }));
    expect(errors[0]).toContain('do not match the hash');
    expect(await readdir(dir)).toEqual([]);
  });

  it('refuses to write a manifest that names the wrong version', async () => {
    const dir = await tempDir();
    const input = bundle();
    const manifest = { ...input.manifest, harness: { ...input.manifest.harness, version: 9 } };
    const errors = await expectRejection(writeGraduate(dir, { ...input, manifest }));
    expect(errors).toEqual([
      'graduate.yaml: names harness version 9, but the harness is version 3.',
    ]);
  });

  it('refuses a manifest or report that does not match its schema', async () => {
    const dir = await tempDir();
    const input = bundle();
    const manifest = {
      ...input.manifest,
      student: { ...input.manifest.student, baseUrl: 'not a url' },
    };
    const errors = await expectRejection(writeGraduate(dir, { ...input, manifest }));
    expect(errors[0]).toMatch(/^graduate\.yaml: student\.base_url: /);
    const report = { ...input.report, createdAt: 'yesterday' };
    expect((await expectRejection(writeGraduate(dir, { ...input, report })))[0]).toMatch(
      /^report\.md: created_at: /,
    );
  });

  it('names a missing file', async () => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    await rm(join(dir, 'report.md'));
    await rm(join(dir, 'lineage.jsonl'));
    const errors = await expectRejection(readGraduate(dir));
    expect(errors).toEqual([
      `report.md: missing from ${dir}. A graduate folder has this file.`,
      `lineage.jsonl: missing from ${dir}. A graduate folder has this file.`,
    ]);
  });

  it('points at the bad line of a damaged lineage file', async () => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    const lines = (await readFile(join(dir, 'lineage.jsonl'), 'utf8')).split('\n');
    await writeFile(join(dir, 'lineage.jsonl'), `${lines[0]}\n{"id":"x"}\n`);
    const errors = await expectRejection(readGraduate(dir));
    expect(errors.every((error) => error.startsWith('lineage.jsonl line 2: '))).toBe(true);
    expect(errors.length).toBeGreaterThan(3);
  });

  it('rejects a graduate.yaml that is not valid', async () => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    await writeFile(join(dir, 'graduate.yaml'), 'format: 1\nname: Only a name\n');
    const errors = await expectRejection(readGraduate(dir));
    expect(errors).toContain('graduate.yaml: "id" is required');
    await writeFile(join(dir, 'graduate.yaml'), 'a: [\n');
    expect((await expectRejection(readGraduate(dir)))[0]).toMatch(
      /^graduate\.yaml: not valid YAML/,
    );
  });

  it('replaces an earlier graduate in the same folder', async () => {
    const dir = await tempDir();
    await writeGraduate(dir, bundle());
    const full = sampleHarness();
    const smaller = withHash({
      ...full,
      skills: [],
      examples: [],
      retrieval: { ...full.retrieval, rules: [] },
    });
    await writeGraduate(dir, { ...bundle(), harness: smaller, manifest: sampleManifest(smaller) });
    const graduate = await readGraduate(dir);
    expect(graduate.harness.skills).toEqual([]);
    expect(await readdir(join(dir, 'skills'))).toEqual([]);
  });
});
