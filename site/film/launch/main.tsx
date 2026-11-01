import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MotionProvider, TooltipProvider } from '@architect/ui';
import type { Measured } from '../lab/film';
import { smoothMap } from '../lab/time';
import { RUNTIME, TIMING } from './cues';
import { LaunchFilm, MeasuringFilm } from './film';
import './launch.css';

/**
 * The launch film's page for the renderer. `window.__seek(t)` draws the frame for a time as
 * played: the time goes through TIMING to the film's authored clock, and the film is drawn for
 * that moment at once. The spinners' own animations are set to the time too, so nothing on the
 * page runs on its own clock.
 */

declare global {
  interface Window {
    __duration: number;
    __seek: (t: number) => void;
    __ready: boolean;
  }
}

const authored = smoothMap(TIMING);

const host = document.getElementById('root');
if (!host) throw new Error('The page has no #root element.');
const root = createRoot(host);

function draw(played: number, measured: Measured, measuring = false) {
  flushSync(() => {
    root.render(
      <MotionProvider instant>
        {/* The info tips' tooltips never open in the film, but each needs its provider. */}
        <TooltipProvider>
          {measuring ? <MeasuringFilm /> : <LaunchFilm t={authored(played)} measured={measured} />}
        </TooltipProvider>
      </MotionProvider>,
    );
  });
  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = played * 1000;
  }
}

type Rect = { x: number; y: number; w: number; h: number };

/** Parts the film moves to that carry no name of their own, found by where they sit. */
const FOUND: readonly (readonly [string, string])[] = [
  ['running', '[data-page="lab"] .grid > div:last-child'],
  ['panel', '[data-page="models"] aside'],
];

/** Where each named part of the window sits, read once with the camera still. */
function measure(): Measured {
  const frame = document.getElementById('window')?.getBoundingClientRect();
  const found = new Map<string, Rect>();
  if (!frame) return found;
  const put = (name: string, el: Element | null | undefined) => {
    if (!el || found.has(name)) return;
    const rect = el.getBoundingClientRect();
    found.set(name, {
      x: rect.left - frame.left,
      y: rect.top - frame.top,
      w: rect.width,
      h: rect.height,
    });
  };
  for (const el of document.querySelectorAll<HTMLElement>('[data-frame], [data-click]')) {
    const name = el.dataset.frame ?? el.dataset.click;
    if (name) put(name, el);
  }
  for (const [name, selector] of FOUND) put(name, document.querySelector(selector));
  // The plot's never-seen groups, and the track Harborview's taught arm lands on.
  const groups = document.querySelectorAll('[data-page="experiment"] figure [role="group"]');
  put('plot', groups[0]?.closest('section'));
  put('vault-card', document.querySelector('[data-frame="vault"]')?.closest('section'));
  put('hv-group', groups[1]);
  put('real-group', groups[2]);
  put('hv-track', groups[1]?.lastElementChild?.children[1]);
  return found;
}

async function fonts() {
  await Promise.all([
    document.fonts.load('400 16px "Inter Variable"', 'Aa0'),
    document.fonts.load('500 16px "Inter Variable"', 'Aa0'),
    document.fonts.load('600 16px "Inter Variable"', 'Aa0'),
    document.fonts.load('600 40px "Inter Tight Variable"', 'Aa0'),
    document.fonts.load('400 14px "Geist Mono Variable"', 'Aa0'),
    document.fonts.load('500 14px "Geist Mono Variable"', 'Aa0'),
  ]);
  await document.fonts.ready;
}

let measured: Measured = new Map();
window.__duration = RUNTIME;
window.__ready = false;
// The renderer waits for the returned promise: one painted frame after the new state.
window.__seek = (time: number) => {
  draw(Math.min(RUNTIME, Math.max(0, time)), measured);
  return new Promise<void>((done) => requestAnimationFrame(() => done()));
};

void fonts().then(() => {
  draw(0, measured, true);
  measured = measure();
  draw(0, measured);
  window.__ready = true;
});
