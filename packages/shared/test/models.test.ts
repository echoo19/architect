import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  costUsd,
  FREE_PRICING,
  fitsOnGpu,
  GLIMMER_BUILDS,
  glimmerBuild,
  gpuFit,
  JobSchema,
  looksLikeChatModel,
  MentorConfigSchema,
  mentorPreset,
  mentorPricing,
  openAiTakesReasoningEffort,
  PROVIDERS,
  ratesFor,
  readsReasoningStrengthLine,
  recommendedBuild,
  studentPricing,
  TokenPricingSchema,
  type GpuInfo,
  type TokenPricing,
} from '../src';

const TIERED: TokenPricing = {
  inputPerM: 0.1,
  cachedInputPerM: 0.01,
  outputPerM: 0.5,
  longContext: {
    aboveInputTokens: 100_000,
    inputPerM: 0.5,
    cachedInputPerM: 0.05,
    outputPerM: 2.5,
  },
};

describe('costUsd', () => {
  it('bills a call at the base rates up to the long-prompt threshold', () => {
    expect(costUsd(TIERED, { inputTokens: 100_000, outputTokens: 1000 })).toBeCloseTo(
      (100_000 * 0.1 + 1000 * 0.5) / 1e6,
      12,
    );
  });

  it('bills every token of a longer call at the long-prompt rates', () => {
    expect(
      costUsd(TIERED, { inputTokens: 100_001, outputTokens: 1000, cachedInputTokens: 1 }),
    ).toBeCloseTo((100_000 * 0.5 + 1 * 0.05 + 1000 * 2.5) / 1e6, 12);
    expect(ratesFor(TIERED, 100_001)).toBe(TIERED.longContext);
  });

  it('knows no long-prompt rates where a price has none', () => {
    const flat = mentorPreset('meta-spark').pricing;
    expect(ratesFor(flat, 5_000_000)).toBe(flat);
  });
});

describe('what a mentor costs', () => {
  const base = { baseUrl: 'https://api.example.com/v1', model: 'model-x' };

  it('is the price saved with it before any preset', () => {
    const saved = { inputPerM: 9, cachedInputPerM: 9, outputPerM: 9 };
    expect(
      mentorPricing({ ...base, provider: 'meta', model: 'muse-spark-1.3', pricing: saved }),
    ).toBe(saved);
  });

  it("is the preset's price for a preset's provider and model", () => {
    const { provider, baseUrl, model, pricing } = mentorPreset('anthropic-haiku');
    expect(mentorPricing({ provider, baseUrl, model })).toBe(pricing);
    expect(mentorPricing({ provider: 'openrouter', baseUrl, model })).toBeUndefined();
  });

  it('is free on this computer, and unknown anywhere else without a price', () => {
    expect(
      mentorPricing({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'granite' }),
    ).toBe(FREE_PRICING);
    expect(mentorPricing({ ...base, provider: 'other' })).toBeUndefined();
    expect(
      mentorPricing({ provider: 'other', baseUrl: 'http://192.168.1.20:8000/v1', model: 'm' }),
    ).toBeUndefined();
  });
});

describe('what a student endpoint costs', () => {
  it('is free on this computer, the saved price, or the preset price', () => {
    expect(studentPricing({ baseUrl: 'http://127.0.0.1:1234/v1', model: 'qwen' })).toBe(
      FREE_PRICING,
    );
    const saved = { inputPerM: 1, cachedInputPerM: 1, outputPerM: 1 };
    expect(
      studentPricing({ baseUrl: 'https://openrouter.ai/api/v1', model: 'x/y', pricing: saved }),
    ).toBe(saved);
    expect(
      studentPricing({ baseUrl: 'https://openrouter.ai/api/v1', model: 'meta/muse-glimmer-30b' }),
    ).toMatchObject({ inputPerM: 0.3 });
    expect(studentPricing({ baseUrl: 'https://api.groq.com/openai/v1', model: 'x' })).toBe(
      undefined,
    );
  });
});

