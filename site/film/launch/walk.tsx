import type { ReactNode } from 'react';
import { Pointer, type Framing, type Measured } from '../lab/film';
import { CounterexampleDrawer, DefinePage } from '../lab/pages-flow';
import { FieldPage, Fields, LabHome } from '../lab/pages-lab';
import { ExperimentPage, ModelsPage } from '../lab/pages-lab2';
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
  FIRST_ROUND,
  INVENTORY_SCORES,
  SHOW_OPEN_TEACHER,
} from './data';
import { FINE_TUNE_AT, FINE_TUNE_SCROLL, FineTunePage } from './finetune';
import { HarnessDrawer } from './harness';
import { AgentHomePage } from './home';
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

/** The experiment page's own time: it is already finished up to the plot when it is cut in. */
const experimentTime = (t: number) => 6 + Math.max(0, t - T.vaultCut);

/** When the plot's groups land, in the page's own time: taught on, Harborview, the real academy. */
const ARMS = [4.7, experimentTime(T.resolve + 0.55), experimentTime(T.side + 1.0)] as const;

/** How far a table page has got by the time it comes in: its rows are already rising. */
const ROWS_IN = 0.3;

/** Allow once on the academy desk's write, in the workspace page's own time. */
const ALLOW_AT = 9.4;

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
    key: 'fields',
    at: T.fields,
    mode: 'place',
    fill: place(1),
    draw: (lt) => (
      <Fields
        lt={lt + ROWS_IN}
        selected={ui(lt, T.academyLit - T.fields, 0.2)}
        when={FIELD_ACTIVITY}
      />
    ),
  },
  {
    key: 'field',
    at: T.field,
    mode: 'place',
    fill: place(1),
    draw: (lt) => <FieldPage lt={lt} />,
    clock: [
      [0, 0.5],
      [2.9, 3.4],
      [T.vault - T.field, 5.4],
      [20, 21.4],
    ],
  },
  {
    key: 'define',
    at: T.define,
    mode: 'flow',
    fill: place(1),
    draw: (lt) => <DefinePage lt={lt} scroll={defineScroll(lt)} />,
    clock: [
      [0, 0],
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
    at: T.vaultPage,
    mode: 'place',
    fill: place(1),
    draw: (_lt, t) => <FieldPage lt={21} unlock={ui(t, T.opens, 0.35)} />,
  },
  {
    key: 'experiment',
    at: T.vaultCut,
    mode: 'place',
    fill: place(2),
    cut: true,
    draw: (_lt, t) => <ExperimentPage lt={experimentTime(t)} arms={ARMS} placed={['1-taught']} />,
  },
  {
    key: 'models',
    at: T.models,
    mode: 'place',
    fill: place(3),
    draw: (lt) => (
      <ModelsPage
        lt={lt + ROWS_IN}
        panelAt={T.panel - T.models + ROWS_IN}
        certificate={CERTIFICATE}
        row={0}
        basisOpen
      />
    ),
  },
  {
    key: 'finetune',
    at: T.compute,
    mode: 'place',
    fill: place(4),
    draw: (lt, _t, still) => <FineTunePage lt={lt} still={still} />,
  },
  {
    key: 'beyond',
    at: T.beyond,
    mode: 'place',
    fill: place(1),
    draw: (lt, t) => (
      <Fields
        lt={lt + ROWS_IN}
        selected={Math.min(ui(t, T.notJust + 1.2, 0.25), 1 - ui(t, T.labDesks, 0.35))}
        lab={ui(t, T.labDesks, 0.35) - ui(t, T.scienceResolve, 0.4)}
        when={FIELD_ACTIVITY}
        scores={t >= T.scienceResolve + 0.75 ? { 'Inventory desk': INVENTORY_SCORES } : undefined}
      />
    ),
  },
  {
    key: 'team',
    at: T.teamClick + 0.12,
    mode: 'place',
    fill: TEAM_CHAT,
    draw: (lt) => <TeamChatPage t={lt} />,
    clock: [
      [0, 4.15],
      [0.2, 4.35],
      [T.asks - T.teamClick - 0.12, 5.05],
      [T.compounds - T.teamClick - 0.12, 6.5],
      [T.holds - T.teamClick - 1.1, 8.4],
      [T.holds - T.teamClick - 0.12, 10.3],
      [T.holds - T.teamClick + 2.0, 11.3],
    ],
  },
  {
    key: 'home',
    at: T.workspace,
    mode: 'place',
    fill: ACADEMY_ROW,
    draw: (_lt, t) => <AgentHomePage t={t} />,
  },
  {
    key: 'workspace',
    at: T.intoChat,
    mode: 'place',
    fill: ACADEMY_CHAT,
    draw: (lt) => <WorkspacePage lt={lt} allowAt={ALLOW_AT} />,
    // It opens on the reply already waiting for approval, and Allow once is pressed on its word.
    clock: [
      [0, 8.9],
      [T.saves - T.intoChat, ALLOW_AT + 0.15],
      [T.saves - T.intoChat + 2, ALLOW_AT + 2],
    ],
  },
  {
    key: 'welcome',
    at: T.welcome,
    mode: 'bare',
    fill: place(0),
    draw: (lt) => <WelcomePage lt={lt} chooseAt={T.labEdition - T.welcome} />,
  },
];

