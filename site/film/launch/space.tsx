import type { ReactNode } from 'react';
import type { Framing, Measured } from '../lab/film';
import { ExperimentPage } from '../lab/pages-lab2';
import { CHAT_AGENT, ROW, WINDOW } from '../lab/shell';
import { clamp, inOutCubic, mix, outExpo, outQuart, smoothMap, span } from '../lab/time';
import { AgentHomePage } from './home';
import { placeSidebar, RIM, Screen, type ScreenView } from './screen';
import { T } from './timeline';
import { HOOK_PHASES, TrainPage } from './train';
import { trainScore, walkView } from './walk';
import { Words, wordsShown } from './words';

/**
 * The film's opening, in depth. The founder's last frame recedes into a window beside the claim;
 * the training screen rises in its place, the camera goes onto its score as it climbs past the
 * target, and on "Architect builds it" dives through the score and past two of the app's screens
 * onto the requests that asked for Architect. Those build as one list of titles, each on its
 * words, and the camera moves on to the Lab's window beside them, which the walkthrough takes over
 * from exactly where this leaves it.
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

/** How a camera at rest at (0, 0, P) sees a point: the world point for a place on the frame. */
const restScale = (z: number) => P / (P - z);
const fromScreen = (sx: number, sy: number, z: number): Point => ({
  x: (sx - FRAME.width / 2) / restScale(z),
  y: (sy - FRAME.height / 2) / restScale(z),
  z,
});
const seen = (p: Point): Point => ({ x: p.x, y: p.y, z: p.z + P });

/** Where the founder's window and the training screen sit beside the claim, on the frame. */
const SLOT = { cx: 1450, cy: 560, w: 860 } as const;

/** The training screen, in the slot, at its own scale in the world. */
const TRAIN = fromScreen(SLOT.cx, SLOT.cy, 0);
const TRAIN_BASE = SLOT.w / WINDOW.width;

/** A point of the training screen's window, in the world. */
const onTrain = (x: number, y: number): Point => ({
  x: TRAIN.x + (x - WINDOW.width / 2) * TRAIN_BASE,
  y: TRAIN.y + (y - WINDOW.height / 2) * TRAIN_BASE,
  z: TRAIN.z,
});

/** Where the camera sees a framing of the training screen's window. */
function onto(framing: Framing): Point {
  const at = onTrain(framing.cx, framing.cy);
  return { x: at.x, y: at.y, z: TRAIN.z + (P * TRAIN_BASE) / framing.s };
}

/** Just right of the score's figure, on the window's ground: the dive goes past the number. */
function divePoint(measured: Measured): Point {
  const score = measured.get('train-score');
  const at = score ? onTrain(score.x + score.w + 70, score.y + score.h / 2) : TRAIN;
  return { ...at, z: TRAIN.z + 110 };
}

/** The screens the camera passes on the hits, behind the training screen, opaque. */
interface Pass {
  key: 'experiment' | 'home';
  at: Point;
  base: number;
  hit: number;
  away: readonly [number, number];
}

const PASSES: readonly Pass[] = [
  {
    key: 'experiment',
    at: { x: TRAIN.x - 420, y: TRAIN.y - 60, z: -1400 },
    base: 1,
    hit: T.hits[1],
    away: [-1700, 400],
  },
  {
    key: 'home',
    // Behind the first, hidden by it until it swings away.
    at: { x: TRAIN.x - 300, y: TRAIN.y - 100, z: -2800 },
    base: 1,
    hit: T.hits[2],
    away: [1700, -500],
  },
];

/** Where the camera rests in front of a passing screen: centered, the screen 1,520 px wide. */
function before(pass: Pass): Point {
  const d = (P * pass.base * WINDOW.width) / 1520;
  return { x: pass.at.x, y: pass.at.y, z: pass.at.z + d };
}

/** The requests' list, at its own station past the screens, seen at full size from P. */
const STATION: Point = { x: PASSES[1]!.at.x - 100, y: PASSES[1]!.at.y + 40, z: -4400 };
const LIST = { w: 1600, h: 760 } as const;

/** The Lab's window, beside the list, so the move from one to the other passes nothing empty. */
const LAB_SCALE = 1.53;
const LAB: Point = {
  x: STATION.x + LIST.w / 2 + 240 + (WINDOW.width * LAB_SCALE) / 2,
  y: STATION.y,
  z: STATION.z,
};

/** The Lab's window at the frame's right, its name on the ground at its left. */
const WIDE = { s: 0.95, cx: 1336, name: 410 } as const;
const LAB_K = WIDE.s / LAB_SCALE;
const LAB_WIDE: Point = {
  x: LAB.x - (WIDE.cx - FRAME.width / 2) / LAB_K,
  y: LAB.y,
  z: LAB.z + P / LAB_K,
};
const LAB_NAME = {
  w: 640,
  h: 200,
  at: { x: LAB_WIDE.x + (WIDE.name - FRAME.width / 2) / LAB_K, y: LAB.y, z: LAB.z },
} as const;

/** The claim's box, left on the ground beside the founder's window. */
const CLAIM = { w: 900, h: 260, at: fromScreen(120 + 450, 540, 0) } as const;

