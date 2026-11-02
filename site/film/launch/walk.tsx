import type { ReactNode } from 'react';
import { Pointer, type Framing, type Measured } from '../lab/film';
import { CounterexampleDrawer, DefinePage } from '../lab/pages-flow';
import { FieldPage, Fields, LabHome } from '../lab/pages-lab';
import { IN, inEase, OUT, outEase, WHIPS, type Whip } from './chapters';
import { ModelsPage } from '../lab/pages-lab2';
import { WelcomePage, WorkspacePage } from '../lab/pages-more';
import { CHAT_AGENT, ROW, TEAM_ROW, WINDOW, type SidebarState } from '../lab/shell';
import { TeamChatPage } from '../lab/team';
import {
  clamp,
  inOutCubic,
  inOutQuint,
  mix,
  outExpo,
  outQuart,
  smoothMap,
  span,
  ui,
} from '../lab/time';
import {
  CERTIFICATE,
  COUNTEREXAMPLE_TASK,
  FIELD_ACTIVITY,
  INVENTORY_SCORES,
  FIRST_ROUND,
  SHOW_OPEN_TEACHER,
} from './data';
import { FINE_TUNE_AT, FineTunePage } from './finetune';
import { HarnessDrawer } from './harness';
import { OnPremisePage } from './home';
import type { Layer, Mode, ScreenView } from './screen';
import { DURATION, T } from './timeline';
import { TrainPage } from './train';

/**
 * The walkthrough part of the launch film: one window of Architect Lab, its pages changing as the
 * app's do, under a camera that moves more boldly than the walkthrough's (whips on the cuts, dives
 * into a figure, pushes into a detail and back). The pages are the walkthrough's own and a few
 * built for this film from the app's screens; this says when each comes in and how its own time
 * runs, cut tight to the script.
 */

const FRAME = { width: 1920, height: 1080 } as const;

/** A sidebar fill's place: its top and height. */
type Fill = readonly [number, number];
const place = (index: number): Fill => [ROW.place(index), ROW.height];
const TEAM_CHAT: Fill = [TEAM_ROW.chat, TEAM_ROW.chatHeight];
const ACADEMY_ROW: Fill = [ROW.agent(CHAT_AGENT), ROW.height];
const ACADEMY_CHAT: Fill = [ROW.agent(CHAT_AGENT) + ROW.height, 36];

interface PageSpan {
  key: string;
  at: number;
  mode: Mode;
  fill: Fill;
  /** The page, from its own time; `still` draws it unscrolled, to be measured. */
  draw: (lt: number, t: number, still?: boolean) => ReactNode;
  /** [film seconds from `at`, the page's own seconds]: how the page's time runs. */
  clock?: readonly (readonly [number, number])[];
  /** Swapped in at once, out of sight under a figure that fills the frame. */
  cut?: boolean;
}

const local = (pairs: readonly (readonly [number, number])[]) => smoothMap(pairs);

/**
 * How far Define has scrolled, in its own time: further than the walkthrough's first scroll, so
 * the passages open in view, then on to Confirm. It ends where the walkthrough's does.
 */
function defineScroll(lt: number): number {
  return (
    mix(0, BRIEF_SCROLL, inOutCubic(span(lt, 4.2, 2.6))) +
    mix(0, 860 - BRIEF_SCROLL, inOutCubic(span(lt, 10.2, 2.9)))
  );
}
const BRIEF_SCROLL = 640;

/** How far a table page has got by the time it comes in: its rows are already rising. */
const ROWS_IN = 0.3;

/** Allow once on the academy desk's write, in the workspace page's own time. */
const ALLOW_AT = 9.4;

/** When the field, the team's chat and the fine-tune come in. */
const FIELD_AT = T.fields + 0.5;
const TEAM_AT = T.teamClick - 0.2;
const COMPUTE_AT = T.compute - 0.4;
/** Models comes in under the figures' ground; its panel opens as the window flies back in onto it. */
const MODELS_AT = T.models - 0.7;

