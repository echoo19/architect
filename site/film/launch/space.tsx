import type { ReactNode } from 'react';
import { TrainPage } from '../lab/pages-flow';
import { LabHome } from '../lab/pages-lab';
import { ExperimentPage } from '../lab/pages-lab2';
import { ROW, TEAM_ROW, WINDOW } from '../lab/shell';
import { TeamChatPage } from '../lab/team';
import { clamp, inOutCubic, inOutQuint, mix, outExpo, outQuart, span } from '../lab/time';
import { REQUESTS } from '../lab/why';
import { placeSidebar, Screen, type ScreenView } from './screen';
import { T } from './timeline';
import { walkView } from './walk';
import { Words, wordsShown } from './words';

/**
 * The film's opening, in depth: the claim on the ground with the app's real screens arriving
 * behind it, a flight through them on the music's hits, the requests that asked for Architect
 * with a camera move between each, and a last move onto the Lab's window, which the walkthrough
 * takes over from exactly where this leaves it.
 *
 * A point (x, y, z) is seen by a camera at (cx, cy, cz) looking down -z, at P pixels from the
 * plane it sees at full size: scale k = P / (cz - z), so nothing here is ever blurred to fake depth.
 */

const P = 1400;
const FRAME = { width: 1920, height: 1080 } as const;

interface Point {
  x: number;
  y: number;
  z: number;
}

/** How a camera at rest at (0, 0, P) sees a point: its scale, and the world point for a place. */
const restScale = (z: number) => P / (P - z);
const fromScreen = (sx: number, sy: number, z: number): Point => ({
  x: (sx - FRAME.width / 2) / restScale(z),
  y: (sy - FRAME.height / 2) / restScale(z),
  z,
});

/** The screens behind the claim, back to front, as a camera at rest sees them. */
interface Card {
  key: 'lab' | 'train' | 'experiment' | 'team';
  at: Point;
  /** The window's own scale in the world. */
  base: number;
  /** When it arrives, and the hit that sends it past the camera. */
  arrive: number;
  hit: number;
  /** Which way it leaves as the camera passes it. */
  away: readonly [number, number];
}

function card(
  key: Card['key'],
  sx: number,
  sy: number,
  width: number,
  z: number,
  arrive: number,
  hit: number,
  away: readonly [number, number],
): Card {
  return {
    key,
    at: fromScreen(sx, sy, z),
    base: width / WINDOW.width / restScale(z),
    arrive,
    hit,
    away,
  };
}

const DECK: readonly Card[] = [
  card('lab', 1392, 652, 820, -500, T.arrive[3], T.hits[0], [-1400, 700]),
  card('train', 1474, 508, 650, -1100, T.arrive[2], T.hits[1], [-1500, 200]),
  card('experiment', 1546, 390, 530, -1700, T.arrive[1], T.hits[2], [-500, 1300]),
  card('team', 1604, 294, 440, -2300, T.arrive[0], T.hits[3], [-1500, 900]),
];

/** The claim's box, left on the ground in front of the deck. */
const CLAIM = { w: 900, h: 260, at: fromScreen(120 + 450, 540, 0) } as const;

/** Where the camera rests in front of a screen of the deck: centered, the screen 1,520 px wide. */
function before(deck: Card): Point {
  const d = (P * deck.base * WINDOW.width) / 1520;
  return { x: deck.at.x, y: deck.at.y, z: deck.at.z + d };
}

/** The type's stations, each seen at full size from P in front of it. */
const LAST = DECK[3]!.at;
const ASKED: Point = { x: LAST.x + 120, y: LAST.y + 60, z: LAST.z - 1500 };
const STATIONS: readonly Point[] = [
  { x: ASKED.x, y: ASKED.y, z: ASKED.z - 1800 },
  { x: ASKED.x + 2600, y: ASKED.y, z: ASKED.z - 1800 },
  { x: ASKED.x + 2600, y: ASKED.y + 1700, z: ASKED.z - 1800 },
];
/** The Lab's window: off to the right of the last request, so no type ever sits over it. */
const LAB: Point = { x: STATIONS[2]!.x + 3400, y: STATIONS[2]!.y, z: STATIONS[2]!.z - 1800 };
/** At rest in front of it, the window is exactly as the walkthrough's full framing draws it. */
const LAB_SCALE = 1.53;

const seen = (p: Point): Point => ({ x: p.x, y: p.y, z: p.z + P });

/**
 * The Lab's window arrives beside its name: the camera rests further back, the window at the
 * frame's right and the name on the ground at its left, both at full size from here.
 */
const WIDE = 2.2;
const LAB_WIDE: Point = { x: LAB.x - 460 * WIDE, y: LAB.y, z: LAB.z + P * WIDE };
const LAB_NAME = {
  w: 820,
  h: 420,
  at: { x: LAB_WIDE.x - 420 * WIDE, y: LAB.y, z: LAB.z },
} as const;

interface Move {
  at: number;
  dur: number;
  to: Point;
  ease: (p: number) => number;
}

