import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelConfig, TrainingPlan } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  fetchModelConfig,
  GB,
  NF4_BYTES,
  planTraining,
  sizeModel,
  SizingError,
  type TrainingPlanInput,
} from '../src/training-plan';
import { HubClient } from '../src/hub';
import { FAKE_HUB_TOKEN, startFakeHub } from './support/fake-hub';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'model-configs');
const fixture = (name: string): ModelConfig =>
  JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf8')) as ModelConfig;

const H100 = { name: 'h100-80gb', memoryGb: 80 };
const input = (overrides: Partial<TrainingPlanInput> = {}): TrainingPlanInput => ({
  method: 'lora',
  precision: 'bf16',
  gpu: H100,
  seqLen: 4096,
  microBatch: 1,
  gpusPerNode: 8,
  loraRank: 16,
  ...overrides,
});
const term = (plan: TrainingPlan, key: string) => {
  const found = plan.terms.find((entry) => entry.key === key);
  if (!found) throw new Error(`no ${key} term`);
  return found;
};

describe('sizing a model from its config.json', () => {
  it('counts a small dense model with tied embeddings exactly', () => {
    const size = sizeModel(fixture('small-1b'));
    // 16 layers × (attention 10,485,760 + MLP 50,331,648 + norms 4,096) + embeddings + final norm.
    expect(size.totalParams).toBe(16 * 60_821_504 + 128_256 * 2048 + 2048);
    expect(size.activeParams).toBe(size.totalParams);
    expect(size.experts).toBe(0);
    expect(size.moePattern).toBe('dense: no experts');
    expect(size.largestUnit.name).toBe('the embedding table');
  });

  it('counts a dense model of about 32B with its own output head', () => {
    const size = sizeModel(fixture('dense-32b'));
    expect(size.totalParams / 1e9).toBeCloseTo(32.76, 1);
    expect(size.largestUnit.name).toBe('the embedding table');
  });

  it('counts every expert of a mixture as resident, and only top-k as active', () => {
    const size = sizeModel(fixture('moe-235b'));
    // Per layer: attention 71,303,168 + 128 experts × 18,874,368 + router 524,288 + norms 8,192.
    expect(size.totalParams).toBe(94 * 2_487_754_752 + 2 * 151_936 * 4096 + 4096);
    expect(size.activeParams / 1e9).toBeCloseTo(22.19, 1);
    expect(size.moeLayers).toBe(94);
    expect(size.experts).toBe(128);
    expect(size.expertsPerToken).toBe(8);
    expect(size.largestUnit).toEqual({
      name: 'one expert layer (attention, all 128 experts and the router)',
      params: 2_487_754_752,
    });
  });

  it('reads latent attention, shared experts and leading dense layers', () => {
    const size = sizeModel({
      model_type: 'deepseek_v3',
      hidden_size: 7168,
      intermediate_size: 18432,
      moe_intermediate_size: 2048,
      num_hidden_layers: 61,
      num_attention_heads: 128,
      num_key_value_heads: 128,
      q_lora_rank: 1536,
      kv_lora_rank: 512,
      qk_nope_head_dim: 128,
      qk_rope_head_dim: 64,
      v_head_dim: 128,
      n_routed_experts: 256,
      n_shared_experts: 1,
      num_experts_per_tok: 8,
      first_k_dense_replace: 3,
      moe_layer_freq: 1,
      vocab_size: 129280,
      tie_word_embeddings: false,
    });
    expect(size.moeLayers).toBe(58);
    expect(size.moePattern).toContain('first 3 dense');
    // The published total is 671B without its multi-token prediction module.
    expect(size.totalParams / 1e9).toBeGreaterThan(665);
    expect(size.totalParams / 1e9).toBeLessThan(677);
    expect(size.largestUnit.name).toContain('the shared expert');
  });

  it("counts a multimodal model by its text decoder and says the tower isn't counted", () => {
    const size = sizeModel({ model_type: 'llava', text_config: fixture('small-1b') });
    expect(size.totalParams).toBe(sizeModel(fixture('small-1b')).totalParams);
    expect(size.notes.join(' ')).toContain('vision or audio tower');
  });

  it("says plainly when a config can't be sized", () => {
    expect(() => sizeModel({ model_type: 'llama', hidden_size: 4096 })).toThrow(
      /doesn't say its layer count/,
    );
    expect(() => sizeModel({ ...fixture('small-1b'), model_type: 'mamba' })).toThrow(SizingError);
    expect(() =>
      sizeModel({ ...fixture('small-1b'), layer_types: ['linear_attention', 'full_attention'] }),
    ).toThrow(/linear_attention/);
    expect(() => sizeModel({ ...fixture('small-1b'), hidden_size: '2048' })).toThrow(/not a count/);
    expect(() => sizeModel({ ...fixture('moe-235b'), num_experts_per_tok: null })).toThrow(
      /experts per token/,
    );
  });
});