describe('model families', () => {
  it('sends reasoning effort only to OpenAI models that reason', () => {
    for (const model of ['gpt-6-luna', 'gpt-6.1-sol', 'gpt-5.4-nano', 'o4-mini', 'o3']) {
      expect(openAiTakesReasoningEffort(model), model).toBe(true);
    }
    for (const model of ['gpt-4.1', 'gpt-4o-mini', 'gpt-5-chat-latest', 'gpt-3.5-turbo']) {
      expect(openAiTakesReasoningEffort(model), model).toBe(false);
    }
  });

  it('gives Glimmer, and only Glimmer, its reasoning-strength line', () => {
    expect(readsReasoningStrengthLine('muse-glimmer:30b')).toBe(true);
    expect(readsReasoningStrengthLine('meta-models/Muse-Glimmer-30B')).toBe(true);
    expect(readsReasoningStrengthLine('granite4.2:8b')).toBe(false);
  });

  it('keeps chat models and leaves out image, speech and embedding ones', () => {
    for (const id of ['gpt-6-luna', 'claude-haiku-5-5', 'gemini-3.5-flash-lite', 'qwen3:8b']) {
      expect(looksLikeChatModel(id), id).toBe(true);
    }
    for (const id of [
      'text-embedding-3-large',
      'gpt-image-2',
      'gpt-realtime-2',
      'gemini-3.8-flash-tts',
      'gemini-3.8-live',
      'whisper-1',
      'meta-llama/llama-guard-4-12b',
    ]) {
      expect(looksLikeChatModel(id), id).toBe(false);
    }
  });

  it('names every provider and gives each one with a key a page to make it', () => {
    for (const [id, provider] of Object.entries(PROVIDERS)) {
      expect(provider.label, id).not.toBe('');
      if (provider.secretRef) expect(provider.page, id).toMatch(/^https:\/\//);
    }
  });
});

describe('running on the GPU', () => {
  const MiB = 1024 * 1024;
  const card = (gib: number): GpuInfo => ({
    name: 'card',
    memoryBytes: gib * 1024 * MiB,
    shared: false,
  });
  const rtx4070ti: GpuInfo = {
    name: 'NVIDIA GeForce RTX 4070 Ti',
    memoryBytes: 12_282 * MiB,
    shared: false,
  };

  it("recommends the 2-bit build for a 12 GB card, where the 4-bit one doesn't fit", () => {
    expect(recommendedBuild(rtx4070ti).key).toBe('glimmer-gpu');
    expect(gpuFit({ id: 'muse-glimmer:30b-iq2', sizeBytes: 10_746_373_364 }, rtx4070ti)).toBe(
      'full',
    );
    expect(gpuFit({ id: 'muse-glimmer:30b', sizeBytes: 18_157_010_252 }, rtx4070ti)).toBe(
      'partial',
    );
  });

  it('recommends the 4-bit build where it fits, and where the GPU is unknown or too small', () => {
    expect(recommendedBuild(card(24)).key).toBe('glimmer-4bit');
    expect(recommendedBuild(null).key).toBe('glimmer-4bit');
    expect(recommendedBuild(card(8)).key).toBe('glimmer-4bit');
    expect(recommendedBuild(card(16)).key).toBe('glimmer-gpu');
  });

  it("estimates other models from their size, and trusts Ollama's own figures for a loaded one", () => {
    expect(gpuFit({ id: 'granite4.2:8b', sizeBytes: 5_300_000_000 }, rtx4070ti)).toBe('full');
    expect(gpuFit({ id: 'big:70b', sizeBytes: 40e9 }, rtx4070ti)).toBe('partial');
    expect(gpuFit({ id: 'granite4.2:8b', sizeBytes: 5_300_000_000 }, null)).toBe('unknown');
    expect(
      gpuFit({ id: 'muse-glimmer:30b', inMemory: { totalBytes: 21e9, gpuBytes: 11e9 } }, null),
    ).toBe('partial');
    expect(gpuFit({ id: 'x', inMemory: { totalBytes: 9e9, gpuBytes: 9e9 } }, rtx4070ti)).toBe(
      'full',
    );
  });

  it('keeps room for the display and driver on the card', () => {
    expect(fitsOnGpu(card(12).memoryBytes, card(12))).toBe(false);
    expect(fitsOnGpu(card(12).memoryBytes - 1e9, card(12))).toBe(true);
  });

  it('lists the 4-bit build first, then the one sized for a 12 GB GPU', () => {
    expect(GLIMMER_BUILDS.map((build) => build.model)).toEqual([
      'muse-glimmer:30b',
      'muse-glimmer:30b-iq2',
    ]);
    expect(glimmerBuild('glimmer-gpu').source).toMatchObject({
      kind: 'gguf',
      renderer: 'glimmer',
      parser: 'glimmer',
    });
  });
});

describe('files from before any provider could be chosen', () => {
  it('still parse: the shipped sample job and an old custom mentor', () => {
    const sample = fileURLToPath(
      new URL('../../../examples/home-services/job/job.json', import.meta.url),
    );
    const job = JobSchema.parse(JSON.parse(readFileSync(sample, 'utf8')));
    expect(job.mentor).toMatchObject({ kind: 'model', provider: 'meta', secretRef: 'meta' });

    expect(
      MentorConfigSchema.parse({
        kind: 'model',
        provider: 'other',
        label: 'House mentor',
        baseUrl: 'https://llm.example.com/v1',
        model: 'house-model',
        secretRef: 'meta',
      }),
    ).toMatchObject({ provider: 'other', reasoningEffort: 'medium' });
  });

  it('take a saved price that the cap can use, and refuse a negative one', () => {
    expect(TokenPricingSchema.safeParse(TIERED).success).toBe(true);
    expect(
      TokenPricingSchema.safeParse({ inputPerM: -1, cachedInputPerM: 0, outputPerM: 0 }).success,
    ).toBe(false);
    expect(
      MentorConfigSchema.parse({
        kind: 'model',
        provider: 'ollama',
        label: 'Granite',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'granite4.2:8b',
      }),
    ).not.toHaveProperty('secretRef');
  });
});