const MOVES: readonly Move[] = [
  // The camera drifts in while the deck builds, then passes one screen on each hit.
  {
    at: 0,
    dur: T.hits[0],
    to: { x: 0, y: 0, z: P - 90 },
    ease: (p) => outQuart(p * 0.8) / outQuart(0.8),
  },
  { at: T.hits[0], dur: 0.62, to: before(DECK[1]!), ease: outExpo },
  { at: T.hits[1], dur: 0.62, to: before(DECK[2]!), ease: outExpo },
  { at: T.hits[2], dur: 0.62, to: before(DECK[3]!), ease: outExpo },
  { at: T.hits[3], dur: 0.95, to: seen(ASKED), ease: outExpo },
  // A push to the first request, a move across to the second, down to the third.
  { at: T.requests[0] - 0.1, dur: 0.85, to: seen(STATIONS[0]!), ease: inOutCubic },
  { at: T.requests[1] - 0.1, dur: 0.75, to: seen(STATIONS[1]!), ease: inOutQuint },
  { at: T.requests[2] - 0.1, dur: 0.75, to: seen(STATIONS[2]!), ease: inOutQuint },
  // To the Lab's window beside its name, then onto the window, to rest exactly where the
  // walkthrough starts.
  { at: T.toLab - 0.15, dur: T.labWide - T.toLab + 0.15, to: LAB_WIDE, ease: outQuart },
  { at: T.how - 1.5, dur: 1.5, to: seen(LAB), ease: inOutCubic },
];

function cameraAt(t: number): Point {
  let current: Point = { x: 0, y: 0, z: P };
  for (const move of MOVES) {
    if (t < move.at) break;
    const p = move.ease(span(t, move.at, move.dur));
    current = {
      x: mix(current.x, move.to.x, p),
      y: mix(current.y, move.to.y, p),
      z: mix(current.z, move.to.z, p),
    };
  }
  return current;
}

/**
 * A thing in the world, `w` by `h` at its own scale `base`, centered on `at`. Things very close to
 * the camera have already left the frame; they go before they would reach it.
 */
function Placed({
  camera,
  at,
  w,
  h,
  base = 1,
  opacity = 1,
  children,
}: {
  camera: Point;
  at: Point;
  w: number;
  h: number;
  base?: number;
  opacity?: number;
  children: ReactNode;
}) {
  const d = camera.z - at.z;
  if (d < 140) return null;
  const k = P / d;
  const scale = k * base;
  const sx = FRAME.width / 2 + (at.x - camera.x) * k;
  const sy = FRAME.height / 2 + (at.y - camera.y) * k;
  // Off the frame entirely: nothing to draw.
  if (sx + (w * scale) / 2 < 0 || sx - (w * scale) / 2 > FRAME.width) return null;
  if (sy + (h * scale) / 2 < 0 || sy - (h * scale) / 2 > FRAME.height) return null;
  const near = clamp((d - 160) / 360);
  return (
    <div
      className="absolute left-0 top-0"
      style={{
        width: w,
        height: h,
        transformOrigin: '0 0',
        transform: `translate(${sx - (w * scale) / 2}px, ${sy - (h * scale) / 2}px) scale(${scale})`,
        opacity: opacity * near,
      }}
    >
      {children}
    </div>
  );
}

/** What a screen of the deck shows: each is live, already at work when it arrives. */
function deckView(key: Card['key'], lt: number): ScreenView {
  const flow = { shown: 0, step: 1 };
  switch (key) {
    case 'lab':
      return {
        layers: [{ key, mode: 'place', enter: 1, leave: 0, node: <LabHome lt={3 + lt} /> }],
        sidebar: placeSidebar(ROW.place(0)),
        sidebarShown: 1,
        flow,
      };
    case 'train':
      return {
        layers: [{ key, mode: 'flow', enter: 1, leave: 0, node: <TrainPage lt={7.6 + lt} /> }],
        sidebar: placeSidebar(ROW.place(1)),
        sidebarShown: 0,
        flow: { shown: 1, step: 2 },
      };
    case 'experiment':
      return {
        layers: [
          {
            key,
            mode: 'place',
            enter: 1,
            leave: 0,
            node: <ExperimentPage lt={3.6 + lt} arms={[4.7, 999, 999]} />,
          },
        ],
        sidebar: placeSidebar(ROW.place(2)),
        sidebarShown: 1,
        flow,
      };
    case 'team':
      return {
        layers: [{ key, mode: 'place', enter: 1, leave: 0, node: <TeamChatPage t={5.2 + lt} /> }],
        sidebar: placeSidebar(TEAM_ROW.chat, TEAM_ROW.chatHeight, { team: 1 }),
        sidebarShown: 1,
        flow,
      };
  }
}