/** The chat pushes in over the home as the camera moves onto it. */
const CHAT_AT = T.intoChat - 0.9;

/** The window glides out for the lockup, its line rising as it goes (ending.tsx). */
export const LOCKUP_OUT = T.ownAI - 0.95;

const PAGES: readonly PageSpan[] = [
  {
    key: 'lab',
    // In before the window comes into view beside the requests, so it never arrives empty.
    at: T.toLab - 0.6,
    mode: 'place',
    fill: place(0),
    draw: (lt, t) => (
      <LabHome
        lt={lt}
        score={FIRST_ROUND}
        hover={ui(t, T.labHover, 0.15) - ui(t, T.labHover + 3.6, 0.2)}
      />
    ),
  },
  {
    // In while the window is away, its organizations already risen.
    key: 'field',
    at: FIELD_AT,
    mode: 'place',
    fill: place(1),
    cut: true,
    draw: (lt) => <FieldPage lt={lt} />,
    clock: [
      [0, 1.2],
      [T.field - FIELD_AT, 1.6],
      [T.field - FIELD_AT + 2.9, 3.4],
      [T.vault - FIELD_AT, 5.4],
      [20, 21.4],
    ],
  },
  {
    key: 'define',
    at: T.define,
    mode: 'flow',
    fill: place(1),
    draw: (lt) => <DefinePage lt={lt} scroll={defineScroll(lt)} />,
    // It comes in with its job and the brief's first rows already there.
    clock: [
      [0, 1.0],
      [2.8, 2.8],
      [3.1, 4.2],
      [4.6, 6.8],
      [4.9, 7.6],
      [6.4, 9.4],
      [7.0, 10.2],
      [7.9, 13.1],
      [T.confirm - T.define, 13.9],
      [9.5, 15.2],
    ],
  },
  {
    key: 'train',
    at: T.train,
    mode: 'flow',
    fill: place(1),
    draw: (_lt, t) => <TrainPage t={t} />,
  },
  {
    key: 'vault',
    // It pushes in to land on the score's second drop, as "Then the vault opens" begins.
    at: T.vaultPage - 0.9,
    mode: 'place',
    fill: place(1),
    draw: (_lt, t) => <FieldPage lt={21} unlock={ui(t, T.opens, 0.35)} />,
  },
  {
    key: 'models',
    at: MODELS_AT,
    mode: 'place',
    fill: place(3),
    cut: true,
    draw: (lt) => (
      <ModelsPage
        lt={lt + ROWS_IN}
        panelAt={T.models - MODELS_AT + ROWS_IN}
        certificate={CERTIFICATE}
        row={0}
        basisOpen
      />
    ),
  },
  {
    // In beside the certificate's bound, before the camera turns to it, on Compute's own clock.
    key: 'finetune',
    at: COMPUTE_AT,
    mode: 'place',
    fill: place(4),
    draw: (lt, _t, still) => <FineTunePage lt={lt} still={still} />,
    clock: [
      [0, COMPUTE_AT - T.compute],
      [30, 30 + COMPUTE_AT - T.compute],
    ],
  },
  {
    key: 'beyond',
    at: T.beyond,
    mode: 'place',
    fill: place(1),
    cut: true,
    draw: (lt, t) => (
      <Fields
        lt={lt + ROWS_IN}
        selected={Math.min(ui(t, T.notJust + 1.2, 0.25), 1 - ui(t, T.labDesks, 0.35))}
        lab={ui(t, T.labDesks, 0.35)}
        when={FIELD_ACTIVITY}
        scores={{ 'Inventory desk': INVENTORY_SCORES }}
      />
    ),
  },
  {
    key: 'team',
    at: TEAM_AT,
    mode: 'place',
    fill: TEAM_CHAT,
    cut: true,
    draw: (lt) => <TeamChatPage t={lt} />,
    clock: [
      [0, 4.4],
      [T.asks - TEAM_AT, 5.05],
      [T.compounds - TEAM_AT, 6.5],
      [T.holds - 0.98 - TEAM_AT, 8.4],
      [T.holds - TEAM_AT, 10.3],
      [T.holds + 2.12 - TEAM_AT, 11.3],
    ],
  },
  {
    key: 'home',
    at: T.workspace,
    mode: 'place',
    fill: ACADEMY_ROW,
    cut: true,
    draw: (_lt, t) => <OnPremisePage t={t} />,
  },
  {
    key: 'workspace',
    at: CHAT_AT,
    mode: 'place',
    fill: ACADEMY_CHAT,
    draw: (lt) => <WorkspacePage lt={lt} allowAt={ALLOW_AT} />,
    // It opens on the reply already waiting for approval, and Allow once is pressed on its word.
    clock: [
      [0, 8.6],
      [T.saves - CHAT_AT, ALLOW_AT + 0.15],
      [T.saves - CHAT_AT + 2, ALLOW_AT + 2],
    ],
  },
  {
    key: 'welcome',
    at: T.welcome,
    mode: 'bare',
    fill: place(0),
    // It comes in with its welcome already risen.
    draw: (lt) => <WelcomePage lt={lt + 0.6} chooseAt={T.labEdition - T.welcome + 0.6} />,
  },
];

