import type { CSSProperties, ReactNode } from 'react';
import { ACADEMY, SPECIALISTS } from './data';
import { CounterexampleDrawer, DefinePage, TrainPage } from './pages-flow';
import { FieldPage, Fields, LabHome } from './pages-lab';
import { ComputePage, ExperimentPage, ModelsPage } from './pages-lab2';
import { GalleryCard, Terminal, WelcomePage, WorkspacePage } from './pages-more';
import {
  AgentRow,
  CHAT_AGENT,
  FlowHeader,
  ROW,
  SIDEBAR,
  Sidebar,
  WINDOW,
  type SidebarState,
} from './shell';
import { clamp, inOutCubic, inOutQuint, mix, outExpo, outQuart, span, ui } from './time';
import { LogoMark } from '@architect/ui';

/**
 * The Lab walkthrough: one window of Architect Lab that the camera moves over, its pages
 * changing as the app's do. It opens on the agents the Lab has made, which fly into the window's
 * sidebar, and closes by pulling back over every screen it showed. Everything is drawn from the
 * film's time alone.
 */

export const DURATION = 163;

/**
 * The cut is authored on one clock and played on another: each stretch of the authored time
 * below is played over a new length, so a beat can be given room for its narration without
 * moving every cue inside it. Everything in a stretch keeps moving, only slower or faster.
 */
const STRETCHES: readonly (readonly [number, number, number])[] = [
  [24.6, 43.5, 17.4],
  [59.6, 72.4, 15.2],
  [72.4, 83.3, 13.2],
  [84.6, 100.4, 17.3],
  [100.4, 114.0, 17.0],
  [114.0, 124.6, 12.5],
  [124.6, 143.2, 20.5],
  [143.2, 150.4, 8.0],
  [150.4, DURATION, 11.6],
];

/** The film's length as played, in seconds. */
export const RUNTIME = STRETCHES.reduce(
  (total, [from, to, length]) => total + length - (to - from),
  DURATION,
);

/** The authored time for a moment of the film as played. */
export function filmTime(played: number): number {
  let authored = 0;
  let clock = 0;
  for (const [from, to, length] of STRETCHES) {
    if (played < clock + (from - authored)) return authored + (played - clock);
    clock += from - authored;
    if (played < clock + length) return from + ((played - clock) / length) * (to - from);
    clock += length;
    authored = to;
  }
  return Math.min(DURATION, authored + (played - clock));
}

const FRAME = { width: 1920, height: 1080 } as const;

type PageId =
  | 'lab'
  | 'fields'
  | 'field'
  | 'define'
  | 'train'
  | 'experiment'
  | 'models'
  | 'compute'
  | 'workspace'
  | 'welcome';

type Mode = 'place' | 'flow' | 'chat' | 'bare';

interface PageSpan {
  id: PageId;
  at: number;
  mode: Mode;
  /** The place selected in the sidebar, or the flow's step. */
  place?: number;
  step?: number;
}

/** The pages in turn, and when each comes in. */
const PAGES: readonly PageSpan[] = [
  { id: 'lab', at: 12.0, mode: 'place', place: 0 },
  { id: 'fields', at: 24.6, mode: 'place', place: 1 },
  { id: 'field', at: 31.1, mode: 'place', place: 1 },
  { id: 'define', at: 43.5, mode: 'flow', step: 1 },
  { id: 'train', at: 58.8, mode: 'flow', step: 2 },
  { id: 'experiment', at: 84.6, mode: 'place', place: 2 },
  { id: 'models', at: 100.4, mode: 'place', place: 3 },
  { id: 'compute', at: 114.0, mode: 'place', place: 4 },
  { id: 'workspace', at: 124.6, mode: 'chat' },
  { id: 'welcome', at: 143.2, mode: 'bare' },
];

/** Moments inside pages, in film seconds. */
const MOMENT = {
  handoff: 10.8,
  drawerIn: 72.4,
  drawerOut: 83.3,
  panel: 102.5,
  allow: 134.6,
  terminalIn: 136.6,
  terminalOut: 142.6,
  choose: 147.5,
  wall: 150.4,
  lockup: 156.6,
} as const;

const pageAt = (id: PageId) => PAGES.find((page) => page.id === id)?.at ?? 0;

