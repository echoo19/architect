import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MotionProvider, TooltipProvider } from '@architect/ui';
import type { Measured } from '../lab/film';
import { smoothMap } from '../lab/time';
import { PREROLL, RUNTIME, TIMING } from './cues';
import { LaunchFilm, MeasuringFilm } from './film';
import { RESEARCH_IMAGE } from './wsp';
import './launch.css';

/**
 * The launch film's page for the renderer. `window.__seek(t)` draws the frame for a time as
 * played: the time goes through TIMING to the film's authored clock, and the film is drawn for
 * that moment at once. The spinners' own animations are set to the time too, so nothing on the
 * page runs on its own clock. The page starts PREROLL seconds before the film's own start, on the
 * founder clip's last frames, so a render of it joins the clip at that point.
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
  ['brief-rules', '[data-frame="brief"] > div:nth-child(2)'],
  ['brief-differ', '[data-frame="brief"] > div:nth-child(3)'],
  ['panel', '[data-page="models"] aside'],
  ['editions-pair', '[data-page="welcome"] [data-frame="editions"] > div.grid'],
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
  // The sealed academy's card title, which grows into Harborview Prep's figure.
  put(
    'vault-title',
    document.querySelector('[data-frame="vault"]')?.closest('section')?.querySelector('h2'),
  );
  return found;
}

/** The founder clip's frames and his last line's caption (intro/tail.mjs), decoded before the first frame is drawn. */
const FOUNDER_FRAMES = 116;

async function founder() {
  const files = [
    ...Array.from({ length: FOUNDER_FRAMES }, (_, k) => `${String(k).padStart(4, '0')}.jpg`),
    'caption.png',
  ];
  const research = new Image();
  research.src = RESEARCH_IMAGE;
  await research.decode();
  await Promise.all(
    files.map((file) => {
      const image = new Image();
      image.src = `./founder/${file}`;
      return image.decode();
    }),
  );
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
window.__duration = PREROLL + RUNTIME;
window.__ready = false;
// The renderer waits for the returned promise: the founder's frame decoded, then one painted
// frame after the new state.
window.__seek = async (time: number) => {
  draw(Math.min(RUNTIME, Math.max(-PREROLL, time - PREROLL)), measured);
  const frame = document.querySelector<HTMLImageElement>('img[data-founder]');
  if (frame) await frame.decode();
  return new Promise<void>((done) => requestAnimationFrame(() => done()));
};

void Promise.all([fonts(), founder()]).then(() => {
  draw(0, measured, true);
  measured = measure();
  draw(0, measured);
  window.__ready = true;
});