const CLOCKS = new Map(PAGES.map((page) => [page.key, page.clock ? local(page.clock) : null]));

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
    // A page goes quickly as the next rises, so the window is never left empty between them.
    const enter = page.cut ? 1 : outQuart(span(t, page.at + 0.06, 0.3));
    const leave = next && !next.cut ? outQuart(span(t, next.at, 0.1)) : 0;
    layers.push({
      key: page.key,
      mode: page.mode,
      enter,
      leave,
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
    dim: dim(t),
  };
}

/** While a figure stands beside the window, the window under the app's backdrop. */
const DIMS: readonly (readonly [number, number])[] = [
  [T.side + 1.4, T.models - 0.5],
  [T.certHero - 0.6, T.compute - 0.3],
  [T.gpuDive - 0.1, T.gpuResolve],
  [T.scienceDive - 0.1, T.scienceResolve],
  ...(SHOW_OPEN_TEACHER ? [[T.openBeat, T.beyond - 0.5] as const] : []),
];

const dim = (t: number) =>
  0.75 *
  Math.max(0, ...DIMS.map(([from, to]) => Math.min(ui(t, from + 0.2, 0.5), 1 - ui(t, to, 0.4))));

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

/** A push onto a place page's content, its left edge in the gutter right of the sidebar. */
function content(top: number, s = 2.197): Framing {
  return { cx: 258 + FRAME.width / 2 / s, cy: top + FRAME.height / 2 / s, s };
}

/** A part of the window, framed whole with room around it; `dy` for a page scrolled since. */
export function frameOf(measured: Measured, name: string, pad = 44, max = 2.4, dy = 0): Framing {
  const rect = measured.get(name);
  if (!rect) return FULL;
  const s = Math.min(FRAME.width / (rect.w + 2 * pad), FRAME.height / (rect.h + 2 * pad), max);
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2 - dy, s };
}

/** Where the taught arm's point lands on Harborview's row, in window pixels. */
export function harborviewPoint(measured: Measured): readonly [number, number] {
  const track = measured.get('hv-track');
  if (!track) return [WINDOW.width / 2, WINDOW.height / 2];
  return [track.x + track.w * 0.896, track.y + track.h / 2];
}

/** Just above the sealed academy's lock: the dive goes past the lock as it opens. */
export function vaultPoint(measured: Measured): readonly [number, number] {
  const lock = measured.get('vault');
  if (!lock) return [WINDOW.width / 2, WINDOW.height / 2];
  return [lock.x + lock.w / 2, lock.y + lock.h / 2 - 54];
}

/** How close a dive goes onto its point: everything readable around it is out of frame. */
export const DIVE = 34;

const onto = (point: readonly [number, number]): Framing => ({
  cx: point[0],
  cy: point[1],
  s: DIVE,
});

/**
 * The whole window at the frame's left, under the app's backdrop, a figure on the ground at its
 * right: the window stays in frame, so the figure is always seen beside where it comes from.
 */
const SIDE: Framing = { cx: 1180, cy: WINDOW.height / 2, s: 0.78 };

/** The whole window at the frame's top left, the open teacher on the ground under and beside it. */
const OPEN_VIEW: Framing = { cx: 1154, cy: 641, s: 0.78 };

/** A little closer on the whole window, so the sidebar stays in frame while it scrolls. */
const SIDEBAR_VIEW: Framing = { cx: WINDOW.width / 2, cy: WINDOW.height / 2, s: 1.62 };

/** The team's chat, the frame's left edge just right of the sidebar, its header in frame. */
const TEAM_VIEW: Framing = { cx: 695, cy: 540 / 2.43 - 10, s: 2.43 };

/**
 * The home's On-premise card, close: whole rows with the card's edges inside the frame, its top
 * and bottom just outside two of the card's parts, so it cuts only between rows.
 */
