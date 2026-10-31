import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  Button,
  Collapse,
  FLOAT_SCALE,
  MotionProvider,
  NumberTicker,
  PRESS_SCALE,
  Reveal,
  StepTransition,
  durationParts,
  travel,
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

  it('settles what changes often sooner than a flow step, with no overshoot', () => {
    expect(springs.settle).toEqual({ type: 'spring', duration: 0.28, bounce: 0 });
    expect(springs.settle.duration).toBeLessThan(springs.smooth.duration);
  });

  it('clears a page out of the way faster than anything else leaves', () => {
    expect(springs.leave).toEqual({ type: 'tween', duration: 0.1, ease: 'easeIn' });
    expect(springs.leave.duration).toBeLessThan(springs.exit.duration);
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

  it('moves a place 8px and a tab 6px, less than a flow step', () => {
    expect(stepOffset(1, 'place')).toBe(8);
    expect(stepOffset(-1, 'place')).toBe(-8);
    expect(stepOffset(1, 'tab')).toBe(6);
  });
});

describe('travel', () => {
  it('goes forward to a later place and back to an earlier one', () => {
    expect(travel(0, 3)).toBe(1);
    expect(travel(3, 1)).toBe(-1);
  });

  it('goes forward when it stays level, as from one chat to another', () => {
    expect(travel(5, 5)).toBe(1);
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

  it('draws the element it is given with its styles when asked to, as a link or a close button', () => {
    const html = renderToStaticMarkup(
      createElement(Button, {
        asChild: true,
        variant: 'primary',
        children: createElement('a', { href: '#/new' }, 'New agent'),
      }),
    );
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="#/new"');
    expect(html).toContain('bg-primary');
    expect(html).not.toContain('<button');
  });
});

describe('when every transition is instant', () => {
  const instant = (child: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(createElement(MotionProvider, { instant: true, children: child }));

  it('puts a reveal at its end state in its first frame, so a capture never finds it half in', () => {
    const html = instant(createElement(Reveal, { children: 'hello' }));
    expect(html).toContain('hello');
    expect(html).not.toContain('opacity:0');
    expect(html).not.toContain('translateY(12px)');
  });

  it('opens a collapse at its full height at once', () => {
    const html = instant(createElement(Collapse, { open: true, children: 'shown' }));
    expect(html).toContain('shown');
    expect(html).not.toContain('height:0');
  });

  it('changes a page at once, in a plain element, with nothing to wait for', () => {
    const html = instant(
      createElement(StepTransition, {
        transitionKey: 'define',
        className: 'page',
        children: 'Define',
      }),
    );
    expect(html).toBe('<div class="page">Define</div>');
  });
});

describe('NumberTicker', () => {
  /** What a screen reader hears of each ticker: the server markup names the number it shows. */
  const heard = (props: Parameters<typeof NumberTicker>[0]) =>
    [
      ...renderToStaticMarkup(
        createElement(MotionProvider, {
          instant: true,
          children: createElement(NumberTicker, props),
        }),
      ).matchAll(/aria-label="([^"]*)"/g),
    ].map((match) => match[1]);

  it('writes the numbers the way the app does, ready before any script runs', () => {
    expect(heard({ value: 12 })).toEqual(['12']);
    expect(heard({ value: 91, kind: 'percent' })).toEqual(['91%']);
    expect(heard({ value: 5, kind: 'currency' })).toEqual(['$5']);
    expect(heard({ value: 2.4, kind: 'currency' })).toEqual(['$2.40']);
  });

  it('writes a length of time in the units a person says it in', () => {
    expect(heard({ value: 2 * 3_600_000 + 38 * 60_000, kind: 'duration' })).toEqual([
      '2 h',
      '38 min',
    ]);
    expect(heard({ value: 14 * 60_000, kind: 'duration' })).toEqual(['14 min']);
    expect(heard({ value: 40_000, kind: 'duration' })).toEqual(['40 s']);
  });
});
