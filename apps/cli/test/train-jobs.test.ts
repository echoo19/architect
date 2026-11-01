import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { encodeGguf, float32Bytes } from '@architect/engine';
import { FAKE_HUB_TOKEN, startFakeHub, type FakeHub } from '@architect/engine/testing';
import {
  DATASET_EXAMPLE_FORMAT,
  GLIMMER_TRAINING_BASE,
  type TrainerOutput,
  type TrainingJobRecord,
} from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanUp, cli, tempDir, testEnv } from './support';

const sha = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const STAMP = '2026-11-01T00:00:00.000Z';

let hub: FakeHub;
beforeEach(async () => {
  hub = await startFakeHub();
  // The base model's repository, so its revision can be looked up and pinned.
  hub.repos.set(GLIMMER_TRAINING_BASE.repo, { private: false, commits: [] });
  hub.commit(GLIMMER_TRAINING_BASE.repo, { 'config.json': Buffer.from('{}') });
});
afterEach(async () => {
  await hub.close();
  await cleanUp();
});

/** One demonstration as a field export writes it: an example, the checker's pass, its uses. */
function demonstration(id: string) {
  return {
    format: DATASET_EXAMPLE_FORMAT,
    id,
    episode_id: id,
    lesson_id: id,
    kind: 'passed_attempt',
    category: 'reserve',
    messages: [
      { role: 'system', content: 'You run the compound store.', train: false },
      { role: 'user', content: 'How much of FWC-1 is usable?', train: false },
      { role: 'assistant', content: 'ANSWER: {"usable": 42}', train: true },
    ],
    tools: [],
    chat_template_kwargs: { reasoning_strength: 'high' },
    provenance: {
      job_id: 'inventory',
      origin: 'task fenwick-usable-01 (train)',
      student_model: 'meta/muse-glimmer-30b',
      verified_at: STAMP,
      check_reason: '42 µL of FWC-1 is usable.',
    },
    verdict: { pass: true, reason: '42 µL of FWC-1 is usable.' },
    permitted_uses: ['supervised fine-tuning', 'training off this computer'],
  };
}

async function fieldExport(lines: unknown[]): Promise<string> {
  const dir = await tempDir('export');
  await mkdir(join(dir, 'sft'), { recursive: true });
  const text = lines.map((line) => `${JSON.stringify(line)}\n`).join('');
  await writeFile(join(dir, 'sft', 'demonstrations.jsonl'), text);
  await writeFile(
    join(dir, 'MANIFEST.json'),
    JSON.stringify({
      format: 'architect.field-export/1',
      created_at: STAMP,
      job: {
        id: 'inventory',
        name: 'Inventory desk',
        format: 1,
        created_at: STAMP,
        sha256: sha('j'),
      },
      counts: {
        demonstrations: lines.length,
        trained_turns: lines.length,
        train_tasks: 1,
        train_organizations: 1,
        sealed_organizations: 1,
        locked_test_tasks: 1,
      },
      files: { 'sft/demonstrations.jsonl': sha(text) },
      permitted_uses: { sft: [], env: [], eval: [] },
      left_out: [{ what: 'demonstration att_x', why: 'its data may not leave this computer' }],
    }),
  );
  return dir;
}

/** A training job's record as `--json` prints it. */
interface JobJson {
  format: string;
  id: string;
  state: TrainingJobRecord['state'];
  base_model: TrainingJobRecord['baseModel'];
  recipe: TrainingJobRecord['recipe'];
  dataset: { sha256: string; example_count: number };
  compute: { authorized_seconds: number; flavor: string };
  provider: { id: string; repo: string };
}

/** What a finished job uploads: a converted adapter, the PEFT files and a manifest of hashes. */
function outputsFor(record: JobJson): Record<string, Buffer> {
  const adapter = encodeGguf({
    metadata: [
      ['general.architecture', { type: 'string', value: 'muse-glimmer' }],
      ['general.type', { type: 'string', value: 'adapter' }],
      ['adapter.type', { type: 'string', value: 'lora' }],
      ['adapter.lora.alpha', { type: 'float32', value: 32 }],
    ],
    tensors: [
      {
        name: 'blk.0.attn_q.weight.lora_a',
        dims: [64, 16],
        type: 'F32',
        bytes: () => float32Bytes(new Float32Array(64 * 16).fill(0.01)),
      },
      {
        name: 'blk.0.attn_q.weight.lora_b',
        dims: [16, 32],
        type: 'F32',
        bytes: () => float32Bytes(new Float32Array(16 * 32).fill(0.02)),
      },
    ],
  });
  const files: Record<string, Buffer> = {
    'peft/adapter_config.json': Buffer.from('{"r": 16, "lora_alpha": 32}\n'),
    'peft/adapter_model.safetensors': Buffer.from('safetensors bytes'),
    'adapter.gguf': adapter,
    'train.log': Buffer.from('step 1: loss 1.9000, learning rate 2e-05\n'),
  };
  const kinds = {
    'peft/adapter_config.json': 'peft_config',
    'peft/adapter_model.safetensors': 'peft_weights',
    'adapter.gguf': 'gguf_lora',
    'train.log': 'log',
  } as const;
  const manifest: TrainerOutput = {
    format: 'architect.trainer-output/1',
    job_id: record.id,
    stand_in: false,
    base_model: record.base_model,
    dataset: {
      sha256: record.dataset.sha256,
      example_count: 2,
      trained_examples: 2,
      trained_tokens: 42,
      skipped: [],
    },
    recipe: record.recipe,
    lora: { r: 16, alpha: 32, target_modules: 'q_proj' },
    converter: { commit: '60eeeb6082c1126bb8bc72902c83123cd056811b', outtype: 'f16' },
    versions: { python: '3.12.3' },
    metrics: {
      steps: 1,
      loss_first: 1.9,
      loss_last: 1.9,
      train_seconds: 600,
      convert_seconds: 80,
      stopped_early: false,
    },
    files: Object.entries(files).map(([path, content]) => ({
      path,
      sha256: sha(content),
      bytes: content.length,
      kind: kinds[path as keyof typeof kinds],
    })),
  };
  return Object.fromEntries([
    ...Object.entries(files).map(([path, content]) => [`outputs/${path}`, content] as const),
    ['outputs/manifest.json', Buffer.from(JSON.stringify(manifest))],
  ]);
}