describe('planning the GPUs a training job needs', () => {
  it('shows every term with its arithmetic, and labels the plan an estimate', () => {
    const plan = planTraining(fixture('moe-235b'), input({ method: 'qlora' }));
    expect(plan.label).toBe('estimate');
    expect(plan.terms.map((entry) => entry.key)).toEqual([
      'weights',
      'adapter',
      'adapter_gradients',
      'adapter_optimizer',
      'activations',
      'fsdp_peak',
      'runtime',
    ]);
    for (const entry of plan.terms) expect(entry.arithmetic).toMatch(/\d/);
    expect(plan.wording).toContain(
      'GPU execution, large-model compatibility and training gains remain unverified',
    );
  });

  it('keeps every expert resident under LoRA: the weights are the total, not the active count', () => {
    const size = sizeModel(fixture('moe-235b'));
    const plan = planTraining(fixture('moe-235b'), input());
    expect(term(plan, 'weights').bytes).toBe(size.totalParams * 2);
    expect(term(plan, 'weights').bytes).toBeGreaterThan(size.activeParams * 2 * 10);
    const adapter = size.loraParamsPerRank * 16;
    expect(term(plan, 'adapter').bytes).toBe(adapter * 4);
    expect(term(plan, 'adapter_gradients').bytes).toBe(adapter * 4);
    expect(term(plan, 'adapter_optimizer').bytes).toBe(adapter * 8);
    // FSDP gathers one whole expert layer, every expert in it, and prefetches the next.
    expect(term(plan, 'fsdp_peak').bytes).toBe(2_487_754_752 * 2 * 2);
    expect(term(plan, 'fsdp_peak').sharded).toBe(false);
  });

  it('stores QLoRA weights in 4 bits and gathers the unit in 4 bits too', () => {
    const size = sizeModel(fixture('moe-235b'));
    const plan = planTraining(fixture('moe-235b'), input({ method: 'qlora' }));
    const other = size.totalParams - size.linearParams;
    expect(term(plan, 'weights').bytes).toBeCloseTo(size.linearParams * NF4_BYTES + other * 2, 0);
    expect(term(plan, 'fsdp_peak').bytes).toBeCloseTo(2_487_754_752 * NF4_BYTES * 2, 0);
  });

  it('adds gradients and Adam state for every parameter in a full fine-tune', () => {
    const size = sizeModel(fixture('dense-32b'));
    const plan = planTraining(fixture('dense-32b'), input({ method: 'full' }));
    expect(term(plan, 'gradients').bytes).toBe(size.totalParams * 2);
    expect(term(plan, 'optimizer').bytes).toBe(size.totalParams * 12);
    expect(plan.terms.some((entry) => entry.key === 'adapter')).toBe(false);
    // 16 bytes a parameter over ~32.8B is about 524 GB sharded: one node of eight 80 GB GPUs is
    // not enough, so it takes two.
    expect(plan.fit).toMatchObject({ nodes: 2, gpus: 16, gpusPerNode: 8 });
  });

  it('works out the smallest count from sharded and per-GPU terms', () => {
    const plan = planTraining(fixture('moe-235b'), input());
    const fit = plan.fit;
    if (!fit) throw new Error('expected a fit');
    const usable = 80 * GB * 0.9;
    expect(fit.perGpuBytes).toBeLessThanOrEqual(usable);
    // One GPU fewer would not fit.
    const fewer = fit.gpus - (fit.nodes === 1 ? 1 : fit.gpusPerNode);
    if (fewer > 0)
      expect(plan.shardedBytes / fewer + plan.perGpuFixedBytes).toBeGreaterThan(usable);
    expect(fit.gpus).toBe(fit.nodes * fit.gpusPerNode);
  });

  it('fits a small model on one GPU and keeps a partial node partial', () => {
    const plan = planTraining(fixture('small-1b'), input({ gpu: { name: 'l40s', memoryGb: 48 } }));
    expect(plan.fit).toMatchObject({ gpus: 1, nodes: 1 });
  });

  it("says why when no count fits: what each GPU holds whole doesn't shrink", () => {
    const plan = planTraining(
      fixture('moe-235b'),
      input({ gpu: { name: 'a100-40gb', memoryGb: 40 }, seqLen: 131072, microBatch: 4 }),
    );
    expect(plan.fit).toBeNull();
    expect(plan.reason).toMatch(/whatever the count/);
  });
});

describe("reading a model's config.json from the Hub", () => {
  it('resolves the revision to a commit and reads the config at it', async () => {
    const hub = await startFakeHub();
    try {
      hub.repos.set('lab/moe', { private: false, commits: [] });
      const commit = hub.commit('lab/moe', {
        'config.json': Buffer.from(JSON.stringify(fixture('moe-235b'))),
      });
      const client = new HubClient({ endpoint: hub.url, token: async () => FAKE_HUB_TOKEN });
      const { config, revision } = await fetchModelConfig(client, 'lab/moe', 'main');
      expect(revision).toBe(commit);
      expect(sizeModel(config).experts).toBe(128);
    } finally {
      await hub.close();
    }
  });
});
