import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The rules of docs/DESIGN.md that can be checked by reading the source: one theme, no grey text,
 * no gradients or dot grid, nothing but the design's colors, radii and type steps. A screen that
 * goes back to an old name fails here, with the file and line.
 */

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const SOURCES = ['packages/ui/src', 'apps/desktop/src/renderer/src', 'site/src'] as const;
/** The two files that hold colors: the tokens, and the window's own, which the tokens' test keeps in step. */
const COLOR_FILES = [
  join('packages', 'ui', 'src', 'styles', 'tokens.css'),
  join('packages', 'ui', 'src', 'chrome.ts'),
];

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'fonts' ? [] : walk(path);
    return /\.(?:tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

const files = SOURCES.flatMap(walk);

/** Every line of the sources that a pattern matches, as "file:line: text". */
function hits(pattern: RegExp, only: (file: string) => boolean = () => true): string[] {
  return files.filter(only).flatMap((file) =>
    readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line) ? [`${file.replaceAll('\\', '/')}:${index + 1}: ${line.trim()}`] : [],
      ),
  );
}

const CLASS = String.raw`(?<![\w-])`;
const END = String.raw`(?![\w-])`;

describe('docs/DESIGN.md, as far as the source can show it', () => {
  it('has no grey text: every word is white, and only a placeholder or a disabled control is dimmed', () => {
    expect(
      hits(
        new RegExp(
          `${CLASS}(?:text|bg|border|stroke|fill|decoration|ring|outline|divide|placeholder)-fg-(?:soft|secondary|muted|faint|ghost)${END}`,
        ),
      ),
    ).toEqual([]);
    expect(hits(/--(?:ui|color)-fg-(?:soft|secondary|muted|faint|ghost)\b/)).toEqual([]);
  });

  it('uses no surface, line, tint or shadow of the old design', () => {
    const surfaces = `${CLASS}bg-(?:ground-flow|sidebar|panel|list|aside|well|modal|modal-rail|card-raised|composer|bubble|tab-active|segment-active|row-hover|switch-off|switch-knob-off|student-tint|student-dim|student-tile|danger-tint|primary-hover|paper|dot-grid)${END}`;
    const lines = `${CLASS}(?:border|stroke|divide)-(?:line-card|line-control|line-row|line-row-strong|danger-line|student-tile-line)${END}`;
    const shadows = `${CLASS}shadow-(?:composer|composer-sm|modal|popover|segment)${END}`;
    const paper = `${CLASS}(?:text|border)-paper(?:-fg(?:-secondary)?)?${END}`;
    for (const pattern of [surfaces, lines, shadows, paper]) {
      expect(hits(new RegExp(pattern))).toEqual([]);
    }
    expect(
      hits(
        /--(?:ui|color)-(?:ground-flow|dot|paper\w*|line-card|line-control|line-row\w*|primary-hover|student-tint|student-dim|student-tile\w*|danger-tint|danger-line|sidebar|panel|list|aside|well|modal\w*|card-raised|composer\w*|bubble)\b/,
      ),
    ).toEqual([]);
  });

  it('paints nothing on the ground: no gradient, glow or dot grid', () => {
    expect(
      hits(/gradient|bg-linear|bg-radial|bg-conic|bg-dot-grid|backdrop-blur|\bblur-|drop-shadow/i),
    ).toEqual([]);
    expect(hits(/box-shadow:\s*0 0 \d+px/)).toEqual([]);
  });

  it('has one theme: always dark', () => {
    expect(hits(/data-theme|prefers-color-scheme|color-scheme:\s*light/)).toEqual([]);
  });

  it('has no color of its own: every color is a token', () => {
    const colors = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])|\b(?:rgba?|hsla?|oklch|oklab)\(/;
    expect(hits(colors, (file) => !COLOR_FILES.includes(file))).toEqual([]);
  });

  it('uses only the radii and type steps of the design', () => {
    const radii = `${CLASS}rounded-(?:xs|sm|md|lg|xl|2xl|3xl|4xl|5xl|6xl)${END}`;
    const steps = `${CLASS}text-(?:2xs|xs|sm|base|md|chat|lg|xl|2xl|3xl|stat|display|display-sm|display-lg|hero-lg)${END}`;
    const tracking = `${CLASS}tracking-(?:tight|tighter|tightest)${END}`;
    for (const pattern of [radii, steps, tracking]) {
      expect(hits(new RegExp(pattern))).toEqual([]);
    }
  });

  it('puts nothing in the app below 13px but keyboard hints', () => {
    // The site's own marketing text is set in its own sizes; the product's screens and the mocks are not.
    const small = hits(
      /(?<![\w-])text-\[(?:[0-9]|1[0-2])(?:\.\d+)?px\](?![\w-])/,
      (file) => !file.replaceAll('\\', '/').startsWith('site/src/components'),
    );
    expect(small).toEqual([]);
  });
});
