import { describe, expect, it } from 'vitest';
import {
  customSecretRef,
  isSecretRef,
  keyDestinationProblem,
  keyMayGoTo,
  MENTOR_PRESETS,
  PROVIDERS,
  secretLabel,
  STUDENT_PRESETS,
} from '../src';

describe('where a stored key may be sent', () => {
  it("allows every preset's own endpoint", () => {
    for (const preset of [...MENTOR_PRESETS, ...STUDENT_PRESETS]) {
      if (preset.secretRef === undefined) continue;
      expect(keyMayGoTo(preset.secretRef, preset.baseUrl), preset.key).toBe(true);
    }
  });

  it("allows every named provider's own address", () => {
    for (const [id, provider] of Object.entries(PROVIDERS)) {
      if (provider.secretRef === undefined) continue;
      expect(keyMayGoTo(provider.secretRef, provider.baseUrl), id).toBe(true);
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

  it("keeps each new provider's key to its own host", () => {
    expect(keyMayGoTo('openai', 'https://api.openai.com/v1')).toBe(true);
    expect(keyMayGoTo('openai', 'https://api.anthropic.com/v1')).toBe(false);
    expect(keyMayGoTo('anthropic', 'https://api.anthropic.com/v1')).toBe(true);
    expect(keyMayGoTo('anthropic', 'https://openrouter.ai/api/v1')).toBe(false);
    expect(keyMayGoTo('gemini', 'https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      true,
    );
    expect(keyMayGoTo('gemini', 'https://googleapis.com.attacker.example')).toBe(false);
    expect(keyMayGoTo('groq', 'https://api.groq.com/openai/v1')).toBe(true);
    expect(keyMayGoTo('fireworks', 'https://api.fireworks.ai/inference/v1')).toBe(true);
    expect(keyMayGoTo('fireworks', 'https://fireworks.ai.attacker.example/v1')).toBe(false);
  });

  it("sends a Hugging Face key to the Hub's API host and nowhere else", () => {
    expect(keyMayGoTo('huggingface', 'https://huggingface.co/api/whoami-v2')).toBe(true);
    expect(keyMayGoTo('huggingface', 'http://huggingface.co/api/whoami-v2')).toBe(false);
    expect(keyMayGoTo('huggingface', 'https://cdn-lfs.huggingface.co/repos/x')).toBe(false);
    expect(keyMayGoTo('huggingface', 'https://cas-bridge.xethub.hf.co/xet-bridge-us/x')).toBe(
      false,
    );
    expect(keyMayGoTo('huggingface', 'https://huggingface.co.attacker.example')).toBe(false);
    expect(keyMayGoTo('huggingface', 'http://127.0.0.1:8080/api/whoami-v2')).toBe(false);
  });

  it('says plainly what would have happened', () => {
    expect(keyDestinationProblem('meta', 'https://attacker.example/v1')).toBe(
      "This would send your Meta Model API key to attacker.example. Architect only sends it to api.meta.ai over HTTPS. Check the job's mentor and student settings.",
    );
    expect(keyDestinationProblem('meta', 'https://api.meta.ai/v1')).toBeNull();
  });
});

describe('the key of an endpoint the user added', () => {
  it('is stored under the host and port the user entered', () => {
    expect(customSecretRef('https://LLM.Example.com/v1')).toBe('custom:llm.example.com');
    expect(customSecretRef('https://llm.example.com:8443/v1')).toBe('custom:llm.example.com:8443');
    expect(customSecretRef('http://127.0.0.1:8080/v1')).toBe('custom:127.0.0.1:8080');
    expect(customSecretRef('http://[::1]:8000/v1')).toBe('custom:[::1]:8000');
  });

  it('goes only to exactly that host and port, over HTTPS', () => {
    const ref = customSecretRef('https://llm.example.com/v1');
    expect(keyMayGoTo(ref, 'https://llm.example.com/v1')).toBe(true);
    expect(keyMayGoTo(ref, 'https://llm.example.com/other/path')).toBe(true);
    expect(keyMayGoTo(ref, 'http://llm.example.com/v1')).toBe(false);
    expect(keyMayGoTo(ref, 'https://llm.example.com:8443/v1')).toBe(false);
    expect(keyMayGoTo(ref, 'https://api.llm.example.com/v1')).toBe(false);
    expect(keyMayGoTo(ref, 'https://llm.example.com.attacker.example/v1')).toBe(false);
    expect(keyMayGoTo(ref, 'https://attacker.example/v1')).toBe(false);
  });

  it('may use plain HTTP only when that host is this computer', () => {
    const local = customSecretRef('http://127.0.0.1:8080/v1');
    expect(keyMayGoTo(local, 'http://127.0.0.1:8080/v1')).toBe(true);
    expect(keyMayGoTo(local, 'http://127.0.0.1:8081/v1')).toBe(false);
    expect(keyMayGoTo(local, 'http://localhost:8080/v1')).toBe(false);
    const lan = customSecretRef('http://192.168.1.20:8000/v1');
    expect(keyMayGoTo(lan, 'http://192.168.1.20:8000/v1')).toBe(false);
    expect(keyMayGoTo(customSecretRef('http://[::1]:8000/v1'), 'http://[::1]:8000/v1')).toBe(true);
  });

  it('is never a named service key, and odd refs are not refs at all', () => {
    expect(isSecretRef('custom:llm.example.com')).toBe(true);
    expect(isSecretRef('custom:llm.example.com:8443')).toBe(true);
    expect(isSecretRef('custom:')).toBe(false);
    expect(isSecretRef('custom:https://llm.example.com')).toBe(false);
    expect(isSecretRef('custom:llm.example.com/v1')).toBe(false);
    expect(isSecretRef('custom:LLM.example.com')).toBe(false);
    expect(keyMayGoTo('custom:llm.example.com/v1', 'https://llm.example.com/v1')).toBe(false);
  });

  it('is named by its host, and explains a refusal the same way', () => {
    expect(secretLabel('custom:llm.example.com')).toBe('llm.example.com');
    expect(secretLabel('openai')).toBe('OpenAI');
    expect(keyDestinationProblem('custom:llm.example.com', 'https://attacker.example/v1')).toBe(
      "This would send the key for llm.example.com to attacker.example. Architect only sends it to llm.example.com over HTTPS. Check the job's mentor and student settings.",
    );
    expect(keyDestinationProblem('custom:127.0.0.1:8080', 'http://127.0.0.1:9999/v1')).toBe(
      "This would send the key for 127.0.0.1:8080 to 127.0.0.1:9999. Architect only sends it to 127.0.0.1:8080. Check the job's mentor and student settings.",
    );
  });
});
