import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WINDOW_CHROME } from '../src/chrome';

const tokens = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');

function readVariables(css: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const match of css.matchAll(/(--ui-[\w-]+):\s*([^;]+);/g)) {
    vars.set(match[1]!, match[2]!.trim());
  }
  return vars;
}

const vars = readVariables(tokens);

type Rgb = readonly [number, number, number];

/** A token as red, green and blue, with any alpha laid over the surface it sits on. */
function resolve(name: string, over: Rgb = [0, 0, 0]): Rgb {
  const value = vars.get(`--ui-${name}`);
  if (!value) throw new Error(`--ui-${name} is not defined`);
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(value);
  if (!rgb)
    throw new Error(`--ui-${name} is neither a hex color nor an rgb() with alpha: ${value}`);
  const alpha = Number(rgb[4]);
  const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [0, 1, 2].map((i) =>
    Math.round(channels[i]! * alpha + over[i]! * (1 - alpha)),
  ) as unknown as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr! + 0.7152 * lg! + 0.0722 * lb!;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const hexOf = (name: string) => vars.get(`--ui-${name}`);

/** Where text sits: the ground, a card, what floats above them, and a field inside a card. */
const SURFACES = ['ground', 'card', 'raised', 'field'] as const;

describe('design tokens', () => {
  it('matches docs/DESIGN.md', () => {
    expect(hexOf('ground')).toBe('#070707');
    expect(hexOf('card')).toBe('#101010');
    expect(hexOf('raised')).toBe('#161616');
    expect(hexOf('field')).toBe('#0c0c0c');
    expect(hexOf('hover')).toBe('rgb(255 255 255 / 0.05)');
    expect(hexOf('selected')).toBe('rgb(255 255 255 / 0.08)');
    expect(hexOf('line')).toBe('rgb(255 255 255 / 0.08)');
    expect(hexOf('line-strong')).toBe('rgb(255 255 255 / 0.14)');
    expect(hexOf('fg')).toBe('#f4f4f2');
    expect(hexOf('fg-dim')).toBe('rgb(244 244 242 / 0.42)');
    expect(hexOf('primary')).toBe('#f4f4f2');
    expect(hexOf('on-primary')).toBe('#070707');
    expect(hexOf('student')).toBe('#8ab8ff');
    expect(hexOf('mentor')).toBe('#f0b470');
    expect(hexOf('danger')).toBe('#ff6b5e');
    expect(hexOf('ring')).toBe('rgb(244 244 242 / 0.6)');
    expect(hexOf('shadow-float')).toBe('0 24px 60px -12px rgb(0 0 0 / 0.6)');
  });

  it('has one theme, always dark', () => {
    expect(tokens).not.toMatch(/data-theme/);
    expect(tokens).toMatch(/color-scheme:\s*dark/);
    expect(tokens).not.toMatch(/color-scheme:\s*light/);
  });

  it('has one color for text, and one more for placeholders and disabled controls', () => {
    const text = [...vars.keys()].filter((name) => name.startsWith('--ui-fg'));
    expect(text.sort()).toEqual(['--ui-fg', '--ui-fg-dim']);
    expect(theme).not.toMatch(/--color-fg-(soft|secondary|muted|faint|ghost)\b/);
    expect(vars.has('--ui-paper')).toBe(false);
  });

  it('paints nothing on the ground: no gradient, dot grid or glow', () => {
    for (const css of [tokens, theme]) {
      expect(css).not.toMatch(/gradient/i);
      expect(css).not.toMatch(/dot-grid|--ui-dot\b/);
    }
  });

  it('keeps white text at 4.5:1 or better on every surface', () => {
    const failures: string[] = [];
    for (const surface of SURFACES) {
      const ground = resolve(surface);
      const ratio = contrast(resolve('fg', ground), ground);
      if (ratio < 4.5) failures.push(`fg on ${surface}: ${ratio.toFixed(2)}`);
    }
    expect(failures).toEqual([]);
  });

  it("keeps the student's blue, the mentor's amber and red readable on every surface", () => {
    const failures: string[] = [];
    for (const text of ['student', 'mentor', 'danger']) {
      for (const surface of SURFACES) {
        const ground = resolve(surface);
        const ratio = contrast(resolve(text), ground);
        if (ratio < 4.5) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps a placeholder legible in a field, on a card and on a raised layer', () => {
    for (const surface of ['field', 'card', 'raised'] as const) {
      const ground = resolve(surface);
      expect(contrast(resolve('fg-dim', ground), ground)).toBeGreaterThan(3);
    }
  });

  it('keeps the paired colors readable', () => {
    expect(contrast(resolve('on-primary'), resolve('primary'))).toBeGreaterThan(4.5);
    const onCard = resolve('card');
    const studentSoft = resolve('student-soft', onCard);
    expect(contrast(resolve('student'), studentSoft)).toBeGreaterThan(4.5);
    const dangerSoft = resolve('danger-soft', onCard);
    expect(contrast(resolve('danger'), dangerSoft)).toBeGreaterThan(4.5);
  });

  it('keeps a hairline and the selected fill visible on a card', () => {
    const card = resolve('card');
    expect(contrast(resolve('line', card), card)).toBeGreaterThan(1.1);
    expect(contrast(resolve('line-strong', card), card)).toBeGreaterThan(
      contrast(resolve('line', card), card),
    );
    expect(contrast(resolve('selected', card), card)).toBeGreaterThan(
      contrast(resolve('hover', card), card),
    );
  });

  it('maps every Tailwind color onto a raw variable that exists', () => {
    const mapped = [...theme.matchAll(/--color-[\w-]+:\s*var\((--ui-[\w-]+)\)/g)].map((m) => m[1]!);
    expect(mapped.length).toBeGreaterThan(15);
    for (const name of mapped) expect(vars.has(name), name).toBe(true);
  });

  it('gives the native window the ground and the text colors', () => {
    expect(WINDOW_CHROME.background).toBe(hexOf('ground'));
    expect(WINDOW_CHROME.symbol).toBe(hexOf('fg'));
  });
});

describe('type scale', () => {
  const sizes = Object.fromEntries(
    [...theme.matchAll(/--text-([\w-]+):\s*(\d+)px;/g)].map((m) => [m[1]!, Number(m[2])]),
  );

  it('has the seven steps of docs/DESIGN.md, and a hint size for keys', () => {
    expect(sizes).toEqual({
      hero: 56,
      title: 40,
      h1: 28,
      h2: 20,
      body: 15,
      ui: 14,
      small: 13,
      key: 12,
    });
  });

  it('puts nothing below 13px but keyboard hints', () => {
    const small = Object.entries(sizes).filter(([, px]) => px < 13);
    expect(small).toEqual([['key', 12]]);
  });

  it('tightens display type with its size, from -0.03em at 56px to -0.012em at 20px', () => {
    const tracking = Object.fromEntries(
      [...theme.matchAll(/--text-([\w]+)--letter-spacing:\s*(-?[\d.]+)em;/g)].map((m) => [
        m[1]!,
        Number(m[2]),
      ]),
    );
    expect(tracking).toEqual({ hero: -0.03, title: -0.024, h1: -0.018, h2: -0.012 });
  });

  it('sets titles in Inter Tight, reading text in Inter and code in Geist Mono', () => {
    expect(theme).toMatch(/--font-sans:\s*'Inter Variable'/);
    expect(theme).toMatch(/--font-display:\s*'Inter Tight Variable'/);
    expect(theme).toMatch(/--font-mono:\s*'Geist Mono Variable'/);
  });

  it('has the radii of docs/DESIGN.md', () => {
    expect(theme).toMatch(/--radius-card:\s*20px/);
    expect(theme).toMatch(/--radius-control:\s*12px/);
    expect(theme).toMatch(/--radius-mark:\s*8px/);
  });
});
