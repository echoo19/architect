import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppSettingsPatchSchema } from '@architect/shared';
import { defaultSettings } from '../../../src/main/settings/schema';
import { SettingsStore } from '../../../src/main/settings/store';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'architect-settings-'));
  file = join(dir, 'settings.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('default settings', () => {
  it('use the meta-spark mentor, the default student and the system theme', () => {
    expect(defaultSettings()).toEqual({
      theme: 'system',
      steps: 'collapsed',
      comparisonMode: false,
      quietLocalModels: false,
      onboarded: false,
      defaultMentor: {
        kind: 'model',
        provider: 'meta',
        label: 'Muse Spark 1.3',
        baseUrl: 'https://api.meta.ai/v1',
        model: 'muse-spark-1.3',
        reasoningEffort: 'medium',
        secretRef: 'meta',
      },
      defaultStudent: {
        runtime: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'muse-glimmer:30b',
        contextLength: 16_384,
      },
      customEndpoints: [],
    });
  });
});

describe('SettingsStore', () => {
  it('starts from defaults when there is no file', async () => {
    const store = await SettingsStore.open(file);
    expect(store.get()).toEqual(defaultSettings());
  });

  it('persists updates and notifies listeners', async () => {
    const store = await SettingsStore.open(file);
    const listener = vi.fn();
    store.onChange(listener);
    const next = await store.update({ theme: 'dark', onboarded: true });
    expect(next).toMatchObject({ theme: 'dark', onboarded: true });
    expect(listener).toHaveBeenCalledWith(next);

    const reopened = await SettingsStore.open(file);
    expect(reopened.get()).toEqual(next);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(next);
  });

  it('applies quick successive updates in order', async () => {
    const store = await SettingsStore.open(file);
    await Promise.all([store.update({ theme: 'dark' }), store.update({ steps: 'expanded' })]);
    expect((await SettingsStore.open(file)).get()).toMatchObject({
      theme: 'dark',
      steps: 'expanded',
    });
  });

  it('keeps valid fields and resets invalid ones from an older file', async () => {
    await writeFile(
      file,
      JSON.stringify({ theme: 'sepia', steps: 'expanded', defaultMentor: { kind: 'robot' } }),
    );
    const store = await SettingsStore.open(file);
    expect(store.get()).toEqual({
      ...defaultSettings(),
      steps: 'expanded',
    });
  });

  it('reads a file from before endpoints could be added, and keeps the good ones of a damaged list', async () => {
    const old = { ...defaultSettings(), theme: 'dark', onboarded: true } as Record<string, unknown>;
    delete old['customEndpoints'];
    await writeFile(file, JSON.stringify(old));
    expect((await SettingsStore.open(file)).get()).toEqual({
      ...defaultSettings(),
      theme: 'dark',
      onboarded: true,
    });

    const good = { baseUrl: 'https://llm.example.com/v1', label: 'llm.example.com' };
    await writeFile(
      file,
      JSON.stringify({ customEndpoints: [good, { baseUrl: 'not a url', label: 'x' }, 7] }),
    );
    expect((await SettingsStore.open(file)).get().customEndpoints).toEqual([good]);
  });

  it('starts from defaults when the file is not JSON', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(file, '{ not json');
    const store = await SettingsStore.open(file);
    expect(store.get()).toEqual(defaultSettings());
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('returns copies, so callers cannot change the stored settings', async () => {
    const store = await SettingsStore.open(file);
    const settings = store.get();
    settings.theme = 'light';
    expect(store.get().theme).toBe('system');
  });
});

describe('settings patches', () => {
  it('accept any subset of fields', () => {
    expect(AppSettingsPatchSchema.parse({ comparisonMode: true })).toEqual({
      comparisonMode: true,
    });
  });

  it('reject unknown fields and bad values', () => {
    expect(AppSettingsPatchSchema.safeParse({ fontSize: 14 }).success).toBe(false);
    expect(AppSettingsPatchSchema.safeParse({ theme: 'sepia' }).success).toBe(false);
  });

  it('never name the program Architect runs: only a file the user picks becomes llama-server', () => {
    expect(
      AppSettingsPatchSchema.safeParse({ llamaServerPath: 'C:\\Temp\\anything.exe' }).success,
    ).toBe(false);
  });
});