const CLOCKS = new Map(PAGES.map((page) => [page.key, page.clock ? local(page.clock) : null]));

/**
 * The guided flow's steps, Compute beside the certificate's bound, and the editions after the chat
 * come in as the app's stepper brings them: pushed in whole from the right, the page before going
 * out to the left.
 */
/** How long each pushed page takes to come in; the chat's while the camera holds the whole window. */
const PUSHED: Readonly<Record<string, number>> = {
  define: 0.9,
  train: 0.9,
  vault: 0.9,
  finetune: 0.9,
  workspace: 0.9,
  welcome: 0.9,
};
const pushed = (page: PageSpan | undefined, t: number) => {
  const dur = page && PUSHED[page.key];
  return page && dur ? inOutCubic(span(t, page.at, dur)) : null;
};

function pageIndex(t: number): number {
  let found = 0;
  PAGES.forEach((page, index) => {
    if (page.at <= t) found = index;
  });
  return found;
}

const hasSidebar = (mode: Mode) => mode === 'place';

/** The page's own time at a moment of the film. */
function pageTime(page: PageSpan, t: number): number {
  const clock = CLOCKS.get(page.key);
  return clock ? clock(t - page.at) : t - page.at;
}

function sidebarShown(t: number): number {
  const index = pageIndex(t);
  const page = PAGES[index]!;
  const before = PAGES[index - 1];
  const was = before ? (hasSidebar(before.mode) ? 1 : 0) : 1;
  const is = hasSidebar(page.mode) ? 1 : 0;
  return mix(was, is, outQuart(span(t, page.at, 0.55)));
}

/** How far the sidebar's list has scrolled down to the team: there for the team, back for Offline. */
function teamScroll(t: number): number {
  return inOutCubic(span(t, T.teamScroll, 0.65)) - inOutCubic(span(t, T.backScroll, 0.6));
}

function sidebarState(t: number): SidebarState {
  const index = pageIndex(t);
  const page = PAGES[index]!;
  const before = PAGES[index - 1];
  // The fill moves as the pointer presses, a little before the page it opens comes in.
  const lead = page.key === 'team' || page.key === 'home' ? 0.18 : 0.12;
  const p = ui(t, page.at - lead, 0.32);
  const was = before && hasSidebar(before.mode) ? before.fill : page.fill;
  return {
    fillTop: mix(was[0], page.fill[0], p),
    fillHeight: mix(was[1], page.fill[1], p),
    fill: 1,
    chat: outQuart(span(t, T.backScroll + 0.25, 0.5)),
    agents: 1,
    rest: 1,
    team: teamScroll(t),
  };
}

