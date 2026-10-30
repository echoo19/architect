import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { FAKE_HUB_TOKEN, startFakeHub } from '@architect/engine/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanUp, cli, tempDir, testEnv } from './support';

const MOE = fileURLToPath(
  new URL('../../../packages/engine/test/fixtures/model-configs/moe-235b.json', import.meta.url),
);
const COMMIT = 'b'.repeat(40);

afterEach(cleanUp);

describe('architect train', () => {
  it('plans a job from a config.json, each term with its arithmetic, as an estimate', async () => {
    const env = await testEnv();
    const result = await cli(
      ['train', 'plan', '--config', MOE, '--method', 'qlora', '--gpu', 'h200', '--json'],
      { env },
    );
    expect(result.code, result.stderr).toBe(0);
    const plan = JSON.parse(result.stdout) as {
      format: string;
      label: string;
      terms: { key: string; arithmetic: string }[];
      size: { experts: number };
      fit: { gpus: number; nodes: number };
    };
    expect(plan.format).toBe('architect.training-plan/1');
    expect(plan.label).toBe('estimate');
    expect(plan.size.experts).toBe(128);
    expect(plan.terms.map((term) => term.key)).toContain('fsdp_peak');
    expect(plan.fit.nodes).toBeGreaterThanOrEqual(1);

    const text = await cli(['train', 'plan', '--config', MOE], { env });
    expect(text.stdout).toContain('every expert');
    expect(text.stdout).toContain('Estimates, not measurements.');
    expect(text.stdout).toContain('training gains remain unverified');
  });

  it('reads the config from the Hub at the commit the branch points to', async () => {
    const hub = await startFakeHub();
    try {
      hub.repos.set('lab/moe', { private: false, commits: [] });
      const commit = hub.commit('lab/moe', { 'config.json': readFileSync(MOE) });
      const env = await testEnv({ HF_ENDPOINT: hub.url, HF_TOKEN: FAKE_HUB_TOKEN });
      const result = await cli(['train', 'plan', '--model', 'lab/moe', '--json'], { env });
      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        model: { repo: 'lab/moe', revision: commit },
      });
    } finally {
      await hub.close();
    }
  });

  it('writes a Kubernetes bundle from a field export and prints the command to submit it', async () => {
    const env = await testEnv();
    const exported = await tempDir('export');
    await mkdir(join(exported, 'sft'), { recursive: true });
    const train = '{"messages":[]}\n';
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const stamp = '2026-10-30T00:00:00.000Z';
    await writeFile(
      join(exported, 'MANIFEST.json'),
      JSON.stringify({
        format: 'architect.field-export/1',
        created_at: stamp,
        job: { id: 'j', name: 'J', format: 1, created_at: stamp, sha256: sha('j') },
        counts: {
          demonstrations: 1,
          trained_turns: 1,
          train_tasks: 1,
          train_organizations: 1,
          sealed_organizations: 1,
          locked_test_tasks: 1,
        },
        files: { 'sft/train.jsonl': sha(train) },
        permitted_uses: { sft: [], env: [], eval: [] },
        left_out: [],
      }),
    );
    await writeFile(join(exported, 'sft', 'train.jsonl'), train);
    const out = join(await tempDir('out'), 'bundle');
    const result = await cli(
      [
        'train',
        'bundle',
        '--target',
        'kubernetes',
        '--config',
        MOE,
        '--model',
        'lab/moe',
        '--revision',
        COMMIT,
        '--export',
        exported,
        '--output',
        out,
      ],
      { env },
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('kubectl apply -f pytorchjob.yaml');
    expect(result.stdout).toContain('EXPERIMENTAL, NOT RUN');
    for (const file of ['pytorchjob.yaml', 'train_fsdp.py', 'README.txt', 'data/train.jsonl']) {
      expect(existsSync(join(out, file)), file).toBe(true);
    }
    const bundle = JSON.parse(readFileSync(join(out, 'bundle.json'), 'utf8')) as {
      base_model: { revision: string };
      field_export: { declared_hash: string };
    };
    expect(bundle.base_model.revision).toBe(COMMIT);
    expect(bundle.field_export.declared_hash).toBe(sha('j'));
  });

  it('refuses what it can’t size or trace, with exit code 2', async () => {
    const env = await testEnv();
    const dir = await tempDir('cfg');
    const config = join(dir, 'config.json');
    await writeFile(config, JSON.stringify({ model_type: 'mamba', hidden_size: 1 }));
    const unsizable = await cli(['train', 'plan', '--config', config], { env });
    expect(unsizable.code).toBe(2);
    expect(unsizable.stderr).toContain("can't be sized");

    const untraced = await cli(
      [
        'train',
        'bundle',
        '--target',
        'slurm',
        '--config',
        MOE,
        '--model',
        'lab/moe',
        '--output',
        join(dir, 'b'),
      ],
      { env },
    );
    expect(untraced.code).toBe(2);
    expect(untraced.stderr).toContain('40-character commit');

    const wrong = await cli(['train', 'plan', '--config', MOE, '--method', 'rl'], { env });
    expect(wrong.code).toBe(2);
    expect(wrong.stderr).toContain('--method takes lora, qlora, full');
  });
});