/** Rects of named parts of the window, measured once at build, in window pixels. */
export type Measured = ReadonlyMap<string, { x: number; y: number; w: number; h: number }>;

interface Framing {
  cx: number;
  cy: number;
  s: number;
}

const FULL: Framing = { cx: WINDOW.width / 2, cy: WINDOW.height / 2, s: 1.53 };
const FLOW: Framing = { cx: WINDOW.width / 2, cy: WINDOW.height / 2 + 2, s: 1.61 };
const WALL_GAP = { x: 150, y: 130 };
const WALL: Framing = { cx: WINDOW.width / 2, cy: WINDOW.height / 2, s: 0.47 };

function frameOf(measured: Measured, name: string, pad = 44, max = 1.85): Framing {
  const rect = measured.get(name);
  if (!rect) return FULL;
  const s = Math.min(FRAME.width / (rect.w + 2 * pad), FRAME.height / (rect.h + 2 * pad), max);
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, s };
}

interface Shot {
  at: number;
  dur: number;
  to: Framing | string;
  pad?: number;
  max?: number;
  ease?: (p: number) => number;
}

/** The camera's moves. Each travels to its framing, then holds with a slow drift until the next. */
const SHOTS: readonly Shot[] = [
  { at: 0, dur: 0, to: FULL },
  { at: 13.8, dur: 1.4, to: content(108, 2.0) },
  { at: 22.2, dur: 1.1, to: FULL },
  { at: 25.4, dur: 1.2, to: content(108) },
  { at: 29.8, dur: 0.9, to: FULL },
  { at: 32.0, dur: 1.3, to: content(98, 1.9) },
  { at: 41.4, dur: 1.0, to: FULL },
  { at: 43.6, dur: 0.9, to: FLOW },
  { at: 84.4, dur: 0.9, to: FULL },
  { at: 100.9, dur: 1.0, to: content(108) },
  { at: 102.5, dur: 1.0, to: FULL },
  { at: 114.9, dur: 1.2, to: content(108) },
  { at: 122.6, dur: 1.0, to: FULL },
  { at: 124.9, dur: 1.2, to: { cx: 258 + 480, cy: 250, s: 2.0 } },
  { at: 130.9, dur: 1.2, to: FULL },
  { at: 144.6, dur: 1.3, to: { cx: WINDOW.width / 2, cy: 305, s: 2.2 } },
  { at: MOMENT.wall, dur: 6.0, to: WALL, ease: inOutQuint },
];

/**
 * A push onto a place page's content: the frame's left edge falls in the gutter right of the
 * sidebar, so nothing is cut at the frame's edge, and its top sits in the gap above `top`.
 */
function content(top: number, s = 2.197): Framing {
  return { cx: 258 + FRAME.width / 2 / s, cy: top + FRAME.height / 2 / s, s };
}

/** Fixed framings inside the window that no single part names. */
function framed(measured: Measured, name: string, pad?: number, max?: number): Framing {
  return frameOf(measured, name, pad, max);
}

function camera(measured: Measured, t: number): Framing {
  let current = FULL;
  SHOTS.forEach((shot, index) => {
    if (t < shot.at) return;
    const next = SHOTS[index + 1];
    const last = !next;
    const target =
      typeof shot.to === 'string' ? framed(measured, shot.to, shot.pad, shot.max) : shot.to;
    const holdEnd = next ? next.at : DURATION;
    const at = Math.min(t, holdEnd);
    const p = shot.dur === 0 ? 1 : (shot.ease ?? inOutCubic)(span(at, shot.at, shot.dur));
    const from = current;
    // A held framing drifts in a little, so the frame is never quite still.
    const drift = last
      ? 1
      : 1 + 0.012 * span(at, shot.at + shot.dur, Math.max(0.1, holdEnd - shot.at - shot.dur));
    current = {
      cx: mix(from.cx, target.cx, p),
      cy: mix(from.cy, target.cy, p),
      s: Math.exp(mix(Math.log(from.s), Math.log(target.s), p)) * drift,
    };
  });
  return current;
}

const TERMINAL = { x: 430, y: 318, w: 690, h: 290 } as const;

interface Click {
  at: number;
  /** A part's name, measured, or a point in the window. */
  target: string | readonly [number, number];
}

const navPoint = (index: number): readonly [number, number] => [92, ROW.place(index) + 20];

