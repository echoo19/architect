import { PROVIDERS } from '@architect/shared';
import { describe, expect, it, vi } from 'vitest';
import { createLinkOpener, isKnownPage, providerPage } from '../../../src/main/links';

describe('the route to the browser', () => {
  it("knows every provider's key page and OpenRouter's sign-in", () => {
    for (const [id, provider] of Object.entries(PROVIDERS)) {
      if (provider.page) expect(isKnownPage(provider.page), id).toBe(true);
    }
    expect(
      isKnownPage('https://openrouter.ai/auth?callback_url=http://127.0.0.1:5000/callback'),
    ).toBe(true);
  });

  it('refuses anything else: other hosts, plain HTTP, look-alikes and odd schemes', () => {
    for (const url of [
      'https://attacker.example',
      'http://openrouter.ai/auth',
      'https://openrouter.ai.attacker.example/auth',
      'https://user@openrouter.ai/auth',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isKnownPage(url), url).toBe(false);
    }
  });

  it('opens a known page, refuses an unknown one, and opens nothing while hidden', async () => {
    const open = vi.fn(async () => undefined);
    await createLinkOpener(open, false)(providerPage('openai'));
    expect(open).toHaveBeenCalledWith('https://platform.openai.com/api-keys');
    await expect(createLinkOpener(open, false)('https://attacker.example')).rejects.toThrow(
      'Architect only opens the provider pages it knows.',
    );

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hiddenOpen = vi.fn(async () => undefined);
    await createLinkOpener(hiddenOpen, true)(providerPage('openrouter'));
    expect(hiddenOpen).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('has a page for the runtimes too, and none for an added endpoint', () => {
    expect(providerPage('ollama')).toBe('https://ollama.com/download');
    expect(() => providerPage('other')).toThrow('Other has no page to open.');
  });
});
