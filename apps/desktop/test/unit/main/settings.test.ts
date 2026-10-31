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
  it('use the meta-spark mentor and the default student', () => {
    expect(defaultSettings()).toEqual({
      edition: 'personal',
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
    const next = await store.update({ steps: 'expanded', onboarded: true });
    expect(next).toMatchObject({ steps: 'expanded', onboarded: true });
    expect(listener).toHaveBeenCalledWith(next);

    const reopened = await SettingsStore.open(file);
    expect(reopened.get()).toEqual(next);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(next);
  });

  it('applies quick successive updates in order', async () => {
    const store = await SettingsStore.open(file);
    await Promise.all([
      store.update({ comparisonMode: true }),
      store.update({ steps: 'expanded' }),
    ]);
    expect((await SettingsStore.open(file)).get()).toMatchObject({
      comparisonMode: true,
      steps: 'expanded',
    });
  });

  it('keeps valid fields and resets invalid ones from an older file', async () => {
    await writeFile(
      file,
      JSON.stringify({ steps: 'sepia', quietLocalModels: true, defaultMentor: { kind: 'robot' } }),
    );
    const store = await SettingsStore.open(file);
    expect(store.get()).toEqual({
      ...defaultSettings(),
      quietLocalModels: true,
    });
  });

  it('keeps a closed network, and fails closed on a damaged one, saying so until it is saved', async () => {
    const store = await SettingsStore.open(file);
    await store.update({ closedNetwork: { on: true, hosts: ['spark.lab.internal'] } });
    expect((await SettingsStore.open(file)).get().closedNetwork).toEqual({
      on: true,
      hosts: ['spark.lab.internal'],
    });

    // A switch that isn't one and a host that isn't one: on, with the host that reads.
    await writeFile(
      file,
      JSON.stringify({
        onboarded: true,
        closedNetwork: { on: 'yes', hosts: ['spark.lab.internal', 'https://bad/v1'] },
      }),
    );
    const damaged = await SettingsStore.open(file);
    expect(damaged.get()).toMatchObject({
      onboarded: true,
      closedNetwork: { on: true, hosts: ['spark.lab.internal'] },
    });
    expect(damaged.get().closedNetworkProblem).toContain(
      "couldn't be read in full (whether it is on, 1 host), so it stays on with spark.lab.internal",
    );
    // Another change keeps the problem in view and never writes it to the file.
    await damaged.update({ steps: 'expanded' });
    expect(damaged.get().closedNetworkProblem).toBeDefined();
    expect(JSON.parse(await readFile(file, 'utf8'))).not.toHaveProperty('closedNetworkProblem');
    // Saving the network is the answer to it.
    await damaged.update({ closedNetwork: { on: true, hosts: ['spark.lab.internal'] } });
    expect(damaged.get().closedNetworkProblem).toBeUndefined();

    // More hosts than a network may name: on, with the first fifty.
    const many = Array.from({ length: 60 }, (_, index) => `node-${index}.lab.internal`);
    await writeFile(file, JSON.stringify({ closedNetwork: { on: false, hosts: many } }));
    const crowded = (await SettingsStore.open(file)).get();
    expect(crowded.closedNetwork?.on).toBe(true);
    expect(crowded.closedNetwork?.hosts).toHaveLength(50);
  });

  it('fails closed on a file that is not JSON but held a closed network, and only then', async () => {
    await writeFile(file, '{"onboarded": true, "closedNetwork": {"on": true, "hosts": ["spark');
    const broken = (await SettingsStore.open(file)).get();
    expect(broken.closedNetwork).toEqual({ on: true, hosts: [] });
    expect(broken.closedNetworkProblem).toContain('the settings file could not be read');
    await writeFile(file, '{"onboarded": tru');
    expect((await SettingsStore.open(file)).get()).toEqual(defaultSettings());
  });

  it('never takes the problem from the renderer', () => {
    expect(AppSettingsPatchSchema.safeParse({ closedNetworkProblem: 'none' }).success).toBe(false);
  });

  it('reads past a theme that an earlier version stored, and never writes it back', async () => {
    for (const theme of ['dark', 'light', 'system', 'sepia']) {
      await writeFile(file, JSON.stringify({ theme, onboarded: true, steps: 'expanded' }));
      const store = await SettingsStore.open(file);
      expect(store.get()).toEqual({ ...defaultSettings(), onboarded: true, steps: 'expanded' });
      expect(store.get()).not.toHaveProperty('theme');
      await store.update({ comparisonMode: true });
      expect(JSON.parse(await readFile(file, 'utf8'))).not.toHaveProperty('theme');
    }
  });

  it('reads a file from before endpoints could be added, and keeps the good ones of a damaged list', async () => {
    const old = { ...defaultSettings(), onboarded: true } as Record<string, unknown>;
    delete old['customEndpoints'];
    await writeFile(file, JSON.stringify(old));
    expect((await SettingsStore.open(file)).get()).toEqual({
      ...defaultSettings(),
      onboarded: true,
    });

    const good = { baseUrl: 'https://llm.example.com/v1', label: 'llm.example.com' };
    await writeFile(
      file,
      JSON.stringify({ customEndpoints: [good, { baseUrl: 'not a url', label: 'x' }, 7] }),
    );
    expect((await SettingsStore.open(file)).get().customEndpoints).toEqual([good]);
  });

  it('keeps the recorded field exports across a restart, reading past a damaged one', async () => {
    const good = {
      jobId: 'job_a',
      name: 'Academy desk',
      dir: join(dir, 'exports', 'academy-desk'),
      at: '2026-11-01T09:00:00.000Z',
    };
    await writeFile(file, JSON.stringify({ fieldExports: [good, { jobId: 'job_b' }, 'x'] }));
    expect((await SettingsStore.open(file)).get().fieldExports).toEqual([good]);

    await writeFile(file, JSON.stringify({ fieldExports: 'not a list' }));
    expect((await SettingsStore.open(file)).get().fieldExports).toBeUndefined();
  });

  it('reads an install from before the Lab as the personal edition, and keeps a chosen one', async () => {
    await writeFile(file, JSON.stringify({ onboarded: true, steps: 'expanded' }));
    expect((await SettingsStore.open(file)).get().edition).toBe('personal');

    await writeFile(file, JSON.stringify({ edition: 'workshop', onboarded: true }));
    expect((await SettingsStore.open(file)).get().edition).toBe('personal');

    const store = await SettingsStore.open(file);
    await store.update({ edition: 'lab' });
    expect((await SettingsStore.open(file)).get().edition).toBe('lab');
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
    settings.steps = 'expanded';
    expect(store.get().steps).toBe('collapsed');
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
    expect(AppSettingsPatchSchema.safeParse({ steps: 'sepia' }).success).toBe(false);
    expect(AppSettingsPatchSchema.safeParse({ edition: 'studio' }).success).toBe(false);
  });

  it('no longer take a theme: Architect is always dark', () => {
    expect(AppSettingsPatchSchema.safeParse({ theme: 'light' }).success).toBe(false);
  });

  it('never name the program Architect runs: only a file the user picks becomes llama-server', () => {
    expect(
      AppSettingsPatchSchema.safeParse({ llamaServerPath: 'C:\\Temp\\anything.exe' }).success,
    ).toBe(false);
  });

  it('name the hosts of a closed network, each a host and no more', () => {
    expect(
      AppSettingsPatchSchema.parse({
        closedNetwork: { on: true, hosts: [' Spark.Lab.Internal '] },
      }),
    ).toEqual({ closedNetwork: { on: true, hosts: ['spark.lab.internal'] } });
    expect(
      AppSettingsPatchSchema.safeParse({
        closedNetwork: { on: true, hosts: ['https://spark.lab.internal/v1'] },
      }).success,
    ).toBe(false);
  });

  it('never record a field export: only the main process does, as it writes one', () => {
    const record = { jobId: 'j', name: 'n', dir: 'C:\\x', at: '2026-11-01T09:00:00.000Z' };
    expect(AppSettingsPatchSchema.safeParse({ fieldExports: [record] }).success).toBe(false);
  });
});
