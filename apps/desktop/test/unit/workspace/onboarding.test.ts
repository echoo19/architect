import {
  ConnectionTestSchema,
  GLIMMER_BUILDS,
  MENTOR_PRESETS,
  mentorPreset,
  type MentorConfig,
  type ProviderId,
  type PullProgress,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { mentorFromPreset, presetFor, routeOf } from '../../../src/renderer/src/onboarding/mentor';
import { sizeWord, tradeoff } from '../../../src/renderer/src/onboarding/builds';
import {
  idlePull,
  pullBytes,
  pullPercent,
  pullReducer,
  pullStage,
  type PullAction,
} from '../../../src/renderer/src/onboarding/pull';

const GB = 1024 ** 3;

const progress = (patch: Partial<PullProgress>): PullAction => ({
  type: 'progress',
  progress: { model: 'muse-glimmer:30b', status: 'pulling 8a9b', done: false, ...patch },
});

describe('pullReducer', () => {
  it('tracks a download from start to finish', () => {
    let state = pullReducer(idlePull, { type: 'start' });
    expect(pullStage(state)).toBe('Starting the download');
    state = pullReducer(state, progress({ status: 'pulling manifest' }));
    expect(pullPercent(state)).toBeNull();
    state = pullReducer(state, progress({ completedBytes: 4.2 * GB, totalBytes: 18 * GB }));
    expect(pullStage(state)).toBe('Downloading');
    expect(pullPercent(state)).toBe(23);
    expect(pullBytes(state)).toBe('4.2 GB of 18 GB');
    state = pullReducer(state, progress({ status: 'verifying sha256 digest' }));
    expect(pullStage(state)).toBe('Checking the download');
    state = pullReducer(state, progress({ status: 'success', done: true }));
    expect(state).toEqual({ phase: 'done' });
  });

  it('reports a failure and ignores progress that arrives after the end', () => {
    const failed = pullReducer(idlePull, progress({ error: 'Disk full.' }));
    expect(failed).toEqual({ phase: 'failed', error: 'Disk full.' });
    expect(pullReducer(failed, progress({ completedBytes: 1 }))).toBe(failed);
    expect(pullReducer(failed, { type: 'finished' })).toBe(failed);
    const done = pullReducer(idlePull, { type: 'finished' });
    expect(pullReducer(done, progress({ completedBytes: 1 }))).toBe(done);
  });

  it('says so while the GPU-sized build is made from its download', () => {
    const state = pullReducer(idlePull, progress({ status: 'Preparing it for your GPU' }));
    expect(pullStage(state)).toBe('Preparing it for your GPU');
    expect(pullPercent(state)).toBeNull();
  });

  it('starts over when tried again', () => {
    const failed = pullReducer(idlePull, { type: 'failed', error: 'Ollama stopped.' });
    expect(pullReducer(failed, { type: 'start' })).toEqual({ phase: 'starting' });
  });
});

describe('mentor presets', () => {
  it('finds the preset a saved mentor came from', () => {
    const contributor = mentorPreset('meta-spark-contributor');
    const config = mentorFromPreset(contributor, {
      kind: 'model',
      provider: 'meta',
      label: 'Muse Spark 1.3',
      baseUrl: contributor.baseUrl,
      model: 'muse-spark-1.3',
      reasoningEffort: 'high',
      secretRef: 'meta',
    });
    expect(config).toMatchObject({
      provider: 'meta',
      model: 'muse-spark-1.3-contributor',
      reasoningEffort: 'high',
      secretRef: 'meta',
    });
    expect(presetFor(config)?.key).toBe('meta-spark-contributor');
    expect(presetFor({ kind: 'coding_agent', agent: 'claude_code', label: 'Claude Code' })).toBe(
      undefined,
    );
  });

  it('stores each provider key under its own name', () => {
    const refs = MENTOR_PRESETS.map((preset) =>
      mentorFromPreset(preset, { kind: 'coding_agent', agent: 'claude_code', label: 'x' }),
    ).map((config) => (config.kind === 'model' ? config.secretRef : ''));
    expect(refs).toEqual(MENTOR_PRESETS.map((preset) => preset.provider));
    expect(new Set(refs)).toEqual(
      new Set(['meta', 'openai', 'anthropic', 'gemini', 'baseten', 'modal']),
    );
  });

  it('knows which way of setup a saved mentor came in', () => {
    const model = (provider: ProviderId, baseUrl: string): MentorConfig => ({
      kind: 'model',
      provider,
      label: 'Mentor',
      baseUrl,
      model: 'm',
      reasoningEffort: 'medium',
    });
    expect(routeOf(mentorFromPreset(mentorPreset('meta-spark'), model('meta', 'x')))).toBe('meta');
    expect(routeOf({ kind: 'coding_agent', agent: 'claude_code', label: 'Claude Code' })).toBe(
      'meta',
    );
    expect(routeOf(model('openrouter', 'https://openrouter.ai/api/v1'))).toBe('openrouter');
    expect(routeOf(model('anthropic', 'https://api.anthropic.com/v1'))).toBe('key');
    expect(routeOf(model('other', 'https://api.example.com/v1'))).toBe('key');
    expect(routeOf(model('ollama', 'http://127.0.0.1:11434'))).toBe('local');
    expect(routeOf(model('lmstudio', 'http://127.0.0.1:1234/v1'))).toBe('local');
    expect(routeOf(model('other', 'http://localhost:8000/v1'))).toBe('local');
  });

  it('reads connection test replies', () => {
    expect(
      ConnectionTestSchema.parse({ ok: true, latencyMs: 640, detail: 'muse-spark-1.3' }),
    ).toEqual({ ok: true, latencyMs: 640, detail: 'muse-spark-1.3' });
    expect(
      ConnectionTestSchema.parse({ ok: false, error: 'The key was refused.', hint: 'Check it.' }),
    ).toMatchObject({ ok: false, hint: 'Check it.' });
    expect(ConnectionTestSchema.safeParse({ ok: true }).success).toBe(false);
  });
});

describe("Glimmer's builds, named next to the one recommended", () => {
  it('calls the recommended build Recommended, and the other Smaller or Larger', () => {
    const [fourBit, gpu] = GLIMMER_BUILDS;
    if (!fourBit || !gpu) throw new Error('Glimmer has two builds.');
    expect(sizeWord(fourBit, fourBit)).toBe('Recommended');
    expect(sizeWord(gpu, fourBit)).toBe('Smaller');
    // On a graphics card that holds only the smaller one, the larger one is the other choice.
    expect(sizeWord(gpu, gpu)).toBe('Recommended');
    expect(sizeWord(fourBit, gpu)).toBe('Larger');
  });

  it('says what each build gives and gives up', () => {
    const [fourBit, gpu] = GLIMMER_BUILDS;
    if (!fourBit || !gpu) throw new Error('Glimmer has two builds.');
    expect(tradeoff(fourBit)).toBe('Most accurate');
    expect(tradeoff(gpu)).toBe('Lighter, but less accurate');
  });
});