const CLICKS: readonly Click[] = [
  { at: 24.4, target: navPoint(1) },
  { at: 30.9, target: 'academy-field' },
  { at: 43.3, target: 'open-job' },
  { at: 57.6, target: 'confirm' },
  { at: MOMENT.drawerOut - 0.15, target: [WINDOW.width - 45, 97] },
  { at: 84.4, target: [36, 28] },
  { at: 100.2, target: navPoint(3) },
  { at: MOMENT.panel - 0.1, target: 'academy-model' },
  { at: 113.8, target: navPoint(4) },
  { at: 124.4, target: [104, ROW.agent(CHAT_AGENT) + 20] },
  { at: MOMENT.allow, target: 'allow' },
  { at: MOMENT.choose, target: 'lab-edition' },
];

function pointOf(measured: Measured, target: Click['target']): readonly [number, number] {
  if (typeof target !== 'string') return target;
  const rect = measured.get(target);
  if (!rect) return [WINDOW.width / 2, WINDOW.height / 2];
  return [rect.x + Math.min(rect.w / 2, 150), rect.y + rect.h / 2];
}

function Cursor({ measured, t }: { measured: Measured; t: number }) {
  const index = CLICKS.findIndex((click) => t < click.at + 0.7);
  if (index < 0) return null;
  const click = CLICKS[index]!;
  if (t < click.at - 1.1) return null;
  const to = pointOf(measured, click.target);
  const previous = CLICKS[index - 1];
  const from =
    previous && click.at - previous.at < 3.2
      ? pointOf(measured, previous.target)
      : ([to[0] + 200, to[1] + 150] as const);
  const travel = span(t, click.at - 0.95, 0.83);
  const x = mix(from[0], to[0], outQuart(travel));
  const y = mix(from[1], to[1], inOutCubic(travel));
  const press = Math.sin(Math.PI * span(t, click.at - 0.04, 0.18));
  const shown = Math.min(
    outQuart(span(t, click.at - 1.1, 0.25)),
    1 - outQuart(span(t, click.at + 0.4, 0.3)),
  );
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      className="pointer-events-none absolute"
      style={{
        left: x - 4,
        top: y - 2,
        opacity: shown,
        transform: `scale(${1 - 0.14 * press})`,
        transformOrigin: '4px 2px',
        zIndex: 40,
        filter: 'drop-shadow(0 2px 6px rgb(0 0 0 / 0.5))',
      }}
      aria-hidden
    >
      <path
        d="M4 2 L4 19 L8.6 14.8 L11.6 21.4 L14.4 20.2 L11.4 13.7 L17.6 13.4 Z"
        fill="white"
        stroke="black"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The page on screen at `t`, and the one before it. */
function pageIndex(t: number): number {
  let found = 0;
  PAGES.forEach((page, index) => {
    if (page.at <= t) found = index;
  });
  return found;
}

const hasSidebar = (mode: Mode) => mode === 'place' || mode === 'chat';

/** How much of the sidebar is in: it slides away for the guided flow and the first screen. */
function sidebarShown(t: number): number {
  const index = pageIndex(t);
  const page = PAGES[index]!;
  const before = PAGES[index - 1];
  const was = before ? (hasSidebar(before.mode) ? 1 : 0) : 1;
  const is = hasSidebar(page.mode) ? 1 : 0;
  return mix(was, is, outQuart(span(t, page.at, 0.55)));
}

function fillTop(page: PageSpan): { top: number; height: number } {
  if (page.mode === 'chat') return { top: ROW.agent(CHAT_AGENT) + ROW.height, height: 36 };
  return { top: ROW.place(page.place ?? 0), height: ROW.height };
}

function sidebarState(t: number): SidebarState {
  const index = pageIndex(t);
  const page = PAGES[index]!;
  const before = PAGES[index - 1];
  const now = fillTop(page);
  const was = before && hasSidebar(before.mode) ? fillTop(before) : now;
  const p = ui(t, page.at - 0.12, 0.32);
  const landed = t >= MOMENT.handoff + 1.45;
  return {
    fillTop: mix(was.top, now.top, p),
    fillHeight: mix(was.height, now.height, p),
    fill: outQuart(span(t, 12.2, 0.4)),
    chat: outQuart(span(t, pageAt('workspace') - 0.1, 0.5)),
    agents: landed ? 1 : 0,
    rest: outQuart(span(t, 11.9, 0.7)),
  };
}

function renderPage(id: PageId, lt: number): ReactNode {
  switch (id) {
    case 'lab':
      return <LabHome lt={lt} />;
    case 'fields':
      return <Fields lt={lt} selected={ui(lt, 30.6 - pageAt('fields'), 0.2)} />;
    case 'field':
      return <FieldPage lt={lt} />;
    case 'define':
      return <DefinePage lt={lt} />;
    case 'train':
      return <TrainPage lt={lt} />;
    case 'experiment':
      return <ExperimentPage lt={lt} />;
    case 'models':
      return <ModelsPage lt={lt} panelAt={MOMENT.panel - pageAt('models')} />;
    case 'compute':
      return <ComputePage lt={lt} />;
    case 'workspace':
      return <WorkspacePage lt={lt} allowAt={MOMENT.allow - pageAt('workspace')} />;
    case 'welcome':
      return <WelcomePage lt={lt} chooseAt={MOMENT.choose - pageAt('welcome')} />;
  }
}

const FINAL = 999;

/** One window of the app. `still` draws a page in its finished state, as the wall at the end does. */
function AppWindow({
  t,
  still,
  measuring,
  style,
}: {
  t: number;
  still?: PageId;
  measuring?: boolean;
  style?: CSSProperties;
}) {
  const index = pageIndex(t);
  const shown = still
    ? still === 'define' || still === 'train' || still === 'welcome'
      ? 0
      : 1
    : sidebarShown(t);
  const sidebar = still
    ? {
        fillTop: fillTop(PAGES.find((page) => page.id === still)!).top,
        fillHeight: fillTop(PAGES.find((page) => page.id === still)!).height,
        fill: 1,
        chat: still === 'workspace' ? 1 : 0,
        agents: 1,
        rest: 1,
      }
    : measuring
      ? { fillTop: ROW.place(0), fillHeight: ROW.height, fill: 1, chat: 0, agents: 1, rest: 1 }
      : sidebarState(t);
  const flowPage = PAGES[index]!.mode === 'flow';
  const step =
    still === 'train' ? 2 : still === 'define' ? 1 : mix(1, 2, ui(t, pageAt('train'), 0.32));
  const flowShown = still
    ? still === 'define' || still === 'train'
      ? 1
      : 0
    : flowPage
      ? 1 - sidebarShown(t)
      : 0;
  const frame = outQuart(span(t, 11.0, 1.0));
  return (
    <div
      className="absolute overflow-hidden rounded-[14px] bg-ground"
      style={{
        width: WINDOW.width,
        height: WINDOW.height,
        boxShadow: `inset 0 0 0 1px rgb(255 255 255 / ${0.1 * (still || measuring ? 1 : frame)}), 0 30px 80px rgb(0 0 0 / ${0.5 * (still || measuring ? 1 : frame)})`,
        ...style,
      }}
    >
      {PAGES.map((page, i) => {
        const next = PAGES[i + 1];
        const left = hasSidebar(page.mode) ? SIDEBAR : 0;
        const top = page.mode === 'flow' ? 56 : 0;
        if (measuring || still) {
          if (still && still !== page.id) return null;
          return (
            <div
              key={page.id}
              data-page={page.id}
              className="absolute overflow-hidden"
              style={{ left, top, right: 0, bottom: 0 }}
            >
              {renderPage(page.id, FINAL)}
            </div>
          );
        }
        if (t < page.at - 0.01 || (next && t > next.at + 0.3)) return null;
        const enter = outQuart(span(t, page.at, 0.5));
        const leave = next ? outQuart(span(t, next.at, 0.3)) : 0;
        return (
          <div
            key={page.id}
            className="absolute overflow-hidden"
            style={{
              left: page.mode === 'flow' || page.mode === 'bare' ? 0 : SIDEBAR * shown,
              top,
              right: 0,
              bottom: 0,
              opacity: enter * (1 - leave),
              transform: `translateY(${(1 - enter) * 10}px)`,
            }}
          >
            {renderPage(page.id, t - page.at)}
          </div>
        );
      })}
      {(flowShown > 0 || measuring) && (
        <FlowHeader
          title={ACADEMY}
          step={step}
          style={{
            opacity: measuring ? 1 : flowShown,
            transform: `translateY(${(1 - flowShown) * -12}px)`,
          }}
        />
      )}
      <Sidebar
        state={sidebar}
        style={{
          transform: `translateX(${(shown - 1) * SIDEBAR}px)`,
          opacity: shown,
        }}
      />
      {!still && !measuring && <Drawer t={t} />}
      {(still === 'train' || measuring) && <Drawer t={MOMENT.drawerIn + 20} hold />}
      {!still && !measuring && <TerminalLayer t={t} />}
    </div>
  );
}

function Drawer({ t, hold }: { t: number; hold?: boolean }) {
  const open = outExpo(span(t, MOMENT.drawerIn, 0.75));
  const close = hold ? 0 : outQuart(span(t, MOMENT.drawerOut, 0.45));
  if (open <= 0 || close >= 1) return null;
  return (
    <div
      data-frame="drawer"
      className="absolute bottom-3 right-3 top-[68px] w-[500px] overflow-hidden rounded-card bg-raised shadow-float"
      style={{
        transform: `translateX(${(1 - open + close) * 540}px)`,
        opacity: clamp(open * 3) * (1 - close),
        zIndex: 20,
      }}
    >
      <CounterexampleDrawer lt={t - MOMENT.drawerIn} />
    </div>
  );
}

function TerminalLayer({ t }: { t: number }) {
  const open = outExpo(span(t, MOMENT.terminalIn, 0.8));
  const close = outQuart(span(t, MOMENT.terminalOut, 0.45));
  if (open <= 0 || close >= 1) return null;
  return (
    <div
      className="absolute"
      style={{
        left: TERMINAL.x,
        top: TERMINAL.y,
        width: TERMINAL.w,
        height: TERMINAL.h,
        transform: `translateY(${(1 - open) * 90 + close * 60}px)`,
        opacity: clamp(open * 2) * (1 - close),
        zIndex: 30,
      }}
    >
      <Terminal lt={t - MOMENT.terminalIn} />
    </div>
  );
}

/** The opening: a line, and the agents the Lab has made, which fly into the sidebar. */
const GALLERY = { y: 196, h: 344, gap: 20, x: 0, w: 1150 } as const;
const cardWidth = (GALLERY.w - 3 * GALLERY.gap) / 4;
/** The card's name row is the sidebar's agent row, drawn larger; it shrinks into its place. */
const HEADER_SCALE = 1.7;

function Opening({ t }: { t: number }) {
  if (t >= MOMENT.handoff + 1.45) return null;
  const words = 'The training system for your own AI.'.split(' ');
  return (
    <>
      <h1
        className="absolute m-0 flex gap-[0.26em] font-display text-[56px] font-semibold leading-[1.1] tracking-[-0.03em]"
        style={{ left: GALLERY.x, top: 44 }}
      >
        {words.map((word, index) => {
          const enter = outExpo(span(t, 0.7 + index * 0.12, 0.9));
          const leave = inOutCubic(span(t, MOMENT.handoff - 0.6 + index * 0.04, 0.5));
          return (
            <span key={index} className="inline-block overflow-hidden pb-[0.08em]">
              <span
                className="inline-block"
                style={{ transform: `translateY(${(1 - enter) * 105 - leave * 105}%)` }}
              >
                {word}
              </span>
            </span>
          );
        })}
      </h1>
      {SPECIALISTS.map((agent, index) => {
        const slot = GALLERY.x + index * (cardWidth + GALLERY.gap);
        const stack = GALLERY.x + 1.5 * (cardWidth + GALLERY.gap);
        // The cards are dealt from one stack in the middle out to their places.
        const arrive = outQuart(span(t, 2.9, 0.7));
        const deal = outExpo(span(t, 3.3 + Math.abs(index - 1.5) * 0.12, 1.1));
        const flight = inOutCubic(span(t, MOMENT.handoff + index * 0.09, 1.15));
        const rowTop = ROW.agent(index);
        const cardX = mix(stack, slot, deal);
        const cardY = GALLERY.y + (1 - arrive) * 40;
        const k = mix(HEADER_SCALE, 1, flight);
        const z = 10 - Math.abs(Math.round(index - 1.5));
        return (
          <div key={agent.name}>
            <div
              className="absolute overflow-hidden rounded-card bg-card shadow-edge"
              style={{
                left: mix(cardX, 12, flight),
                top: mix(cardY, rowTop, flight),
                width: mix(cardWidth, SIDEBAR - 24, flight),
                height: mix(GALLERY.h, ROW.height, flight),
                opacity: arrive * (1 - clamp(flight / 0.55)),
                zIndex: z,
              }}
            >
              <div
                style={{ width: cardWidth, height: GALLERY.h, opacity: 1 - clamp(flight / 0.3) }}
              >
                <GalleryCard agent={agent} lt={t - 4.6 - index * 0.15} />
              </div>
            </div>
            <div
              className="absolute"
              style={{
                left: mix(cardX + 6, 12, flight),
                top: mix(cardY + 14, rowTop, flight),
                width: SIDEBAR - 24,
                transform: `scale(${k})`,
                transformOrigin: '0 0',
                opacity: arrive,
                zIndex: z,
              }}
            >
              <AgentRow name={agent.name} />
            </div>
          </div>
        );
      })}
    </>
  );
}

/** The wall at the end: every screen the film showed, around the window, finished. */
const WALL_PAGES: readonly (readonly [PageId, number, number])[] = [
  ['lab', -1, -1],
  ['field', 0, -1],
  ['define', 1, -1],
  ['train', -1, 0],
  ['experiment', 1, 0],
  ['models', -1, 1],
  ['compute', 0, 1],
  ['workspace', 1, 1],
];

function Wall({ t }: { t: number }) {
  if (t < MOMENT.wall - 0.2) return null;
  return (
    <>
      {WALL_PAGES.map(([id, col, row]) => (
        <AppWindow
          key={id}
          t={t}
          still={id}
          style={{
            left: col * (WINDOW.width + WALL_GAP.x),
            top: row * (WINDOW.height + WALL_GAP.y),
          }}
        />
      ))}
    </>
  );
}

function Lockup({ t }: { t: number }) {
  const p = outExpo(span(t, MOMENT.lockup + 0.5, 1.4));
  if (t < MOMENT.lockup) return null;
  const veil = outQuart(span(t, MOMENT.lockup, 1.2));
  return (
    <>
      <div className="absolute inset-0 bg-ground" style={{ opacity: 0.86 * veil, zIndex: 50 }} />
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-10"
        style={{ zIndex: 51 }}
      >
        <span
          className="flex items-center gap-8"
          style={{ opacity: p, transform: `translateY(${(1 - p) * 24}px)` }}
        >
          <LogoMark size={120} />
          <span className="font-display text-[124px] font-semibold leading-none tracking-[-0.03em]">
            Architect
          </span>
        </span>
        <span
          className="font-sans text-[40px] font-medium leading-none"
          style={rise2(t, MOMENT.lockup + 1.5)}
        >
          echoo19.github.io/architect
        </span>
      </div>
    </>
  );
}

function rise2(t: number, at: number): CSSProperties {
  const p = outExpo(span(t, at, 1.2));
  return { opacity: p, transform: `translateY(${(1 - p) * 16}px)` };
}

export function LabFilm({
  t,
  measured,
  measuring,
}: {
  t: number;
  measured: Measured;
  measuring?: boolean;
}) {
  const view = measuring ? { cx: 0, cy: 0, s: 1 } : camera(measured, t);
  const cover = measuring
    ? 0
    : Math.max(1 - outQuart(t / 0.9), inOutCubic(span(t, DURATION - 1.1, 1.0)));
  return (
    <>
      <div
        id="world"
        className="absolute left-0 top-0"
        style={{
          transformOrigin: '0 0',
          transform: measuring
            ? 'none'
            : `translate(${FRAME.width / 2}px, ${FRAME.height / 2}px) scale(${view.s}) translate(${-view.cx}px, ${-view.cy}px)`,
        }}
      >
        <Wall t={measuring ? 0 : t} />
        <div
          id="window"
          className="absolute left-0 top-0"
          style={{ width: WINDOW.width, height: WINDOW.height }}
        >
          <AppWindow t={t} measuring={measuring} />
          {!measuring && <Opening t={t} />}
          {!measuring && <Cursor measured={measured} t={t} />}
        </div>
      </div>
      {!measuring && <Lockup t={t} />}
      <div
        className="absolute inset-0 bg-ground"
        style={{ opacity: cover, zIndex: 60, pointerEvents: 'none' }}
      />
    </>
  );
}
