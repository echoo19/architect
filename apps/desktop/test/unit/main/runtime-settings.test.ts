import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../../src/main/settings/schema';
import { localRuntimeSettings } from '../../../src/main/settings/runtime';

describe("the settings both hosts' llama-servers start with", () => {
  it('carry the chosen program, the quiet thread cap and the Ollama on this computer', () => {
    const settings = { ...defaultSettings(), llamaServerPath: 'C:\\llama.cpp\\llama-server.exe' };
    expect(localRuntimeSettings(settings, 6)).toEqual({
      llamaServerPath: 'C:\\llama.cpp\\llama-server.exe',
      threads: 6,
      ollamaUrl: 'http://127.0.0.1:11434',
    });
    expect(localRuntimeSettings(defaultSettings(), undefined)).toEqual({
      ollamaUrl: 'http://127.0.0.1:11434',
    });
  });

  it('never name an Ollama on another computer, which holds no GPU here', () => {
    const settings = {
      ...defaultSettings(),
      defaultStudent: { ...defaultSettings().defaultStudent, baseUrl: 'http://192.168.1.20:11434' },
    };
    expect(localRuntimeSettings(settings, undefined)).toEqual({});
  });
});
