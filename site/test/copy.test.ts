import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, WINDOWS_INSTALLER } from '../src/content';
import { VALIDATION } from '../src/validation';

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

  it("keeps the runner's own words off the page", () => {
    const jargon = /\bdev split\b/i;
    const found = FILES.filter(({ text }) => jargon.test(text));
    expect(found.map(({ path }) => path)).toEqual([]);
  });

  it('leaves no unfinished markers in the code', () => {
    const found = FILES.filter(({ text }) => /\b(TODO|FIXME|XXX)\b/.test(text));
    expect(found.map(({ path }) => path)).toEqual([]);
  });

  it('names the installer of the version the app is at, so the download is never a dead link', () => {
    const manifest = readFileSync(join(SITE, '..', 'apps', 'desktop', 'package.json'), 'utf8');
    const { version } = JSON.parse(manifest) as { version: string };
    expect(APP_VERSION).toBe(version);
    expect(WINDOWS_INSTALLER.endsWith(`/Architect-Setup-${version}.exe`)).toBe(true);
  });

  it('refers to no address but the repository and the work it quotes, and fetches from nobody', () => {
    // The quoted requests, their list and the others' work are citation links (decision 092):
    // nothing loads from them until clicked.
    const allowed = [
      'https://github.com/echoo19/architect',
      'https://www.ycombinator.com/rfs',
      ...VALIDATION.slides.map((slide) => slide.href),
    ];
    const addresses = FILES.flatMap(({ path, text }) =>
      [...text.matchAll(/https?:\/\/[^\s'"`)<>]+/g)].map((match) => ({ path, url: match[0] })),
    );
    expect(addresses.filter(({ url }) => !allowed.some((ok) => url.startsWith(ok)))).toEqual([]);
  });
});

describe('the work others published', () => {
  it('quotes each one by a short sentence, links its source, and shows its mark or its name', () => {
    expect(VALIDATION.slides.length).toBeGreaterThanOrEqual(5);
    for (const slide of VALIDATION.slides) {
      expect(slide.href).toMatch(/^https:\/\/[^\s]+$/);
      expect(slide.quote.split(/\s+/).length).toBeLessThanOrEqual(30);
      expect(slide.quote).toMatch(/^[A-Z].*[.!?]$/);
      expect(slide.title.length).toBeGreaterThan(0);
      expect(slide.date.length).toBeGreaterThan(0);
      if (slide.mark) {
        expect(existsSync(join(SITE, 'public', slide.mark.src))).toBe(true);
      } else {
        expect(slide.name?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('names no source twice', () => {
    const links = VALIDATION.slides.map((slide) => slide.href);
    expect(new Set(links).size).toBe(links.length);
  });
});
