import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HUB_TOKENS_PAGE } from '../../../src/renderer/src/hub/labels';
import { WhereToGetOne } from '../../../src/renderer/src/settings/models/HuggingFaceRow';

describe('the Hugging Face row, for a person sent there to add the key', () => {
  const html = renderToStaticMarkup(createElement(WhereToGetOne, { onOpen: () => undefined }));
  const words = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ');

  it('says where to get one, and that the key is called a token there', () => {
    expect(words).toBe(
      'No token yet. Hugging Face calls its keys tokens, and a free account gives you one at huggingface.co/settings/tokens.',
    );
  });

  it('puts the address on a button that opens the page, not on text to copy', () => {
    expect(html).toMatch(/<button type="button"[^>]*>huggingface\.co\/settings\/tokens<\/button>/);
    // The line is the address of the page the dialog's own "Get a token" opens.
    expect(HUB_TOKENS_PAGE).toBe('https://huggingface.co/settings/tokens');
    expect(HUB_TOKENS_PAGE.replace('https://', '')).toBe('huggingface.co/settings/tokens');
  });

  it('keeps to plain words: no dashes and no curly quotes', () => {
    expect(words).not.toMatch(/[–—‘’“”]/);
  });
});
