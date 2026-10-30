import {
  animationTime,
  arrival,
  camera,
  clamp,
  cover,
  DURATION,
  ease,
  sceneFor,
  visibility,
  type LayerId,
  type Scene,
} from './timeline';

/**
 * Draws the frame for a time. The renderer calls `window.__seek(t)` for every frame it wants, and
 * the result depends on `t` alone: each layer's opacity, slide and camera are computed from it, a
 * mock's CSS animations are set to the time they would have reached, and nothing runs on its own
 * clock.
 */

declare global {
  interface Window {
    __duration: number;
    __seek: (t: number) => void;
    __ready: boolean;
    __cues: unknown[];
  }
}

/** The room a laid-out picture may take in the frame, in pixels. */
const MAX_WIDTH = 1700;
const MAX_HEIGHT = 930;

/** The layers that are mocks of the product, whose own animations the film plays. */
const MOCKS: ReadonlySet<LayerId> = new Set([
  'rule',
  'describe',
  'ask',
  'train',
  'test',
  'hero',
  'use',
  'share',
]);

/** When the final test's rows are the one being talked about, in film seconds, by row. */
const FOREST_FOCUS = [
  [16, 24],
  [9.6, 15],
  [25, 30],
] as const;

function place(el: HTMLElement, progress: number, rise = 18) {
  el.style.opacity = String(progress);
  el.style.translate = `0 ${(1 - progress) * rise}px`;
}

/** Things that arrive a moment after their scene starts, each on the cue written on it. */
function arrivals(layer: HTMLElement, scene: Scene, t: number) {
  for (const el of layer.querySelectorAll<HTMLElement>('[data-at]')) {
    const from = Number(el.dataset.from ?? 0);
    if (from > scene.start + 0.01) {
      el.style.opacity = '0';
      continue;
    }
    place(el, arrival(scene, t, Number(el.dataset.at)));
  }
}

/** The final test's rows come in one by one, and the one being talked about is picked out. */
function forest(layer: HTMLElement, scene: Scene, t: number) {
  const rows = layer.querySelector('figure')?.children;
  if (!rows) return;
  FOREST_FOCUS.forEach(([from, to], index) => {
    const row = rows[index] as HTMLElement | undefined;
    if (!row) return;
    place(row, arrival(scene, t, 0.3 + index * 0.35), 10);
    const lit = ease((t - from) / 0.5) * (1 - ease((t - to) / 0.5));
    // The band reaches a little beyond the row's ends, so the words do not sit on its edge.
    const band = `rgb(255 255 255 / ${0.08 * lit})`;
    row.style.borderRadius = '12px';
    row.style.backgroundColor = band;
    row.style.boxShadow = `-18px 0 0 ${band}, 18px 0 0 ${band}`;
  });
  const axis = rows[FOREST_FOCUS.length] as HTMLElement | undefined;
  if (axis) place(axis, arrival(scene, t, 1.4), 0);
  const note = layer.querySelector('figure > p') as HTMLElement | null;
  if (note) place(note, arrival(scene, t, 1.6), 0);
}

/** The diagram's three parts come in in turn. */
function diagram(layer: HTMLElement, scene: Scene, t: number) {
  const parts = layer.querySelector('[data-diagram]')?.firstElementChild?.children;
  if (!parts) return;
  [0.4, 2.4, 5.2].forEach((at, index) => {
    const part = parts[index] as HTMLElement | undefined;
    if (part) place(part, arrival(scene, t, at, 1.1), 14);
  });
}

/** Sets every animation of a mock to the time it would have reached `ms` after its start. */
function playTo(layer: HTMLElement, ms: number) {
  const stage = layer.querySelector<HTMLElement>('.stage');
  if (!stage) return;
  stage.setAttribute('data-played', '');
  for (const animation of stage.getAnimations({ subtree: true })) {
    animation.pause();
    animation.currentTime = ms;
  }
}

/** Waits for what the frames are drawn from: the faces and the logos. */
async function assets() {
  await document.fonts.ready;
  await Promise.all([
    document.fonts.load('400 16px "Inter Variable"', 'Aa0'),
    document.fonts.load('500 16px "Inter Variable"', 'Aa0'),
    document.fonts.load('600 40px "Inter Tight Variable"', 'Aa0'),
    document.fonts.load('400 14px "Geist Mono Variable"', 'Aa0'),
  ]);
  await Promise.all([...document.images].map((image) => image.decode().catch(() => undefined)));
  await document.fonts.ready;
  await new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  );
}

export function install() {
  const layers = new Map<LayerId, HTMLElement>();
  for (const el of document.querySelectorAll<HTMLElement>('[data-layer]')) {
    layers.set(el.dataset.layer as LayerId, el);
  }
  const cams = new Map<LayerId, HTMLElement>();
  const fit = new Map<LayerId, number>();
  for (const [id, layer] of layers) {
    const cam = layer.querySelector<HTMLElement>('.film-cam');
    if (!cam) continue;
    cams.set(id, cam);
    // A mock or chart is laid out at its own width and scaled to take the room it is given.
    if (cam.hasAttribute('data-fit')) {
      fit.set(id, Math.min(MAX_WIDTH / cam.offsetWidth, MAX_HEIGHT / cam.offsetHeight));
    }
  }
  const veil = document.getElementById('film-cover');

  window.__duration = DURATION;
  window.__cues = [];
  window.__ready = false;
  window.__seek = (time: number) => {
    const t = clamp(time, 0, DURATION);
    for (const [id, layer] of layers) {
      const scene = sceneFor(id, t);
      const shown = scene ? visibility(scene, t) : { opacity: 0, slide: 0 };
      layer.style.opacity = String(shown.opacity);
      layer.style.visibility = shown.opacity > 0 ? 'visible' : 'hidden';
      layer.style.transform = `translateY(${shown.slide}px)`;
      const cam = cams.get(id);
      if (!scene || shown.opacity <= 0 || !cam) continue;

      const look = camera(scene, t);
      cam.style.scale = String(fit.get(id) ?? 1);
      const view = cam.firstElementChild as HTMLElement;
      view.style.scale = String(look.zoom);
      view.style.transformOrigin = `${look.origin[0] * 100}% ${look.origin[1] * 100}%`;

      if (MOCKS.has(id)) playTo(layer, animationTime(scene, t));
      else if (id === 'forest') forest(layer, scene, t);
      else if (id === 'diagram') diagram(layer, scene, t);
      else arrivals(layer, scene, t);
    }
    if (veil) veil.style.opacity = String(cover(t));
  };

  window.__seek(0);
  void assets().then(() => {
    window.__seek(0);
    window.__ready = true;
  });
}
