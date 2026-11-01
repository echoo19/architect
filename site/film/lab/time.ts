import type { CSSProperties } from 'react';

/**
 * The film's clock and its curves. Every picture is a pure function of the film's time in seconds:
 * nothing here reads a timer, and the same time always draws the same frame.
 */

export const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

export const mix = (from: number, to: number, p: number) => from + (to - from) * p;

/** How far a span starting at `at` and lasting `dur` seconds has run at `t`, from 0 to 1. */
export const span = (t: number, at: number, dur: number) => clamp((t - at) / dur);

/** Reads the target fast and settles slowly: for things arriving and for the camera. */
export const outExpo = (p: number) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(p)));

/** A softer arrival, for things that should not snap. */
export const outQuart = (p: number) => 1 - Math.pow(1 - clamp(p), 4);

/** Starts and ends at rest: for moves between two held framings. */
export const inOutCubic = (p: number) => {
  const x = clamp(p);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Slow in and slow out, quicker in the middle than a cubic: for long camera travels. */
export const inOutQuint = (p: number) => {
  const x = clamp(p);
  return x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2;
};

/** Product speed: what a state change in the app takes, eased out with no bounce. */
export const ui = (t: number, at: number, dur = 0.28) => outQuart(span(t, at, dur));

/** A thing that rises into place as the app's pages do: up a few pixels while it fades in. */
export function rise(t: number, at: number, dy = 10, dur = 0.55): CSSProperties {
  const p = outQuart(span(t, at, dur));
  return { opacity: p, transform: `translateY(${(1 - p) * dy}px)` };
}

/** A thing that slides in from a side, by `dx` pixels. */
export function slide(t: number, at: number, dx: number, dur = 0.6): CSSProperties {
  const p = outExpo(span(t, at, dur));
  return { opacity: clamp(p * 1.6), transform: `translateX(${(1 - p) * dx}px)` };
}

/** Shown from `at` on, and gone after `until`, with a short fade at each end. */
export function during(t: number, at: number, until = Infinity, fade = 0.3): number {
  return Math.min(outQuart(span(t, at, fade)), 1 - outQuart(span(t, until, fade)));
}

/**
 * A smooth, never-decreasing curve through [x, y] points (a cubic Hermite spline): it passes through
 * every point, and its speed changes without a jump at any of them. At each point its speed is the
 * slower of the two stretches beside it, so a held moment that is passed over quickly never hands
 * its speed to the motion after it, and a flat stretch stays flat. Beyond the ends it holds the end
 * values.
 */
export function smoothMap(points: readonly (readonly [number, number])[]): (x: number) => number {
  const n = points.length;
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const secants = xs.slice(1).map((x, i) => (ys[i + 1]! - ys[i]!) / (x - xs[i]!));
  const slopes = xs.map((_, i) => {
    if (i === 0) return secants[0]!;
    if (i === n - 1) return secants[n - 2]!;
    return Math.min(secants[i - 1]!, secants[i]!);
  });
  return (x: number) => {
    if (x <= xs[0]!) return ys[0]!;
    if (x >= xs[n - 1]!) return ys[n - 1]!;
    let i = 0;
    while (x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const s = (x - xs[i]!) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * ys[i]! +
      (s3 - 2 * s2 + s) * h * slopes[i]! +
      (-2 * s3 + 3 * s2) * ys[i + 1]! +
      (s3 - s2) * h * slopes[i + 1]!
    );
  };
}

/** A count that runs from one figure to another over a span, rounded as it goes. */
export function count(t: number, at: number, dur: number, from: number, to: number): number {
  return Math.round(mix(from, to, outQuart(span(t, at, dur))));
}
