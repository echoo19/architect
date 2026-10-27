import { describe, expect, it } from 'vitest';
import { keyDestinationProblem, keyMayGoTo, MENTOR_PRESETS, STUDENT_PRESETS } from '../src';

describe('where a stored key may be sent', () => {
  it("allows every preset's own endpoint", () => {
    for (const preset of [...MENTOR_PRESETS, ...STUDENT_PRESETS]) {
      if (preset.secretRef === undefined) continue;
      expect(keyMayGoTo(preset.secretRef, preset.baseUrl), preset.key).toBe(true);
    }
  });

  it('allows the hosts a service uses beyond its preset', () => {
    expect(keyMayGoTo('modal', 'https://my-endpoint.us-west.modal.direct/v1')).toBe(true);
    expect(keyMayGoTo('baseten', 'https://model-abc123.api.baseten.co/v1')).toBe(true);
    expect(keyMayGoTo('together', 'https://api.together.xyz/v1')).toBe(true);
  });

  it('refuses any other host, plain HTTP, look-alike hosts and unknown refs', () => {
    expect(keyMayGoTo('meta', 'https://attacker.example/v1')).toBe(false);
    expect(keyMayGoTo('meta', 'http://api.meta.ai/v1')).toBe(false);
    expect(keyMayGoTo('meta', 'https://api.meta.ai.attacker.example/v1')).toBe(false);
    expect(keyMayGoTo('modal', 'https://modal.direct.attacker.example')).toBe(false);
    expect(keyMayGoTo('openrouter', 'https://api.deepinfra.com/v1/openai')).toBe(false);
    expect(keyMayGoTo('custom', 'https://api.meta.ai/v1')).toBe(false);
    expect(keyMayGoTo('meta', 'not a url')).toBe(false);
  });

  it('says plainly what would have happened', () => {
    expect(keyDestinationProblem('meta', 'https://attacker.example/v1')).toBe(
      "This would send your Meta Model API key to attacker.example. Architect only sends it to api.meta.ai over HTTPS. Check the job's mentor and student settings.",
    );
    expect(keyDestinationProblem('meta', 'https://api.meta.ai/v1')).toBeNull();
  });
});
