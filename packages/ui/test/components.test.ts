import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { cn, Meter, ProgressStepper, SettingsRow, Shortcut, shortcutLabel, Spinner } from '../src';

describe('cn', () => {
  it('resolves conflicts between the theme’s custom tokens', () => {
    expect(cn('text-sm', 'text-chat')).toBe('text-chat');
    expect(cn('text-fg', 'text-fg-muted')).toBe('text-fg-muted');
    expect(cn('shadow-composer', 'shadow-modal')).toBe('shadow-modal');
    expect(cn('rounded-lg', 'rounded-6xl')).toBe('rounded-6xl');
  });

  it('keeps a size and a color together', () => {
    expect(cn('text-fg', 'text-display')).toBe('text-fg text-display');
  });
});

describe('ProgressStepper', () => {
  it('marks earlier steps done and the current one as the step', () => {
    const html = renderToStaticMarkup(
      createElement(ProgressStepper, { steps: ['Describe', 'Define', 'Train'], current: 1 }),
    );
    expect(html).toContain('aria-label="Progress"');
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="step"[^>]*>Define/);
    expect(html).toContain('Describe<span class="sr-only">, done</span>');
  });
});

describe('Meter', () => {
  it('reports its value and clamps it', () => {
    const html = renderToStaticMarkup(
      createElement(Meter, { value: 1.4, label: 'Spark spending', valueText: '$7 of $5' }),
    );
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('aria-valuetext="$7 of $5"');
    expect(html).toContain('width:100%');
  });
});

describe('SettingsRow', () => {
  it('sets an explanation in the body face and a model id or path in mono', () => {
    const explained = renderToStaticMarkup(
      createElement(SettingsRow, { label: 'Rounds', meta: 'Each round tries one change' }),
    );
    expect(explained).toContain('Each round tries one change');
    expect(explained).not.toContain('font-mono');
    const code = renderToStaticMarkup(
      createElement(SettingsRow, { label: 'Mentor', meta: 'muse-spark-1.3', metaFont: 'code' }),
    );
    expect(code).toMatch(/font-mono[^>]*>muse-spark-1\.3/);
  });
});

describe('Spinner', () => {
  it('is decorative unless it has a label', () => {
    expect(renderToStaticMarkup(createElement(Spinner))).toContain('aria-hidden="true"');
    const labelled = renderToStaticMarkup(
      createElement(Spinner, { tone: 'mentor', label: 'Training' }),
    );
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Training"');
    expect(labelled).toContain('stroke-mentor');
  });
});

describe('shortcuts', () => {
  it('writes Mod as Command on macOS and Ctrl elsewhere', () => {
    expect(shortcutLabel('Mod', true)).toBe('⌘');
    expect(shortcutLabel('Mod', false)).toBe('Ctrl');
    expect(shortcutLabel('K', true)).toBe('K');
  });

  it('reads the full chord to assistive tech', () => {
    const mac = renderToStaticMarkup(createElement(Shortcut, { keys: ['Mod', 'K'], mac: true }));
    expect(mac).toContain('aria-label="Command+K"');
    expect(mac).toContain('>⌘</kbd>');
    const other = renderToStaticMarkup(createElement(Shortcut, { keys: ['Mod', ','], mac: false }));
    expect(other).toContain('aria-label="Ctrl+,"');
    expect(other).toContain('>Ctrl</kbd>');
  });
});