const DRAWER_CLOCK = local([
  [0, 0],
  [2.0, 2.0],
  [4.4, 2.7],
  [T.four - T.drawer, 3.1],
  [T.fixed - T.drawer, 6.0],
  [T.regression - T.drawer, 7.3],
  [T.drawerOut - T.drawer, 7.7],
  [12, 11.1],
]);

/** The round's drawer: on the harness through the rounds, then on the counterexample. */
function drawer(t: number): ScreenView['drawer'] {
  if (t < T.drawer - 0.5) {
    return {
      node: <HarnessDrawer lt={t - T.harness} />,
      open: outExpo(span(t, T.harness, 0.75)),
      close: outQuart(span(t, T.harnessOut, 0.45)),
    };
  }
  return {
    node: (
      <CounterexampleDrawer
        lt={DRAWER_CLOCK(t - T.drawer)}
        task={COUNTEREXAMPLE_TASK}
        rest={false}
        large
      />
    ),
    open: outExpo(span(t, T.drawer, 0.75)),
    close: outQuart(span(t, T.drawerOut, 0.45)),
  };
}

/** The window as it is at a moment of the walkthrough. */
export function walkView(t: number): ScreenView {
  const layers: Layer[] = [];
  PAGES.forEach((page, i) => {
    const next = PAGES[i + 1];
    if (t < page.at - 0.01) return;
    if (next && t > next.at + 0.35) return;
    if (next?.cut && t >= next.at) return;
    // A page goes quickly as the next rises, so the window is never left empty between them; a
    // pushed one goes out whole beside the next.
    const pushIn = pushed(page, t);
    const pushOut = pushed(next, t);
    const enter = page.cut || pushIn !== null ? 1 : outQuart(span(t, page.at + 0.06, 0.3));
    const leave = next && !next.cut && pushOut === null ? outQuart(span(t, next.at, 0.1)) : 0;
    layers.push({
      key: page.key,
      mode: page.mode,
      enter,
      leave,
      x: (1 - (pushIn ?? 1)) * WINDOW.width - (pushOut ?? 0) * WINDOW.width,
      node: page.draw(pageTime(page, t), t),
    });
  });
  const flowPage = PAGES[pageIndex(t)]!.mode === 'flow';
  return {
    layers,
    sidebar: sidebarState(t),
    sidebarShown: sidebarShown(t),
    flow: {
      shown: flowPage ? 1 - sidebarShown(t) : 0,
      step: mix(1, 2, ui(t, T.train, 0.32)),
    },
    drawer: drawer(t),
  };
}

/** Every page at its finished state, laid over each other, so their parts can be measured. */
export function measuringView(): ScreenView {
  return {
    layers: PAGES.map((page) => ({
      key: page.key,
      mode: page.mode,
      enter: 1,
      leave: 0,
      node: page.draw(999, 999, true),
    })),
    sidebar: {
      fillTop: ROW.place(0),
      fillHeight: ROW.height,
      fill: 1,
      chat: 0,
      agents: 1,
      rest: 1,
    },
    sidebarShown: 1,
    flow: { shown: 1, step: 2 },
    drawer: {
      node: <CounterexampleDrawer lt={20} task={COUNTEREXAMPLE_TASK} rest={false} large />,
      open: 1,
      close: 0,
    },
  };
}

/* The camera. */

export const FULL: Framing = { cx: WINDOW.width / 2, cy: WINDOW.height / 2, s: 1.53 };
const FLOW: Framing = { cx: WINDOW.width / 2, cy: WINDOW.height / 2 + 2, s: 1.61 };

/** A part of the window, framed whole with room around it; `dy` for a page scrolled since. */
export function frameOf(measured: Measured, name: string, pad = 44, max = 2.4, dy = 0): Framing {
  const rect = measured.get(name);
  if (!rect) return FULL;
  const s = Math.min(FRAME.width / (rect.w + 2 * pad), FRAME.height / (rect.h + 2 * pad), max);
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 - dy, s };
}

/**
 * The whole window at the frame's left, at full brightness, a figure on the ground at its
 * right: the window stays in frame, so the figure is always seen beside where it comes from.
 */
