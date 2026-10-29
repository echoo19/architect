import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'fonts' ? [] : sourceFiles(path);
    return ['.ts', '.tsx', '.css'].includes(extname(path)) ? [path] : [];
  });
}

const FILES = [...sourceFiles(join(SITE, 'src')), join(SITE, 'index.html')].map((path) => ({
  path: path.slice(SITE.length + 1),
  text: readFileSync(path, 'utf8'),
}));

/** The page's rules for what it says and what it loads, kept where a change would break them. */
describe('the site', () => {
  it('has files to check', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('uses no em dashes, en dashes or curly quotes', () => {
    const found = FILES.filter(({ text }) => /[–—‘’“”]/.test(text));
    expect(found.map(({ path }) => path)).toEqual([]);
  });

  it('keeps the product plain: none of its internal words reach the page', () => {
    const jargon = /\b(harness|dev split|lora|vault)\b/i;
    const found = FILES.filter(({ text }) => jargon.test(text));
    expect(found.map(({ path }) => path)).toEqual([]);
  });

  it('leaves no unfinished markers in the code', () => {
    const found = FILES.filter(({ text }) => /\b(TODO|FIXME|XXX)\b/.test(text));
    expect(found.map(({ path }) => path)).toEqual([]);
  });

  it('refers to no address but the repository, so the page fetches from nobody else', () => {
    const allowed = ['https://github.com/echoo19/architect'];
    const addresses = FILES.flatMap(({ path, text }) =>
      [...text.matchAll(/https?:\/\/[^\s'"`)<>]+/g)].map((match) => ({ path, url: match[0] })),
    );
    expect(addresses.filter(({ url }) => !allowed.some((ok) => url.startsWith(ok)))).toEqual([]);
  });
});
