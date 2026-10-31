import { describe, expect, it } from 'vitest';
import {
  ClosedNetworkSchema,
  contactHost,
  contactsLine,
  insideNetwork,
  networkHostProblem,
  ollamaNameProblem,
  ollamaRegistryOf,
} from '../src/network';

describe('a closed network', () => {
  it('names hosts by name or address, with a port when only that one is meant', () => {
    for (const host of [
      'spark.lab.internal',
      '10.0.4.7:8000',
      'VLLM.lab.internal:8000',
      '[fd00::7]',
    ]) {
      expect(networkHostProblem(host)).toBeNull();
    }
    for (const text of [
      '',
      'https://spark.lab.internal',
      'spark.lab.internal/v1',
      'a b',
      'me@host',
    ]) {
      expect(networkHostProblem(text)).not.toBeNull();
    }
    expect(ClosedNetworkSchema.parse({ on: true, hosts: [' Spark.Lab.Internal '] })).toEqual({
      on: true,
      hosts: ['spark.lab.internal'],
    });
  });

  it('admits this computer always, a named host on any port, and a pinned one on its port only', () => {
    const hosts = ['spark.lab.internal', 'vllm.lab.internal:8000'];
    expect(insideNetwork('http://127.0.0.1:11434/api/chat', [])).toBe(true);
    expect(insideNetwork('http://localhost:8080/v1', [])).toBe(true);
    expect(insideNetwork('https://spark.lab.internal/v1', hosts)).toBe(true);
    expect(insideNetwork('http://SPARK.lab.internal:9000/v1', hosts)).toBe(true);
    expect(insideNetwork('http://vllm.lab.internal:8000/v1', hosts)).toBe(true);
    expect(insideNetwork('http://vllm.lab.internal:8001/v1', hosts)).toBe(false);
    expect(insideNetwork('https://api.example.com/v1', hosts)).toBe(false);
    expect(insideNetwork('not a url', hosts)).toBe(false);
    // 127.0.0.0/8 mapped into IPv6 is this computer, as the graduates' guard counts it.
    expect(insideNetwork('http://[::ffff:127.0.0.1]:8080/v1', [])).toBe(true);
    expect(insideNetwork('http://[::ffff:7f00:1]:8080/v1', [])).toBe(true);
    expect(insideNetwork('http://[::ffff:10.0.0.1]:8080/v1', [])).toBe(false);
    expect(contactHost('https://Spark.lab.internal/v1/chat?key=private')).toBe(
      'spark.lab.internal',
    );
  });

  it('says in one line where a run went', () => {
    const at = (host: string, inside: boolean) => ({ host, requests: 3, inside });
    expect(contactsLine([])).toBe('Contacted no hosts');
    expect(contactsLine([at('a', true)])).toBe('Contacted 1 host, inside the network');
    expect(contactsLine([at('a', true), at('b', true)])).toBe(
      'Contacted 2 hosts, both inside the network',
    );
    expect(contactsLine([at('a', true), at('b', true), at('c', true)])).toBe(
      'Contacted 3 hosts, all inside the network',
    );
    expect(contactsLine([at('a', false), at('b', false)])).toBe(
      'Contacted 2 hosts, with no closed network on',
    );
    expect(contactsLine([at('a', true), at('b', false), at('c', true)])).toBe(
      'Contacted 3 hosts, 2 of them inside the network',
    );
  });
});

describe('Ollama model names', () => {
  it('reads the registry a name pulls from, and refuses what is not a name', () => {
    expect(ollamaRegistryOf('muse-glimmer:30b')).toBe('registry.ollama.ai');
    expect(ollamaRegistryOf('library/muse-glimmer')).toBe('registry.ollama.ai');
    expect(ollamaRegistryOf('hf.co/unsloth/Muse-Glimmer-30B-GGUF:UD-IQ2_XXS')).toBe('hf.co');
    expect(ollamaRegistryOf('Registry.Lab:5000/team/model')).toBe('registry.lab:5000');
    for (const name of ['muse-glimmer:30b', 'hf.co/unsloth/Muse-Glimmer-30B-GGUF:UD-IQ2_XXS']) {
      expect(ollamaNameProblem(name)).toBeNull();
    }
    for (const name of ['', '../x', 'a/b/c/d', 'a b', 'x:', 'x:tag with space', '/x']) {
      expect(ollamaNameProblem(name), name).not.toBeNull();
    }
  });
});