const SIDE: Framing = { cx: 1180, cy: WINDOW.height / 2, s: 0.78 };

/** The whole window at the frame's top left, the open teacher on the ground under and beside it. */
const OPEN_VIEW: Framing = { cx: 1154, cy: 641, s: 0.78 };

/**
 * The home's On-premise card, close: whole rows with the card's sides inside the frame. The frame's
 * top and bottom fall on the hairline between two rows, or just past the card's own edge, so no
 * row is ever cut and nothing of the next one shows.
 */
function onPremise(measured: Measured, top: string, bottom: string): Framing {
  const card = measured.get('home-premise');
  const first = measured.get(top);
  const last = measured.get(bottom);
  if (!card || !first || !last) return FULL;
  const margin = (y: number, edge: number) => (Math.abs(y - edge) < 1 ? 20 : 2);
  const from = first.y - margin(first.y, card.y);
  const end = last.y + last.h;
  const to = end + margin(end, card.y + card.h);
  const s = Math.min(FRAME.height / (to - from), PAGE_MAX);
  return { cx: card.x + card.w / 2, cy: (from + to) / 2, s };
}

/**
 * A place page's own area, between the sidebar's edge and the window's: framed at this scale or
 * closer, the frame holds only the page, its content centered with even margins.
 */
const PAGE = { left: 240, right: WINDOW.width, center: (240 + WINDOW.width) / 2 } as const;
const PAGE_MIN = 2.16;
/** The closest a single card is framed. */
const PAGE_MAX = 2.4;

/** The chat's column, its header's edge above it: its reply and the two writes it asks to make. */
const CHAT_VIEW: Framing = { cx: PAGE.center, cy: 45 + FRAME.height / 2 / 2.3, s: 2.3 };

/** Compute's title and its fine-tuning plan, centered, the memory card below out of frame. */
const COMPUTE_VIEW: Framing = { cx: PAGE.center, cy: 255, s: PAGE_MIN };

/** The field's two cards, its organizations and the chosen academy's, centered, under its tabs. */
const FIELD_VIEW: Framing = { cx: PAGE.center, cy: 395, s: 2.26 };

/** Fields' table, centered, its title above out of frame. */
const FIELDS_VIEW: Framing = { cx: PAGE.center, cy: 344, s: PAGE_MIN };

/** The whole window at the frame's right, the certificate's bound on the ground at its left. */
const CERT_VIEW: Framing = { cx: -29, cy: WINDOW.height / 2, s: 0.78 };

/** The Lab's window at the frame's right, most of the frame wide, the ground at its left. */
export const LAB_SIDE = { s: 1.04, cx: 1274 } as const;
const LAB_SIDE_VIEW: Framing = {
  cx: WINDOW.width / 2 - (LAB_SIDE.cx - FRAME.width / 2) / LAB_SIDE.s,
  cy: WINDOW.height / 2,
  s: LAB_SIDE.s,
};
/** The ground at the Lab's left, in window pixels: from the frame's margin to the window's edge. */
export const LAB_TYPE = {
  left: LAB_SIDE_VIEW.cx + (64 - FRAME.width / 2) / LAB_SIDE.s,
  width: 560 / LAB_SIDE.s,
} as const;

/** The two editions, whole and large: the pair of cards with room around them. */
const editions = (measured: Measured) => frameOf(measured, 'editions-pair', 70, 2.6);

/**
 * Closer on the training screen as the score lands: from its status line to the Rounds heading,
 * so the frame's edges fall in the space above and below them.
 */
export function trainScore(measured: Measured): Framing {
  const top = measured.get('train-status');
  const bottom = measured.get('train-rounds');
  if (!top || !bottom) return FULL;
  const from = top.y - 10;
  const to = bottom.y + bottom.h + 10;
  return { cx: WINDOW.width / 2, cy: (from + to) / 2, s: FRAME.height / (to - from) };
}