function Deck({ t, camera }: { t: number; camera: Point }) {
  return (
    <>
      {[...DECK].reverse().map((deck) => {
        if (t < deck.arrive) return null;
        // Each rises into its place in the deck from under the frame.
        const rise = outExpo(span(t, deck.arrive, 1.0));
        const away = inOutCubic(span(t, deck.hit - 0.04, 0.6));
        const k = restScale(deck.at.z);
        const at: Point = {
          x: deck.at.x + away * deck.away[0],
          y: deck.at.y + ((1 - rise) * 820) / k + away * deck.away[1],
          z: deck.at.z,
        };
        return (
          <Placed
            key={deck.key}
            camera={camera}
            at={at}
            w={WINDOW.width}
            h={WINDOW.height}
            base={deck.base}
            opacity={clamp(rise * 2.5) * mix(0.42, 1, outQuart(span(t, T.hits[0] - 0.35, 0.5)))}
          >
            {/* Held still and quieter behind the claim, so the claim reads first. */}
            <Screen view={deckView(deck.key, 99)} style={{ left: 0, top: 0 }} />
          </Placed>
        );
      })}
    </>
  );
}

/** A block of type at a station, the width of the frame less its margins. */
const BLOCK = { w: 1520, h: 760 } as const;

function Asked({ t, camera }: { t: number; camera: Point }) {
  const until = T.requests[0] - 0.15;
  if (!wordsShown(t, T.asked, until)) return null;
  return (
    <Placed camera={camera} at={ASKED} w={BLOCK.w} h={BLOCK.h}>
      <div className="flex h-full flex-col justify-center">
        <Words
          t={t}
          text="Y Combinator asked for this"
          at={T.asked}
          until={until}
          className="font-display text-[112px] font-semibold leading-[1.04] tracking-[-0.035em]"
        />
        <Words
          t={t}
          text="three times."
          at={T.asked + 0.35}
          until={until}
          className="font-display text-[112px] font-semibold leading-[1.04] tracking-[-0.035em]"
        />
      </div>
    </Placed>
  );
}

function Request({ t, camera, index }: { t: number; camera: Point; index: number }) {
  const request = REQUESTS[index]!;
  const at = T.requests[index]! + 0.3;
  // The last request leaves as the camera goes on to the Lab; the others are carried off by it.
  const until = index === 2 ? T.toLab - 0.1 : Infinity;
  if (t < at - 0.05 || t > (index === 2 ? T.toLab + 0.8 : T.toLab + 0.4)) return null;
  return (
    <Placed camera={camera} at={STATIONS[index]!} w={BLOCK.w} h={BLOCK.h}>
      <div className="flex h-full flex-col justify-center gap-9">
        <span className="flex flex-col gap-4">
          <Words
            t={t}
            text={request.title}
            at={at}
            until={until}
            className="font-display text-[92px] font-semibold leading-[1.02] tracking-[-0.035em]"
          />
          <Words
            t={t}
            text={request.author}
            at={at + 0.2}
            until={until}
            className="text-[38px] font-medium"
          />
        </span>
        <Words
          t={t}
          text={`“${request.quote}”`}
          at={at + 0.45}
          until={until}
          stagger={0.025}
          className="max-w-[1480px] text-[50px] leading-[1.3]"
        />
      </div>
    </Placed>
  );
}

function Claim({ t, camera }: { t: number; camera: Point }) {
  return (
    <Placed camera={camera} at={CLAIM.at} w={CLAIM.w} h={CLAIM.h}>
      <div className="flex h-full flex-col justify-center">
        <Words
          t={t}
          text="The training system"
          at={T.claim}
          stagger={0.08}
          className="font-display text-[92px] font-semibold leading-[1.04] tracking-[-0.035em]"
        />
        <Words
          t={t}
          text="for your own AI."
          at={T.claim + 0.3}
          stagger={0.08}
          className="font-display text-[92px] font-semibold leading-[1.04] tracking-[-0.035em]"
        />
      </div>
    </Placed>
  );
}

/** The Lab's name and what it is, on the ground beside its window. */
function LabName({ t, camera }: { t: number; camera: Point }) {
  if (t < T.labWide - 0.4) return null;
  const type = 'font-display font-semibold tracking-[-0.035em]';
  return (
    <Placed camera={camera} at={LAB_NAME.at} w={LAB_NAME.w} h={LAB_NAME.h} base={WIDE}>
      <div className="flex h-full flex-col justify-center gap-6">
        <Words
          t={t}
          text="Architect Lab"
          at={T.labWide - 0.2}
          className={`${type} text-[104px] leading-none`}
        />
        <Words
          t={t}
          text="An R&D platform for specialist models."
          at={T.labWide + 0.5}
          stagger={0.05}
          className={`${type} text-[56px] leading-[1.12]`}
        />
      </div>
    </Placed>
  );
}

export function SpaceScene({ t }: { t: number }) {
  const camera = cameraAt(t);
  return (
    <div className="absolute inset-0 overflow-hidden">
      {t >= T.toLab - 0.2 && (
        <Placed camera={camera} at={LAB} w={WINDOW.width} h={WINDOW.height} base={LAB_SCALE}>
          <Screen view={walkView(t)} style={{ left: 0, top: 0 }} />
        </Placed>
      )}
      <LabName t={t} camera={camera} />
      {[2, 1, 0].map((index) => (
        <Request key={index} t={t} camera={camera} index={index} />
      ))}
      <Asked t={t} camera={camera} />
      {t < T.hits[3] + 1 && <Deck t={t} camera={camera} />}
      {t < T.hits[1] && <Claim t={t} camera={camera} />}
    </div>
  );
}
