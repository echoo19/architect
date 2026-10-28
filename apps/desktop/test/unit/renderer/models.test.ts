import type { LocalRuntimes } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  connectionsFor,
  connectionsFrom,
  hostedFromChoice,
  localModelName,
  mentorFromChoice,
  modelLabel,
  studentFromChoice,
  type Connection,
} from '../../../src/renderer/src/settings/models/connections';
import { priceText } from '../../../src/renderer/src/settings/models/ModelPicker';
import { sameOllamaModel } from '../../../src/renderer/src/settings/models/StudentRows';

const LOCAL: LocalRuntimes = {
  ollama: {
    running: true,
    version: '0.40.9',
    baseUrl: 'http://127.0.0.1:11434',
    models: [{ id: 'muse-glimmer:30b-iq2', sizeBytes: 10_746_373_364 }],
  },
  lmstudio: { running: false, baseUrl: 'http://127.0.0.1:1234/v1', models: [] },
  gpu: null,
};

const ENDPOINTS = [
  { baseUrl: 'https://llm.example.com/v1', label: 'llm.example.com' },
  { baseUrl: 'http://127.0.0.1:8080/v1', label: '127.0.0.1:8080' },
];

function byId(connections: Connection[], id: string): Connection {
  const found = connections.find((connection) => connection.id === id);
  if (!found) throw new Error(`No connection ${id}`);
  return found;
}

describe('connectionsFrom', () => {
  it('lists providers with a saved key, then added endpoints, then the runtimes here', () => {
    const connections = connectionsFrom(
      { meta: true, openai: false, openrouter: true, 'custom:llm.example.com': true },
      ENDPOINTS,
      LOCAL,
    );
    expect(connections.map((connection) => connection.id)).toEqual([
      'meta',
      'openrouter',
      'other:https://llm.example.com/v1',
      'other:http://127.0.0.1:8080/v1',
      'ollama',
      'lmstudio',
    ]);
    expect(byId(connections, 'other:https://llm.example.com/v1')).toMatchObject({
      secretRef: 'custom:llm.example.com',
      local: false,
    });
    expect(byId(connections, 'other:http://127.0.0.1:8080/v1')).not.toHaveProperty('secretRef');
    expect(byId(connections, 'other:http://127.0.0.1:8080/v1').local).toBe(true);
    expect(byId(connections, 'ollama').runtime).toMatchObject({ running: true, version: '0.40.9' });
  });

  it('has only the runtimes before keys and endpoints load', () => {
    expect(connectionsFrom(undefined, [], undefined)).toEqual([]);
  });
});

describe('connectionsFor', () => {
  const all = connectionsFrom({ meta: true, openrouter: true, together: true }, ENDPOINTS, LOCAL);
  const ids = (role: Parameters<typeof connectionsFor>[0]) =>
    connectionsFor(role, all).map((connection) => connection.id);

  it('offers a mentor from anywhere that answers', () => {
    expect(ids('mentor')).toEqual([
      'meta',
      'openrouter',
      'together',
      'other:https://llm.example.com/v1',
      'other:http://127.0.0.1:8080/v1',
      'ollama',
    ]);
  });

  it('offers the agent only models on this computer', () => {
    expect(ids('student')).toEqual(['other:http://127.0.0.1:8080/v1', 'ollama', 'lmstudio']);
  });

  it('offers hosted copies only from hosts of open models', () => {
    expect(ids('hosted')).toEqual(['openrouter', 'together', 'other:https://llm.example.com/v1']);
  });
});

describe('choices', () => {
  const all = connectionsFrom({ openrouter: true, anthropic: true }, [], LOCAL);
  const priced = { inputPerM: 0.3, cachedInputPerM: 0.04, outputPerM: 1.2 };

  it("saves OpenRouter's listed price with a mentor, and names it without its maker", () => {
    const config = mentorFromChoice(
      {
        connection: byId(all, 'openrouter'),
        id: 'meta/muse-glimmer-30b',
        entry: { id: 'meta/muse-glimmer-30b', label: 'Meta: Muse Glimmer 30B', pricing: priced },
      },
      'low',
    );
    expect(config).toEqual({
      kind: 'model',
      provider: 'openrouter',
      label: 'Muse Glimmer 30B',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'meta/muse-glimmer-30b',
      reasoningEffort: 'low',
      secretRef: 'openrouter',
      pricing: priced,
    });
  });

  it("names a preset by the preset's label and leaves its price to the preset", () => {
    const config = mentorFromChoice(
      { connection: byId(all, 'anthropic'), id: 'claude-haiku-5-5' },
      'medium',
    );
    expect(config).toMatchObject({ label: 'Claude Haiku 5.5', secretRef: 'anthropic' });
    expect(config).not.toHaveProperty('pricing');
  });

  it('gives a mentor on this computer no key', () => {
    const config = mentorFromChoice(
      { connection: byId(all, 'ollama'), id: 'granite4.2:8b' },
      'medium',
    );
    expect(config).toMatchObject({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434' });
    expect(config).not.toHaveProperty('secretRef');
  });

  it('turns choices into the local student and a hosted copy', () => {
    expect(
      studentFromChoice({ connection: byId(all, 'ollama'), id: 'muse-glimmer:30b-iq2' }, 16_384),
    ).toEqual({
      runtime: 'ollama',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'muse-glimmer:30b-iq2',
      contextLength: 16_384,
    });
    expect(
      hostedFromChoice(
        {
          connection: byId(all, 'openrouter'),
          id: 'meta/muse-glimmer-30b',
          entry: { id: 'meta/muse-glimmer-30b', pricing: priced },
        },
        16_384,
      ),
    ).toEqual({
      runtime: 'openai_compatible',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'meta/muse-glimmer-30b',
      secretRef: 'openrouter',
      contextLength: 16_384,
      pricing: priced,
    });
  });
});

describe('names and figures', () => {
  it('names local models by their build, and others by their id', () => {
    expect(localModelName('muse-glimmer:30b-iq2')).toBe('Muse Glimmer · 2-bit');
    expect(localModelName('muse-glimmer:30b')).toBe('Muse Glimmer · 4-bit');
    expect(localModelName('granite4.2:8b')).toBe('granite4.2:8b');
    expect(modelLabel('x/y', { id: 'x/y', label: 'Maker: Model Y' })).toBe('Model Y');
    expect(modelLabel('gpt-6-luna')).toBe('gpt-6-luna');
  });

  it('writes prices per million tokens, in and out', () => {
    expect(priceText({ inputPerM: 1.25, cachedInputPerM: 0.15, outputPerM: 4.25 })).toBe(
      '$1.25 · $4.25',
    );
    expect(priceText({ inputPerM: 0, cachedInputPerM: 0, outputPerM: 0 })).toBe('Free');
  });

  it('treats an Ollama name without a tag as its latest one', () => {
    expect(sameOllamaModel('muse-glimmer', 'muse-glimmer:latest')).toBe(true);
    expect(sameOllamaModel('muse-glimmer:30b', 'muse-glimmer:30b-iq2')).toBe(false);
  });
});