function onPremise(measured: Measured, top: string, bottom: string): Framing {
  const first = measured.get(top);
  const last = measured.get(bottom);
  if (!first || !last) return FULL;
  const from = first.y - 14;
  const to = last.y + last.h + 14;
  const s = Math.min(FRAME.height / (to - from), FRAME.width / (first.w + 48));
  return { cx: first.x + first.w / 2, cy: (from + to) / 2, s };
}

/** The academy desk's chat, as the walkthrough frames it. */
const CHAT_VIEW: Framing = { cx: 258 + 480, cy: 250, s: 2.0 };

/** The round's drawer over the rounds: the frame's top under the flow's bar. */
const DRAWER_VIEW: Framing = { cx: 637, cy: 357, s: 1.8 };

/** Compute's page: its left edge in the gutter past the sidebar, its top under the title. */
const COMPUTE_VIEW: Framing = content(104, 1.95);

/** The whole window at the frame's right, the certificate's bound on the ground at its left. */
const CERT_VIEW: Framing = { cx: -29, cy: WINDOW.height / 2, s: 0.78 };

/**
 * Where academies differ, as its passages open: the frame's top in the gutter above the row, the
 * brief's card whole across, the window's bottom under it.
 */
function brief(measured: Measured): Framing {
  const s = 2.45;
  const row = measured.get('brief-differ');
  // Measured with Define scrolled to its end; here it has scrolled only to the passages.
  const top = (row ? row.y + 860 - BRIEF_SCROLL : 199) - 7;
  return { cx: WINDOW.width / 2, cy: top + FRAME.height / 2 / s, s };
}

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

/** Define's top, its job and the start of the brief, while the passages are still closed. */
const DEFINE_TOP: Framing = { cx: WINDOW.width / 2, cy: 316, s: 2.29 };

/** The two editions. */
const EDITIONS: Framing = { cx: WINDOW.width / 2, cy: 290, s: 2.2 };

interface Shot {
  at: number;
  dur: number;
  to: Framing | ((measured: Measured) => Framing);
  ease?: (p: number) => number;
  /** A held framing drifts in a little; one a cut or a dive leaves from exactly does not. */
  still?: boolean;
}