interface Shot {
  at: number;
  dur: number;
  to: Framing | ((measured: Measured) => Framing);
  ease?: (p: number) => number;
  /** A held framing drifts in a little; one a cut or a dive leaves from exactly does not. */
  still?: boolean;
}

/** Where the window is while it is away: just past the frame's left edge, then its right. */
const AWAY_LEFT: Framing = { cx: WINDOW.width / 2 + 1300, cy: WINDOW.height / 2, s: 1.53 };
const AWAY_RIGHT: Framing = { cx: WINDOW.width / 2 - 1300, cy: WINDOW.height / 2, s: 1.53 };

/** A whip (chapters.tsx): the window out to the left, then in from the right onto `to`. */
function whip(w: Whip, to: Shot['to']): Shot[] {
  return [
    { at: w.out, dur: OUT, to: AWAY_LEFT, ease: outEase, still: true },
    { at: w.in, dur: 0, to: AWAY_RIGHT, still: true },
    { at: w.in, dur: IN, to, ease: inEase },
  ];
}

const SHOTS: readonly Shot[] = [
  // 3. The Lab, at the frame's right, held while Spark and Glimmer are named beside it.
  { at: T.how, dur: 0, to: LAB_SIDE_VIEW },
  // 4. A field: its line, then the field's page whole, its title in, the sealed academy, the real one.
  ...whip(WHIPS.field, FIELD_VIEW),
  // 5. The study: the whole flow, then beside the window for where the academies differ.
  { at: T.define - 0.3, dur: 1.1, to: FLOW, ease: inOutCubic },
  { at: T.source - 0.8, dur: 1.1, to: SIDE, ease: inOutCubic },
  { at: T.confirm - 1.1, dur: 1.0, to: FLOW, ease: inOutCubic },
  // 6. The harness: the starting score, close; then beside the window, held through the
  // counterexample, one change and its test with the round's drawer open, then the final score.
  { at: T.train + 0.4, dur: 1.0, to: (m) => trainScore(m), ease: inOutCubic },
  { at: T.harness - 0.9, dur: 1.0, to: SIDE, ease: inOutCubic },
  // 7. The counterexample beside the window with its drawer open, then onto the field's cards.
  // 8. The vault opens: onto the sealed academy's card, whose lock opens and whose title grows
  // into the figure that fills the frame, the real academy's after it in the same place.
  { at: T.drawerOut, dur: 1.2, to: FIELD_VIEW, ease: inOutCubic },
  // 9. The window flies back in onto the certificate as its panel opens; the bound beside it, then
  // straight onto Compute's plan, and beside the window for the two jobs it sizes.
  { at: T.toModels, dur: 0, to: AWAY_RIGHT, still: true },
  { at: T.toModels, dur: IN, to: FULL, ease: inEase },
  { at: T.certHero - 1.0, dur: 1.5, to: CERT_VIEW, ease: inOutQuint },
  { at: T.compute - 0.3, dur: 1.0, to: COMPUTE_VIEW, ease: inOutQuint },
  { at: T.gpuTrained - 0.9, dur: 1.0, to: SIDE, ease: inOutCubic },
  ...(SHOW_OPEN_TEACHER ? [{ at: T.openBeat, dur: 1.3, to: OPEN_VIEW, ease: inOutQuint }] : []),
  // 10. Beyond academies: its line, then the screening lab's desks and Inventory desk's
  // never-seen figure beside the window; then the team's line, and its chat beside its three steps.
  ...whip(WHIPS.beyond, FIELDS_VIEW),
  { at: T.scienceDive - 0.9, dur: 1.0, to: SIDE, ease: inOutCubic },
  ...whip(WHIPS.team, LAB_SIDE_VIEW),
  // 11. Offline: its line, then Academy desk's On-premise card whole, its Offline row turning as
  // the network goes, its GPU, model and memory; then back to the whole window as its chat pushes
  // in, and onto the chat.
  ...whip(WHIPS.offline, (m) => onPremise(m, 'home-premise', 'home-offline')),
  { at: CHAT_AT - 0.6, dur: 0.9, to: FULL, ease: inOutCubic },
  { at: CHAT_AT + 0.4, dur: 1.1, to: CHAT_VIEW, ease: inOutCubic },
  // 12. The two editions, large, then the window glides out as the line rises for the lockup.
  { at: T.welcome - 0.5, dur: 1.0, to: FULL, ease: inOutCubic },
  { at: T.welcome + 0.5, dur: 1.1, to: editions, ease: inOutCubic },
  { at: LOCKUP_OUT, dur: OUT, to: AWAY_LEFT, ease: outEase, still: true },
];

