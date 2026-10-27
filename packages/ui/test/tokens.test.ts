import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WINDOW_CHROME } from '../src/chrome';

type Theme = 'dark' | 'light';

const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

function readTheme(theme: Theme): Map<string, string> {
  const selector = theme === 'dark' ? ":root,\n[data-theme='dark'] {" : "[data-theme='light'] {";
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`No ${theme} block in tokens.css`);
  const body = css.slice(start + selector.length, css.indexOf('\n}', start));
  const vars = new Map<string, string>();
  for (const match of body.matchAll(/(--ui-[\w-]+):\s*([^;]+);/g)) {
    vars.set(match[1]!, match[2]!.trim());
  }
  return vars;
}

const themes: Record<Theme, Map<string, string>> = {
  dark: readTheme('dark'),
  light: readTheme('light'),
};

function hex(theme: Theme, name: string): string {
  const value = themes[theme].get(`--ui-${name}`);
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`--ui-${name} in ${theme} is not a 6-digit hex color: ${value}`);
  }
  return value;
}

function luminance(color: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Text that carries meaning must reach 4.5:1 on every surface it appears on. */
const READABLE_TEXT = ['fg', 'fg-soft', 'fg-secondary', 'fg-muted', 'mentor', 'student', 'danger'];
const SURFACES = [
  'ground',
  'ground-flow',
  'sidebar',
  'panel',
  'card',
  'card-raised',
  'list',
  'modal',
  'modal-rail',
  'aside',
  'well',
  'field',
  'composer',
];

describe('design tokens', () => {
  it('defines the same variables in both themes', () => {
    expect([...themes.light.keys()].sort()).toEqual([...themes.dark.keys()].sort());
  });

  for (const theme of ['dark', 'light'] as const) {
    it(`keeps readable text at 4.5:1 or better in the ${theme} theme`, () => {
      const failures: string[] = [];
      for (const text of READABLE_TEXT) {
        for (const surface of SURFACES) {
          const ratio = contrast(hex(theme, text), hex(theme, surface));
          if (ratio < 4.5) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it(`keeps the paired colors readable in the ${theme} theme`, () => {
      expect(contrast(hex(theme, 'on-primary'), hex(theme, 'primary'))).toBeGreaterThan(4.5);
      expect(contrast(hex(theme, 'student'), hex(theme, 'student-tint'))).toBeGreaterThan(4.5);
      expect(contrast(hex(theme, 'paper-fg'), hex(theme, 'paper'))).toBeGreaterThan(4.5);
      expect(contrast(hex(theme, 'paper-fg-secondary'), hex(theme, 'paper'))).toBeGreaterThan(4.5);
    });

    it(`gives the native window the ${theme} ground and control colors`, () => {
      expect(WINDOW_CHROME[theme].background).toBe(hex(theme, 'ground'));
      expect(WINDOW_CHROME[theme].symbol).toBe(hex(theme, 'fg-secondary'));
    });
  }

  it('matches the design values for the dark theme', () => {
    expect(hex('dark', 'ground')).toBe('#0c0c0e');
    expect(hex('dark', 'sidebar')).toBe('#09090b');
    expect(hex('dark', 'modal')).toBe('#111114');
    expect(hex('dark', 'mentor')).toBe('#f0b470');
    expect(hex('dark', 'student')).toBe('#82b6f5');
    expect(hex('dark', 'paper')).toBe('#f4f3ef');
  });
});