interface Move {
  at: number;
  dur: number;
  to: (measured: Measured) => Point;
  ease: (p: number) => number;
}

const MOVES: readonly Move[] = [
  // Still while the founder's frame recedes, then a slow drift in beside the claim.
  {
    at: 0,
    dur: T.trainPush,
    to: () => ({ x: 0, y: 0, z: P - 60 }),
    ease: (p) => outQuart(p * 0.8) / outQuart(0.8),
  },
  // Onto the training screen, from its status line to its rounds.
  { at: T.trainPush, dur: 0.8, to: (m) => onto(trainScore(m)), ease: inOutCubic },
  // Through the score, gathering speed, then past the two screens on the hits.
  { at: T.hits[0], dur: 0.45, to: (m) => divePoint(m), ease: (p) => p * p * p },
  { at: T.hits[0] + 0.45, dur: 0.6, to: () => before(PASSES[0]!), ease: outExpo },
  { at: T.hits[1], dur: 0.55, to: () => before(PASSES[1]!), ease: outExpo },
  { at: T.hits[2], dur: 0.95, to: () => seen(STATION), ease: outExpo },
  // A slow drift in while the list builds.
  {
    at: T.hits[2] + 0.95,
    dur: T.toLab - 0.15 - T.hits[2] - 0.95,
    to: () => ({ ...seen(STATION), z: STATION.z + P - 70 }),
    ease: (p) => p,
  },
  // To the Lab's window beside its name, then onto the window, to rest exactly where the
  // walkthrough starts.
  { at: T.toLab - 0.15, dur: T.labWide - T.toLab + 0.15, to: () => LAB_WIDE, ease: outQuart },
  { at: T.how - 1.5, dur: 1.5, to: () => seen(LAB), ease: inOutCubic },
];

