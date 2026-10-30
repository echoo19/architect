import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Button,
  Collapse,
  FLOAT_SCALE,
  MotionProvider,
  PRESS_SCALE,
  Reveal,
  durationParts,
  motionSettings,
  numberDisplay,
  springs,
  staggerDelay,
  stepOffset,
} from '../src';

describe('springs', () => {
  it('has the three transitions of docs/DESIGN.md', () => {
    expect(springs.snappy).toEqual({ type: 'spring', duration: 0.25, bounce: 0.15 });
    expect(springs.smooth).toEqual({ type: 'spring', duration: 0.36, bounce: 0 });
    expect(springs.exit).toEqual({ type: 'tween', duration: 0.16, ease: 'easeIn' });
  });

  it('lets things leave faster than they arrive', () => {
    expect(springs.exit.duration).toBeLessThan(springs.snappy.duration);
    expect(springs.snappy.duration).toBeLessThan(springs.smooth.duration);
  });

  it('presses a control to 0.97 and floats a layer in from 0.97', () => {
    expect(PRESS_SCALE).toBe(0.97);
    expect(FLOAT_SCALE).toBe(0.97);
  });
});

describe('motionSettings', () => {
  it('follows the system setting, and animates, in a normal run', () => {
    expect(motionSettings({ instant: false, systemReduced: false })).toEqual({
      reducedMotion: 'user',
      skipAnimations: false,
    });
  });

  it('completes every transition at once when the app runs for tests and screenshots', () => {
    expect(motionSettings({ instant: true, systemReduced: false })).toEqual({
      reducedMotion: 'always',
      skipAnimations: true,
    });
    expect(motionSettings({ instant: true, systemReduced: true })).toEqual({
      reducedMotion: 'always',
      skipAnimations: true,
    });
  });

  it('completes every transition at once for a person whose system asks for less motion', () => {
    expect(motionSettings({ instant: false, systemReduced: true })).toEqual({
      reducedMotion: 'user',
      skipAnimations: true,
    });
  });
});

describe('staggerDelay', () => {
  it('starts items 30ms apart', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBeCloseTo(0.03);
    expect(staggerDelay(4)).toBeCloseTo(0.12);
  });

  it('staggers eight items at most, and the rest appear with the last', () => {
    expect(staggerDelay(7)).toBeCloseTo(0.21);
    expect(staggerDelay(8)).toBeCloseTo(0.21);
    expect(staggerDelay(40)).toBeCloseTo(0.21);
  });

  it('never starts an item before its group', () => {
    expect(staggerDelay(-3)).toBe(0);
  });
});

describe('stepOffset', () => {
  it('slides 24px in from the side the person is moving toward', () => {
    expect(stepOffset(1)).toBe(24);
    expect(stepOffset(-1)).toBe(-24);
  });
});

describe('numbers', () => {
  it('writes whole numbers, whole-number percentages, dollars and cents', () => {
    expect(numberDisplay('integer', 12)).toEqual({ format: { maximumFractionDigits: 0 } });
    expect(numberDisplay('percent', 91)).toEqual({
      format: { maximumFractionDigits: 0 },
      suffix: '%',
    });
    expect(numberDisplay('currency', 5).format).toMatchObject({
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    });
    expect(numberDisplay('currency', 2.4).format).toMatchObject({ minimumFractionDigits: 2 });
  });

  it('says a length of time as the app does: hours and minutes, minutes, or seconds', () => {
    expect(durationParts(2 * 3_600_000 + 38 * 60_000)).toEqual([
      { value: 2, suffix: ' h' },
      { value: 38, suffix: ' min' },
    ]);
    expect(durationParts(3_600_000)).toEqual([{ value: 1, suffix: ' h' }]);
    expect(durationParts(14 * 60_000)).toEqual([{ value: 14, suffix: ' min' }]);
    expect(durationParts(40_000)).toEqual([{ value: 40, suffix: ' s' }]);
  });
});

describe('the wrappers', () => {
  it('renders nothing for a collapse that is closed, and its content when open', () => {
    const closed = renderToStaticMarkup(
      createElement(Collapse, { open: false, children: 'folded' }),
    );
    expect(closed).not.toContain('folded');
    const open = renderToStaticMarkup(createElement(Collapse, { open: true, children: 'shown' }));
    expect(open).toContain('shown');
  });

  it('starts a reveal faded out and lowered, so it can come in', () => {
    const html = renderToStaticMarkup(createElement(Reveal, { children: 'hello' }));
    expect(html).toContain('opacity:0');
    expect(html).toContain('translateY(12px)');
    expect(html).toContain('hello');
  });

  it('renders what is inside the provider', () => {
    const html = renderToStaticMarkup(
      createElement(MotionProvider, {
        instant: true,
        children: createElement('p', null, 'inside'),
      }),
    );
    expect(html).toBe('<p>inside</p>');
  });

  it('draws a button as a button that does nothing until pressed', () => {
    const html = renderToStaticMarkup(createElement(Button, { children: 'Start training' }));
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('Start training');
  });
});