describe('architect train on Hugging Face Jobs', () => {
  it("sends a field export's demonstrations, held to the cap, then downloads and checks the adapter", async () => {
    const env = await testEnv({ HF_ENDPOINT: hub.url, HF_TOKEN: FAKE_HUB_TOKEN });
    const exported = await fieldExport([demonstration('att_1'), demonstration('att_2')]);

    // 35 minutes on an L40S cost more than 50 cents: nothing is sent.
    const poor = await cli(['train', 'start', '--export', exported, '--max-usd', '0.5'], { env });
    expect(poor.code).toBe(3);
    expect(poor.stderr).toContain('a training job needs at least 35');
    expect(hub.jobs.size).toBe(0);

    const started = await cli(
      ['train', 'start', '--export', exported, '--max-usd', '25', '--max-minutes', '90', '--json'],
      { env },
    );
    expect(started.code, started.stderr).toBe(0);
    const record = JSON.parse(started.stdout) as JobJson;
    expect(record.format).toBe('architect.training-job/1');
    expect(record.state).toBe('queued');
    expect(record.compute).toMatchObject({ flavor: 'l40sx1', authorized_seconds: 90 * 60 });
    expect(record.base_model.repo).toBe(GLIMMER_TRAINING_BASE.repo);
    expect(record.dataset.example_count).toBe(2);
    expect(hub.jobs.size).toBe(1);
    // Inputs and outputs share one private repository; the examples went without their verdicts.
    const repo = hub.repos.get(record.provider.repo);
    expect(repo?.private).toBe(true);
    const examples = repo?.commits[0]?.files.get('inputs/examples.jsonl')?.toString() ?? '';
    expect(examples.split('\n').filter(Boolean)).toHaveLength(2);
    expect(examples).not.toContain('permitted_uses');

    // The same export again is the same job, not a second one.
    const again = await cli(['train', 'start', '--export', exported, '--max-usd', '25'], { env });
    expect(again.code, again.stderr).toBe(0);
    expect(again.stdout).toContain(record.id);
    expect(hub.jobs.size).toBe(1);

    const running = await cli(['train', 'status', record.id], { env });
    expect(running.code, running.stderr).toBe(0);
    expect(running.stdout).toContain(`${record.id}: `);

    hub.setStage(record.provider.id, 'COMPLETED');
    hub.commit(record.provider.repo, outputsFor(record));
    const done = await cli(['train', 'status', record.id, '--wait'], { env });
    expect(done.code, done.stderr).toBe(0);
    expect(done.stdout).toContain('Adapter: ');
    expect(done.stdout).toContain('Trained 2 of 2 examples');
    const dataDir = env['ARCHITECT_USER_DATA'] ?? '';
    const adapter = join(dataDir, 'training', 'jobs', record.id, 'artifacts', 'adapter.gguf');
    expect(existsSync(adapter)).toBe(true);
    expect(existsSync(join(dataDir, 'training', 'jobs', record.id, 'artifacts', 'train.log'))).toBe(
      true,
    );

    const cancelled = await cli(['train', 'cancel', record.id, '--json'], { env });
    expect(cancelled.code, cancelled.stderr).toBe(0);
    expect(JSON.parse(cancelled.stdout)).toMatchObject({ state: 'ready' });
  });

  it('says what stands in the way: no token, no demonstrations, an unknown job', async () => {
    const exported = await fieldExport([demonstration('att_1')]);
    const tokenless = await testEnv({ HF_ENDPOINT: hub.url });
    const noToken = await cli(['train', 'start', '--export', exported, '--max-usd', '5'], {
      env: tokenless,
    });
    expect(noToken.code).toBe(3);
    expect(noToken.stderr).toContain('no Hugging Face token');

    const env = await testEnv({ HF_ENDPOINT: hub.url, HF_TOKEN: FAKE_HUB_TOKEN });
    const empty = await cli(
      ['train', 'start', '--export', await fieldExport([]), '--max-usd', '5'],
      { env },
    );
    expect(empty.code).toBe(2);
    expect(empty.stderr).toContain(
      'has no demonstrations to train on: its data may not leave this computer',
    );

    const unknown = await cli(['train', 'status', 'trn_nothing'], { env });
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('There is no training job trn_nothing here.');
    expect(hub.jobs.size).toBe(0);
  });
});
