/**
 * The film's cut: which picture is on screen when, and how the camera moves over it. Everything
 * here is a pure function of the film's time `t` in seconds, so any frame can be drawn on its own.
 * The narration is recorded to these times.
 */

export const DURATION = 170.4;
/** How long a cross-fade between two scenes takes, and how far a scene slides as it comes or goes. */
export const FADE = 0.5;
export const SLIDE = 16;

export type LayerId =
  | 'rule'
  | 'forest'
  | 'end'
  | 'describe'
  | 'glimmer'
  | 'spark'
  | 'ask'
  | 'train'
  | 'test'
  | 'hero'
  | 'use'
  | 'teachers'
  | 'yc'
  | 'diagram'
  | 'share'
  | 'hf';

/** A point in a picture, as fractions of its width and height. */
export type Point = readonly [number, number];

export interface Scene {
  layer: LayerId;
  start: number;
  end: number;
  /**
   * For a mock: its animations run at `rate` times real time from its own start, and hold at
   * `max` seconds if it has one. A mock's own timeline starts at 0 when the scene starts.
   */
  rate?: number;
  max?: number;
  /** The camera's push, as a share of the picture's size, and where it leans: from one point to another. */
  push: number;
  focus: readonly [Point, Point];
}

const centre: Point = [0.5, 0.5];

export const SCENES: readonly Scene[] = [
  // The shop's rule and ticket T-2014 worked out, held before the confirm.
  {
    layer: 'rule',
    start: 0,
    end: 9.4,
    rate: 1,
    max: 6.9,
    push: 0.05,
    focus: [
      [0.3, 0.5],
      [0.72, 0.52],
    ],
  },
  // The sealed final test, on the new returns desk, one row at a time.
  {
    layer: 'forest',
    start: 9.4,
    end: 30.2,
    push: 0.05,
    focus: [
      [0.5, 0.35],
      [0.7, 0.72],
    ],
  },
  { layer: 'end', start: 30.2, end: 33.2, push: 0.04, focus: [centre, centre] },
  {
    layer: 'describe',
    start: 33.2,
    end: 42.8,
    rate: 0.7,
    push: 0.07,
    focus: [
      [0.5, 0.45],
      [0.5, 0.55],
    ],
  },
  { layer: 'glimmer', start: 42.8, end: 51.2, push: 0.04, focus: [centre, centre] },
  { layer: 'spark', start: 51.2, end: 53.4, push: 0.03, focus: [centre, centre] },
  {
    layer: 'ask',
    start: 53.4,
    end: 56.0,
    rate: 2.4,
    push: 0.04,
    focus: [
      [0.4, 0.3],
      [0.4, 0.5],
    ],
  },
  {
    layer: 'train',
    start: 56.0,
    end: 73.6,
    rate: 0.56,
    push: 0.06,
    focus: [
      [0.3, 0.45],
      [0.75, 0.62],
    ],
  },
  // The same rule, now confirmed.
  {
    layer: 'rule',
    start: 73.6,
    end: 83.6,
    rate: 0.8,
    push: 0.04,
    focus: [
      [0.7, 0.5],
      [0.75, 0.92],
    ],
  },
  {
    layer: 'test',
    start: 83.6,
    end: 101.6,
    rate: 0.3,
    push: 0.06,
    focus: [
      [0.4, 0.3],
      [0.5, 0.7],
    ],
  },
  {
    layer: 'hero',
    start: 101.6,
    end: 113.6,
    rate: 0.55,
    push: 0.05,
    focus: [
      [0.6, 0.3],
      [0.6, 0.8],
    ],
  },
  {
    layer: 'use',
    start: 113.6,
    end: 121.6,
    rate: 0.85,
    push: 0.05,
    focus: [
      [0.6, 0.35],
      [0.65, 0.65],
    ],
  },
  { layer: 'teachers', start: 121.6, end: 126.2, push: 0.03, focus: [centre, centre] },
  { layer: 'yc', start: 126.2, end: 132.2, push: 0.04, focus: [centre, centre] },
  {
    layer: 'diagram',
    start: 132.2,
    end: 140.6,
    push: 0.05,
    focus: [
      [0.3, 0.3],
      [0.6, 0.75],
    ],
  },
  {
    layer: 'share',
    start: 140.6,
    end: 150.8,
    rate: 0.95,
    push: 0.05,
    focus: [
      [0.3, 0.5],
      [0.72, 0.4],
    ],
  },
  { layer: 'hf', start: 150.8, end: 156.0, push: 0.03, focus: [centre, centre] },
  {
    layer: 'hero',
    start: 156.0,
    end: 164.4,
    rate: 0.85,
    push: 0.04,
    focus: [
      [0.6, 0.35],
      [0.55, 0.6],
    ],
  },
  { layer: 'end', start: 164.4, end: 170.4, push: 0.03, focus: [centre, centre] },
];

export const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));

/** Slow in, slow out. */
export const ease = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(p));

/** The scene a layer is in at `t`: the last of its scenes that has started. */
export function sceneFor(layer: LayerId, t: number): Scene | undefined {
  let found: Scene | undefined;
  for (const scene of SCENES) if (scene.layer === layer && scene.start <= t) found = scene;
  return found;
}

/** How visible a scene is, and how far it has slid from where it rests: in from below, out upward. */
export function visibility(scene: Scene, t: number): { opacity: number; slide: number } {
  // The old picture is nearly gone by the time the new one is half in, so two screens of text are
  // never on top of each other for long.
  const coming = scene.start === 0 ? 1 : ease((t - scene.start - FADE * 0.3) / (FADE * 0.7));
  const going = 1 - ease((t - scene.end) / (FADE * 0.6));
  return { opacity: coming * going, slide: (1 - coming) * SLIDE - (1 - going) * SLIDE };
}

/** Where a scene's own animations are, in ms: what the mock would show that long after it began. */
export function animationTime(scene: Scene, t: number): number {
  const seconds = (scene.rate ?? 1) * (t - scene.start);
  return Math.max(0, Math.min(seconds, scene.max ?? Infinity)) * 1000;
}

/** The camera at `t`: how far it has pushed in, and the point it pushes toward. */
export function camera(scene: Scene, t: number): { zoom: number; origin: Point } {
  const p = ease((t - scene.start) / (scene.end + FADE - scene.start));
  const [from, to] = scene.focus;
  return {
    zoom: 1 + scene.push * p,
    origin: [from[0] + (to[0] - from[0]) * p, from[1] + (to[1] - from[1]) * p],
  };
}

/** A thing arriving `at` seconds after its scene starts: how far it has come, from 0 to 1. */
export function arrival(scene: Scene, t: number, at: number, duration = 0.9): number {
  return ease((t - scene.start - at) / duration);
}

/** The cover over the whole frame: black as the film opens and as it closes. */
export function cover(t: number): number {
  return Math.max(1 - ease(t / 0.8), ease((t - (DURATION - 1)) / 1));
}