export function camera(measured: Measured, t: number): Framing {
  let current = FULL;
  SHOTS.forEach((shot, index) => {
    if (t < shot.at) return;
    const next = SHOTS[index + 1];
    const target = typeof shot.to === 'function' ? shot.to(measured) : shot.to;
    const holdEnd = next ? next.at : DURATION;
    const at = Math.min(t, holdEnd);
    const p = shot.dur === 0 ? 1 : (shot.ease ?? inOutCubic)(span(at, shot.at, shot.dur));
    const from = current;
    const drift =
      shot.still || !next
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

/* The pointer. */

interface Click {
  at: number;
  target: string | readonly [number, number];
  /** How far the page under it has scrolled since it was measured. */
  dy?: number;
  /** A hover, held this long, with no press. */
  hover?: number;
  /** The pointer stays and goes straight on to the next click as its travel starts. */
  onward?: boolean;
}

const CLICKS: readonly Click[] = [
  { at: T.define - 0.15, target: 'open-job' },
  { at: T.confirm, target: 'confirm' },
  { at: T.drawerOut - 0.15, target: [WINDOW.width - 45, 97] },
  { at: T.compute + FINE_TUNE_AT.read, target: 'ft-read' },
  { at: T.compute + FINE_TUNE_AT.lora, target: 'ft-lora' },
  { at: T.saves - 0.15, target: 'allow' },
  { at: T.labEdition, target: 'lab-edition' },
];

function pointOf(measured: Measured, click: Click): readonly [number, number] {
  const { target } = click;
  if (typeof target !== 'string') return target;
  const rect = measured.get(target);
  if (!rect) return [WINDOW.width / 2, WINDOW.height / 2];
  return [rect.x + Math.min(rect.w / 2, 150), rect.y + rect.h / 2 - (click.dy ?? 0)];
}

export function Cursor({ measured, t }: { measured: Measured; t: number }) {
  // A pointer that goes on leaves once its press is done, or when the next travel would start.
  const until = (click: Click, index: number) => {
    const next = CLICKS[index + 1];
    return click.onward && next
      ? Math.max(next.at - 0.85, click.at + 0.2)
      : click.at + (click.hover ?? 0) + 0.7;
  };
  const index = CLICKS.findIndex((click, i) => t < until(click, i));
  if (index < 0) return null;
  const click = CLICKS[index]!;
  if (t < click.at - 1.0) return null;
  const to = pointOf(measured, click);
  const previous = CLICKS[index - 1];
  const close = previous !== undefined && click.at - previous.at < 2.6;
  const from = close ? pointOf(measured, previous) : ([to[0] + 170, to[1] + 130] as const);
  const start = close && previous.onward ? until(previous, index - 1) : click.at - 0.85;
  const travel = span(t, start, click.at - 0.1 - start);
  const x = mix(from[0], to[0], outQuart(travel));
  const y = mix(from[1], to[1], inOutCubic(travel));
  const press = click.hover ? 0 : Math.sin(Math.PI * span(t, click.at - 0.04, 0.18));
  // A pointer carried on from the click before is already in; one going on to the next stays.
  const arrive = close && previous.onward ? 1 : outQuart(span(t, click.at - 1.0, 0.25));
  const leave = click.onward ? 0 : outQuart(span(t, click.at + (click.hover ?? 0) + 0.35, 0.3));
  return <Pointer x={x} y={y} shown={clamp(Math.min(arrive, 1 - leave))} press={press} />;
}
