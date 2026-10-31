import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MotionProvider } from '@architect/ui';
import { filmTime, LabFilm, playedTime, WALKTHROUGH, type Measured } from './film';
import { WHY_FROM, WHY_LENGTH, WhyScene } from './why';
import './lab.css';

/**
 * The Lab walkthrough's page for the renderer. `window.__seek(t)` draws the frame for a time by
 * rendering the film for that time at once; the spinners' own animations are set to that time
 * too, so nothing on the page runs on its own clock.
 */

declare global {
  interface Window {
    __duration: number;
    __seek: (t: number) => void;
    __ready: boolean;
  }
}

/** The film's length as played: the walkthrough, and the why scene inside it. */
const RUNTIME = WALKTHROUGH + WHY_LENGTH;
/** When the why scene starts, in the film as played. */
const WHY_AT = playedTime(WHY_FROM);

const host = document.getElementById('root');
if (!host) throw new Error('The page has no #root element.');
const root = createRoot(host);

/** The frame for a moment of the film as played: the why scene, or the walkthrough around it. */
function scene(played: number, measured: Measured) {
  if (played >= WHY_AT && played < WHY_AT + WHY_LENGTH) {
    return <WhyScene t={played - WHY_AT} measured={measured} />;
  }
  const walked = played < WHY_AT ? played : played - WHY_LENGTH;
  return <LabFilm t={filmTime(walked)} measured={measured} />;
}

function draw(played: number, measured: Measured, measuring = false) {
  flushSync(() => {
    root.render(
      <MotionProvider instant>
        {measuring ? <LabFilm t={0} measured={measured} measuring /> : scene(played, measured)}
      </MotionProvider>,
    );
  });
  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = played * 1000;
  }
}

/** Where each named part of the window sits, read once with the camera still. */
function measure(): Measured {
  const frame = document.getElementById('window')?.getBoundingClientRect();
  const found = new Map<string, { x: number; y: number; w: number; h: number }>();
  if (!frame) return found;
  for (const el of document.querySelectorAll<HTMLElement>('[data-frame], [data-click]')) {
    const name = el.dataset.frame ?? el.dataset.click;
    if (!name || found.has(name)) continue;
    const rect = el.getBoundingClientRect();
    found.set(name, {
      x: rect.left - frame.left,
      y: rect.top - frame.top,
      w: rect.width,
      h: rect.height,
    });
  }
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
// The renderer waits for the returned promise: one painted frame after the new state, so a large
// scroll is never captured from the frame before it.
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