const SHOTS: readonly Shot[] = [
  { at: T.how, dur: 0, to: FULL },
  // 3. The Lab: a push onto what needs you, what is running and what it costs.
  { at: T.pushRunning, dur: 1.3, to: content(108, 2.0) },
  // 4. A field: a whip back as Fields is clicked, the table, the organizations, the vault.
  { at: T.fields - 0.55, dur: 0.45, to: FULL, ease: inOutQuint },
  { at: T.fields + 0.35, dur: 1.0, to: content(108) },
  { at: T.field - 0.05, dur: 0.9, to: content(103, 1.9) },
  { at: T.vault + 0.1, dur: 1.0, to: content(103, 2.15) },
  { at: T.real - 0.1, dur: 1.0, to: content(103, 1.9) },
  // 5. The study.
  { at: T.define - 0.3, dur: 0.6, to: FLOW, ease: inOutQuint },
  { at: T.define + 0.8, dur: 0.9, to: DEFINE_TOP },
  { at: T.source - 0.6, dur: 1.2, to: (m) => brief(m) },
  { at: T.confirm - 0.9, dur: 0.6, to: FLOW },
  // 6. The harness: its drawer over the rounds, then the rounds, then into the score.
  { at: T.harness - 0.1, dur: 0.7, to: DRAWER_VIEW, ease: inOutQuint },
  { at: T.harnessOut, dur: 0.7, to: FLOW, ease: inOutQuint },
  { at: T.pushScore, dur: 0.9, to: (m) => trainScore(m) },
  // 7. The counterexample, and the case locked in on the field's Assets.
  { at: T.drawer - 0.1, dur: 0.7, to: DRAWER_VIEW, ease: inOutQuint },
  { at: T.drawerOut - 0.05, dur: 0.55, to: FULL, ease: inOutQuint },
  // 8. The vault opens: onto the sealed academy, a dive past its lock into the figure, which
  // goes back into the plot; then the real academy's figure beside the window.
  { at: T.vaultPage + 0.05, dur: 0.9, to: content(103, 2.15), still: true },
  { at: T.dive, dur: 0.85, to: (m) => onto(vaultPoint(m)), ease: inOutCubic, still: true },
  { at: T.vaultCut, dur: 0, to: (m) => onto(harborviewPoint(m)), still: true },
  { at: T.resolve, dur: 1.25, to: (m) => frameOf(m, 'plot', 30), ease: inOutQuint },
  { at: T.side + 1.4, dur: 0.8, to: SIDE, ease: inOutQuint },
  // 9. The certificate, then the fine-tune: the plan, the model it read, the GPUs, the cluster.
  { at: T.models - 0.5, dur: 0.8, to: FULL, ease: inOutQuint },
  { at: T.panel - 0.1, dur: 0.8, to: (m) => frameOf(m, 'panel', 40) },
  { at: T.certHero - 0.6, dur: 1.3, to: CERT_VIEW, ease: inOutQuint },
  // Compute opens beside the plain line for what comes next, then the camera goes onto its plan.
  { at: T.compute + 1.6, dur: 1.0, to: COMPUTE_VIEW, ease: inOutQuint },
  { at: T.gpuDive - 0.1, dur: 0.8, to: SIDE, ease: inOutQuint },
  { at: T.gpuResolve, dur: 0.9, to: COMPUTE_VIEW, ease: inOutQuint },
  ...(SHOW_OPEN_TEACHER
    ? [
        { at: T.openBeat, dur: 1.3, to: OPEN_VIEW, ease: inOutQuint },
        { at: T.beyond - 0.5, dur: 0.9, to: SIDEBAR_VIEW, ease: inOutQuint },
      ]
    : [{ at: T.beyond - 0.45, dur: 0.6, to: SIDEBAR_VIEW, ease: inOutQuint }]),
  // 10. Beyond academies: the screening lab's desks, Inventory desk's never-seen figure beside
  // the window, then the sidebar turns to the team and its chat.
  { at: T.beyond + 0.8, dur: 1.0, to: content(108), still: true },
  { at: T.scienceDive - 0.1, dur: 0.8, to: SIDE, ease: inOutQuint },
  { at: T.scienceResolve, dur: 1.1, to: content(108), ease: inOutQuint },
  { at: T.teamScroll - 0.7, dur: 0.7, to: SIDEBAR_VIEW, ease: inOutQuint },
  { at: T.teamClick + 0.25, dur: 1.1, to: TEAM_VIEW },
  // 11. Offline: back for the sidebar and onto Academy desk's home, its Offline row as the network
  // goes, then up its GPU, model and memory, and on into its chat for the approval.
  { at: T.backScroll - 0.5, dur: 0.6, to: SIDEBAR_VIEW, ease: inOutQuint },
  { at: T.workspace + 0.35, dur: 0.8, to: (m) => onPremise(m, 'home-loaded', 'home-offline') },
  {
    at: T.machine,
    dur: 0.9,
    to: (m) => onPremise(m, 'home-gpu', 'home-memory'),
    ease: inOutQuint,
  },
  { at: T.intoChat - 0.85, dur: 1.0, to: CHAT_VIEW },
  // 12. The editions, then the whole window again for the end.
  { at: T.welcome - 0.4, dur: 0.6, to: FULL, ease: inOutQuint },
  { at: T.welcome + 0.3, dur: 1.2, to: EDITIONS },
  { at: T.morph - 0.95, dur: 0.9, to: FULL, still: true },
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

const navPoint = (index: number): readonly [number, number] => [92, ROW.place(index) + 20];

const CLICKS: readonly Click[] = [
  { at: T.labHover, target: [880, 205], hover: 3.4 },
  { at: T.fields - 0.1, target: navPoint(1) },
  { at: T.field - 0.1, target: 'academy-field' },
  { at: T.define - 0.15, target: 'open-job' },
  { at: T.confirm, target: 'confirm' },
  { at: T.drawerOut - 0.15, target: [WINDOW.width - 45, 97] },
  { at: T.vaultPage - 0.1, target: [36, 28] },
  { at: T.models - 0.1, target: navPoint(3) },
  { at: T.panel - 0.1, target: 'academy-model' },
  { at: T.compute - 0.1, target: navPoint(4) },
  { at: T.compute + FINE_TUNE_AT.read, target: 'ft-read' },
  { at: T.compute + FINE_TUNE_AT.lora, target: 'ft-lora' },
  { at: T.compute + FINE_TUNE_AT.slurm, target: 'ft-slurm', dy: FINE_TUNE_SCROLL.bundle },
  {
    at: T.compute + FINE_TUNE_AT.kubernetes,
    target: 'ft-kubernetes',
    dy: FINE_TUNE_SCROLL.bundle,
  },
  { at: T.beyond - 0.1, target: navPoint(1) },
  { at: T.teamClick, target: [120, TEAM_ROW.chat + TEAM_ROW.chatHeight / 2] },
  { at: T.workspace - 0.1, target: [120, ROW.agent(CHAT_AGENT) + ROW.height / 2] },
  { at: T.intoChat - 0.05, target: 'open-session', onward: true },
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