function cameraAt(measured: Measured, t: number): Point {
  let current: Point = { x: 0, y: 0, z: P };
  for (const move of MOVES) {
    if (t < move.at) break;
    const to = move.to(measured);
    const p = move.ease(span(t, move.at, move.dur));
    current = {
      x: mix(current.x, to.x, p),
      y: mix(current.y, to.y, p),
      z: mix(current.z, to.z, p),
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

/** The founder clip's last frames (intro/tail.mjs), played from where the clip is cut. */
const FOUNDER_FRAMES = 116;

/**
 * The founder's frame: full until his last line, then it recedes into a window in the slot beside
 * the claim, and goes out to the right as the training screen rises in its place.
 */
function Founder({ t }: { t: number }) {
  if (t > T.trainRises + 0.8) return null;
  const frame = clamp(Math.round((t - T.founder) * 60), 0, FOUNDER_FRAMES - 1);
  const p = inOutCubic(span(t, T.recede, 1.2));
  const leave = outQuart(span(t, T.trainRises, 0.7));
  const scale = mix(1, SLOT.w / FRAME.width, p);
  const cx = mix(FRAME.width / 2, SLOT.cx, p) + leave * 1300;
  const cy = mix(FRAME.height / 2, SLOT.cy, p);
  const radius = mix(0, 14 / scale, p) * Math.min(1, p * 4);
  return (
    <div
      className="absolute left-0 top-0 overflow-hidden"
      style={{
        width: FRAME.width,
        height: FRAME.height,
        transformOrigin: '0 0',
        transform: `translate(${cx - (FRAME.width / 2) * scale}px, ${cy - (FRAME.height / 2) * scale}px) scale(${scale})`,
        borderRadius: radius,
        boxShadow: p > 0 ? RIM : undefined,
        zIndex: 5,
      }}
    >
      <img
        data-founder
        src={`./founder/${String(frame).padStart(4, '0')}.jpg`}
        width={FRAME.width}
        height={FRAME.height}
        alt=""
        className="block"
      />
      {/* The window's rim, over the picture. */}
      <div
        className="absolute inset-0"
        style={{ borderRadius: radius, boxShadow: p > 0 ? RIM : undefined }}
      />
    </div>
  );
}

/** The opening's run on the training screen's clock: Spark at work, then Glimmer, then the score. */
const HOOK_CLOCK = smoothMap([
  [T.trainRises, 64.8],
  [T.trainPush + 0.2, 66.0],
  [T.trainPush + 0.6, 72.4],
  [5.39, 72.6],
  [6.79, 74.4],
  [8.16, 75.4],
]);

const trainView = (t: number): ScreenView => ({
  layers: [
    {
      key: 'train',
      mode: 'flow',
      enter: 1,
      leave: 0,
      node: <TrainPage t={HOOK_CLOCK(t)} phases={HOOK_PHASES} />,
    },
  ],
  sidebar: placeSidebar(ROW.place(1)),
  sidebarShown: 0,
  flow: { shown: 1, step: 2 },
});

/** The training screen: it rises into the slot from under the frame, settling from a tilt. */
function Train({ t, camera }: { t: number; camera: Point }) {
  if (t < T.trainRises || t > T.hits[0] + 0.6) return null;
  const rise = outExpo(span(t, T.trainRises, 1.0));
  const at: Point = { ...TRAIN, y: TRAIN.y + ((1 - rise) * 760) / restScale(TRAIN.z) };
  return (
    <Placed
      camera={camera}
      at={at}
      w={WINDOW.width}
      h={WINDOW.height}
      base={TRAIN_BASE}
      opacity={clamp(rise * 3)}
    >
      <div
        style={{
          transform: `perspective(2600px) rotateX(${(1 - rise) * 12}deg)`,
          transformOrigin: '50% 100%',
        }}
      >
        <Screen view={trainView(t)} style={{ left: 0, top: 0 }} />
      </div>
    </Placed>
  );
}

const passView = (key: Pass['key']): ScreenView =>
  key === 'experiment'
    ? {
        layers: [
          {
            key,
            mode: 'place',
            enter: 1,
            leave: 0,
            node: <ExperimentPage lt={102.6} arms={[4.7, 999, 999]} />,
          },
        ],
        sidebar: placeSidebar(ROW.place(2)),
        sidebarShown: 1,
        flow: { shown: 0, step: 1 },
      }
    : {
        layers: [
          { key, mode: 'place', enter: 1, leave: 0, node: <AgentHomePage t={T.saves + 1} /> },
        ],
        sidebar: placeSidebar(ROW.agent(CHAT_AGENT), ROW.height, { chat: 1 }),
        sidebarShown: 1,
        flow: { shown: 0, step: 1 },
      };

/**
 * The two screens the flight passes: there behind the training screen once it fills the frame,
 * each swinging away on its hit as the camera goes by.
 */
function Passes({ t, camera }: { t: number; camera: Point }) {
  if (t < T.trainPush + 1.0 || t > T.hits[2] + 1.0) return null;
  return (
    <>
      {[...PASSES].reverse().map((pass) => {
        const away = inOutCubic(span(t, pass.hit - 0.04, 0.6));
        const at: Point = {
          x: pass.at.x + away * pass.away[0],
          y: pass.at.y + away * pass.away[1],
          z: pass.at.z,
        };
        return (
          <Placed
            key={pass.key}
            camera={camera}
            at={at}
            w={WINDOW.width}
            h={WINDOW.height}
            base={pass.base}
          >
            <Screen view={passView(pass.key)} style={{ left: 0, top: 0 }} />
          </Placed>
        );
      })}
    </>
  );
}

const TITLE = 'font-display font-semibold tracking-[-0.035em]';

/** The three requests, in the narration's own words, each rising on them. */
const REQUESTS = [
  'Own your intelligence.',
  'AI for the air-gapped economy.',
  'Vertical models, built on rewards you can check.',
] as const;

/** Y Combinator's line, then its three requests building beneath it as one list. */
function Requests({ t, camera }: { t: number; camera: Point }) {
  const until = T.toLab - 0.1;
  if (!wordsShown(t, T.asked, until)) return null;
  return (
    <Placed camera={camera} at={STATION} w={LIST.w} h={LIST.h}>
      <div className="flex h-full flex-col justify-center gap-12">
        <Words
          t={t}
          text="Y Combinator asked for this three times."
          at={T.asked}
          until={until}
          className={`${TITLE} text-[72px] leading-[1.04]`}
        />
        <div className="flex flex-col gap-7">
          {REQUESTS.map((request, index) => (
            <Words
              key={request}
              t={t}
              text={request}
              at={T.requests[index]! + 0.35}
              until={until + 0.06 * (index + 1)}
              className={`${TITLE} text-[100px] leading-[1.04]`}
            />
          ))}
        </div>
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
          className={`${TITLE} text-[92px] leading-[1.04]`}
        />
        <Words
          t={t}
          text="for your own AI."
          at={T.claim + 0.3}
          stagger={0.08}
          className={`${TITLE} text-[92px] leading-[1.04]`}
        />
      </div>
    </Placed>
  );
}

/** The Lab's name, on the ground beside its window. */
function LabName({ t, camera }: { t: number; camera: Point }) {
  if (t < T.labWide - 0.4) return null;
  return (
    <Placed camera={camera} at={LAB_NAME.at} w={LAB_NAME.w} h={LAB_NAME.h} base={1 / LAB_K}>
      <div className="flex h-full flex-col justify-center">
        <Words
          t={t}
          text="Architect Lab"
          at={T.labWide - 0.2}
          className={`${TITLE} text-[104px] leading-none`}
        />
      </div>
    </Placed>
  );
}

export function SpaceScene({ t, measured }: { t: number; measured: Measured }) {
  const camera = cameraAt(measured, t);
  return (
    <div className="absolute inset-0 overflow-hidden">
      {t >= T.toLab - 0.6 && (
        <Placed camera={camera} at={LAB} w={WINDOW.width} h={WINDOW.height} base={LAB_SCALE}>
          <Screen view={walkView(t)} style={{ left: 0, top: 0 }} />
        </Placed>
      )}
      <LabName t={t} camera={camera} />
      <Requests t={t} camera={camera} />
      <Passes t={t} camera={camera} />
      <Train t={t} camera={camera} />
      {t < T.trainPush + 1.0 && <Claim t={t} camera={camera} />}
      <Founder t={t} />
    </div>
  );
}
