import { describe, expect, it } from 'vitest';
import {
  aKey,
  hostedAvailability,
  providerName,
} from '../../../src/renderer/src/flow/define/hosted';
import { makeJob } from './factories';

const copy = {
  runtime: 'openai_compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'meta/muse-glimmer-30b',
  secretRef: 'openrouter',
  contextLength: 16_384,
} as const;

const student = makeJob().student;
const withCopy = { ...student, trainOn: 'hosted', hosted: copy } as const;

describe('whether the online copy can be used', () => {
  it('needs an online service chosen first, said in plain words', () => {
    expect(hostedAvailability(student, { openrouter: true })).toMatchObject({
      available: false,
      why: 'no_host',
      reason: 'Pick an online service under Glimmer in Advanced settings',
    });
  });

  it("needs the host's key to be saved", () => {
    expect(hostedAvailability(withCopy, { meta: true })).toEqual({
      available: false,
      why: 'no_key',
      reason: 'Add an OpenRouter key in Advanced settings',
    });
    expect(hostedAvailability(withCopy, { openrouter: false })).toMatchObject({ why: 'no_key' });
  });

  it('can be used once the key is saved', () => {
    expect(hostedAvailability(withCopy, { openrouter: true })).toEqual({ available: true });
  });

  it('needs no key of a host that asks for none', () => {
    const open = { ...withCopy, hosted: { ...copy, secretRef: undefined } };
    expect(hostedAvailability(open, {})).toEqual({ available: true });
  });

  it('waits for the keys to be read, and says when they cannot be', () => {
    expect(hostedAvailability(withCopy, 'loading')).toMatchObject({
      available: false,
      why: 'checking',
    });
    expect(hostedAvailability(withCopy, 'error')).toMatchObject({
      available: false,
      why: 'unreadable',
      reason: "Couldn't check for a saved key",
    });
  });
});

describe('naming a key', () => {
  it('writes "a" before a consonant and "an" before a vowel', () => {
    expect(aKey('Meta')).toBe('a Meta key');
    expect(aKey('Together')).toBe('a Together key');
    expect(aKey('OpenRouter')).toBe('an OpenRouter key');
    expect(aKey('OpenAI')).toBe('an OpenAI key');
    expect(aKey('Anthropic')).toBe('an Anthropic key');
  });

  it('names the host an endpoint belongs to', () => {
    expect(providerName(copy)).toBe('OpenRouter');
  });
});
