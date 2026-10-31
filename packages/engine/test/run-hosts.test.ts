import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdapterError, contactsLine, mentorPreset, type MentorConfig } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startFakeOllama, type FakeOllama } from './agent-host/fake-ollama';
import { HubClient } from '../src/hub/client';
import { createEngineDeps } from '../src/host/wiring';
import { connectTeacher, connectTranscriber } from '../src/loop/setup';
import { recordingContacts } from '../src/loop/contacts';
import { openEngineStore, type EngineStore } from '../src/store/engine-store';

let dir: string;
let store: EngineStore;
let ollama: FakeOllama | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'architect-hosts-'));
  store = openEngineStore(join(dir, 'architect.db'));
});

afterEach(async () => {
  await ollama?.close();
  ollama = undefined;
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function hostedMentor(): MentorConfig {
  const preset = mentorPreset('meta-spark');
  return {
    kind: 'model',
    provider: preset.provider,
    label: preset.label,
    baseUrl: preset.baseUrl,
    model: preset.model,
    reasoningEffort: 'medium',
  };
}

describe("a run's hosts", () => {
  it('counts each request by host, inside only while every one there was', () => {
    store.runs.recordContact('run_a', 'spark.lab.internal', true);
    store.runs.recordContact('run_a', '127.0.0.1:11434', true);
    store.runs.recordContact('run_a', 'spark.lab.internal', true);
    store.runs.recordContact('run_b', 'api.example.com', false);
    expect(store.runs.contacts('run_a')).toEqual([
      { host: 'spark.lab.internal', requests: 2, inside: true },
      { host: '127.0.0.1:11434', requests: 1, inside: true },
    ]);
    store.runs.recordContact('run_a', 'spark.lab.internal', false);
    expect(store.runs.contacts('run_a')[0]).toEqual({
      host: 'spark.lab.internal',
      requests: 3,
      inside: false,
    });
    expect(store.runs.contacts('run_none')).toEqual([]);
  });

  it("are recorded from the run's own adapters, and a closed network refuses any other host", async () => {
    ollama = await startFakeOllama([]);
    let allowed: readonly string[] | undefined = ['spark.lab.internal'];
    const deps = recordingContacts(
      createEngineDeps({
        dataDir: dir,
        getSecret: async () => undefined,
        allowedHosts: () => allowed,
      }),
      (host, inside) => store.runs.recordContact('run_a', host, inside),
    );

    // A teacher outside the network is refused when it is made: nothing is sent, nothing recorded.
    expect(() => deps.adapters.createMentor(hostedMentor(), {})).toThrow(AdapterError);
    try {
      deps.adapters.createMentor(hostedMentor(), {});
    } catch (error) {
      expect((error as AdapterError).code).toBe('outside_network');
    }

    // This computer is always inside: the local student's requests are counted, never their paths.
    const student = deps.adapters.createStudent(
      { runtime: 'ollama', baseUrl: ollama.url, model: 'muse-glimmer:30b', contextLength: 16_384 },
      {},
    );
    await student.testConnection();
    const [contact] = store.runs.contacts('run_a');
    expect(contact?.host).toBe(new URL(ollama.url).host);
    expect(contact?.inside).toBe(true);
    expect(contact?.requests).toBeGreaterThan(0);
    expect(contactsLine(store.runs.contacts('run_a'))).toBe('Contacted 1 host, inside the network');

    // With no closed network on, the same requests are recorded as outside one.
    allowed = undefined;
    await student.testConnection();
    expect(contactsLine(store.runs.contacts('run_a'))).toBe(
      'Contacted 1 host, with no closed network on',
    );
  });
});

describe('requests outside a run', () => {
  const allowedHosts = () => ['spark.lab.internal'];

  async function refusal(promise: Promise<unknown>): Promise<AdapterError> {
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AdapterError);
    expect((error as AdapterError).code).toBe('outside_network');
    return error as AdapterError;
  }

  it('refuse drafting, study and transcription outside the network, before a key is sent', async () => {
    const asked: string[] = [];
    const deps = createEngineDeps({
      dataDir: dir,
      getSecret: async (ref) => {
        asked.push(ref);
        return 'key-123456';
      },
      allowedHosts,
    });
    // Drafting and study reach their teacher this way; no run records it, but it is refused.
    await refusal(connectTeacher(deps, hostedMentor()));
    const error = await refusal(connectTranscriber(deps));
    expect(error.message).toContain('outside the closed network');
    // The key was read, but nothing carried it anywhere.
    expect(asked.length).toBeGreaterThan(0);
  });

  it("refuse a Hub outside the network, a training plan's config read included", async () => {
    const urls: string[] = [];
    const hub = new HubClient({
      token: async () => undefined,
      allowedHosts,
      fetch: (async (input: string | URL | Request) => {
        urls.push(String(input));
        return new Response('{}');
      }) as typeof fetch,
    });
    const error = await refusal(hub.revision('meta/muse-glimmer-30b'));
    expect(error.message).toContain('Hugging Face at huggingface.co is outside the closed network');
    expect(urls).toEqual([]);
  });
});
