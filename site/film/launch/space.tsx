import type { ReactNode } from 'react';
import type { Measured } from '../lab/film';
import { ROW, WINDOW } from '../lab/shell';
import { clamp, inOutCubic, mix, outQuart, smoothMap, span } from '../lab/time';
import { placeSidebar, RIM, Screen, type ScreenView } from './screen';
import { T } from './timeline';
import { HOOK_PHASES, scoreAt, TrainPage } from './train';
import { LAB_SIDE, walkView } from './walk';
import { riseIn, Words, wordsShown } from './words';

/**
 * The film's opening, in depth. The founder's last frame recedes into a window, and on the score's
 * first drop the training screen pushes up into that same window, a plain line above it saying
 * what its score is as it climbs past the target; the camera drifts in through "Architect builds
 * it", then makes one move across to the requests that asked for Architect. Those build as one
 * list of titles, each on its words, the list staying centered as it grows, and the camera moves
 * on to the Lab's window beside them, where the walkthrough takes over from exactly where this
 * leaves it.
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

/** Where the founder's window and the training screen sit: large, under the line that says what its score means. */
const SLOT = { cx: FRAME.width / 2, cy: 620, w: 1400 } as const;

/** The score's line, on the ground above the window. */
const SCORE_LINE = { w: 1800, h: 120, at: fromScreen(FRAME.width / 2, 130, 0) } as const;

/** The training screen, in the slot, at its own scale in the world. */
const TRAIN = fromScreen(SLOT.cx, SLOT.cy, 0);
const TRAIN_BASE = SLOT.w / WINDOW.width;

/** The requests' list, on the same ground well right of the training screen. */
const STATION: Point = { x: TRAIN.x + 2600, y: TRAIN.y, z: TRAIN.z };
const LIST = { w: 1600, h: 760 } as const;

/** The Lab's window, beside the list, so the move from one to the other passes nothing empty. */
const LAB_SCALE = 1.53;
const LAB: Point = {
  x: STATION.x + LIST.w / 2 + 240 + (WINDOW.width * LAB_SCALE) / 2,
  y: STATION.y,
  z: STATION.z,
};

/** The Lab's window at the frame's right as the walkthrough holds it, its name on the ground at its left. */
const WIDE = { ...LAB_SIDE, name: 384 } as const;
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

interface Move {
  at: number;
  dur: number;
  to: (measured: Measured) => Point;
  ease: (p: number) => number;
}

const MOVES: readonly Move[] = [
  // Still while the founder's frame recedes, then a slow drift in while the score climbs and lands.
  {
    at: 0,
    dur: T.asked - 1.2,
    to: () => ({ x: 0, y: 0, z: P - 60 }),
    ease: (p) => outQuart(p * 0.8) / outQuart(0.8),
  },
  // One move from the score to the requests: back and across, the list rising as it arrives.
  { at: T.asked - 1.2, dur: 1.5, to: () => seen(STATION), ease: inOutCubic },
  // A slow drift in while the list builds.
  {
    at: T.asked + 0.3,
    dur: T.toLab - 0.15 - T.asked - 0.3,
    to: () => ({ ...seen(STATION), z: STATION.z + P - 70 }),
    ease: (p) => p,
  },
  // To the Lab's window beside its name, where the walkthrough takes it over.
  { at: T.toLab - 0.15, dur: T.labWide - T.toLab + 0.15, to: () => LAB_WIDE, ease: outQuart },
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
  fade = 360,
  children,
}: {
  camera: Point;
  at: Point;
  w: number;
  h: number;
  base?: number;
  opacity?: number;
  /** How far before it the camera starts to see through it: a screen flown through stays solid. */
  fade?: number;
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
  const near = clamp((d - 140) / fade);
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

/** The training screen pushes up into the founder's window, and his picture goes up out of it. */
const pushUp = (t: number) => inOutCubic(span(t, T.trainRises, 0.6));

/**
 * The founder's frame: full until his last line, captioned as the clip is, then it recedes into
 * the slot beside the claim, onto exactly the window the training screen is drawn in as the camera
 * sees it, and the training screen pushes his picture up and out of it.
 */
function Founder({ t, camera }: { t: number; camera: Point }) {
  if (t > T.trainRises + 0.6) return null;
  const frame = clamp(Math.round((t - T.founder) * 60), 0, FOUNDER_FRAMES - 1);
  const p = inOutCubic(span(t, T.recede, 1.2));
  // The slot as the camera sees it now.
  const k = P / (camera.z - TRAIN.z);
  const slotX = FRAME.width / 2 + (TRAIN.x - camera.x) * k;
  const slotY = FRAME.height / 2 + (TRAIN.y - camera.y) * k;
  const slotScale = (SLOT.w * k) / FRAME.width;
  const scale = mix(1, slotScale, p);
  const cx = mix(FRAME.width / 2, slotX, p);
  const cy = mix(FRAME.height / 2, slotY, p);
  // The picture is cropped to the window's shape as it becomes one.
  const height = mix(FRAME.height, (FRAME.width * WINDOW.height) / WINDOW.width, p);
  const radius = (14 * TRAIN_BASE * k * p) / scale;
  const caption = Math.min(
    outQuart(span(t, T.founder + 0.15, 0.12)),
    1 - outQuart(span(t, T.founder + 1.18, 0.12)),
  );
  return (
    <>
      <div
        className="absolute left-0 top-0 overflow-hidden"
        style={{
          width: FRAME.width,
          height,
          transformOrigin: '0 0',
          transform: `translate(${cx - (FRAME.width / 2) * scale}px, ${cy - (height / 2) * scale}px) scale(${scale})`,
          borderRadius: radius,
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
          style={{
            transform: `translateY(${(height - FRAME.height) / 2 - pushUp(t) * height}px)`,
          }}
        />
        {/* The window's rim, over the picture. */}
        <div
          className="absolute inset-0"
          style={{ borderRadius: radius, boxShadow: p > 0 ? RIM : undefined }}
        />
      </div>
      {/* His last line, captioned as the clip's others are (intro/caps.mjs), on the whole frame. */}
      {caption > 0 && (
        <img
          src="./founder/caption.png"
          width={FRAME.width}
          height={FRAME.height}
          alt=""
          className="absolute left-0 top-0 block"
          style={{ opacity: caption, zIndex: 6 }}
        />
      )}
    </>
  );
}

/** The opening's run on the training screen's clock: Spark at work, then Glimmer, then the score. */
const HOOK_CLOCK = smoothMap([
  [T.trainRises, 64.8],
  [T.trainPush + 0.2, 66.0],
  [T.trainPush + 0.6, 72.4],
  [T.trainPush + 1.0, 74.4],
  [T.trainPush + 1.4, 74.75],
  [T.scoreLands, 75.4],
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

/** The training screen, in the founder's window: it pushes up into it, then the camera takes it. */
function Train({ t, camera }: { t: number; camera: Point }) {
  if (t < T.trainRises - 0.01 || t > T.asked + 0.4) return null;
  return (
    <Placed
      camera={camera}
      at={TRAIN}
      w={WINDOW.width}
      h={WINDOW.height}
      base={TRAIN_BASE}
      fade={60}
    >
      <div
        className="overflow-hidden rounded-[14px]"
        style={{ width: WINDOW.width, height: WINDOW.height }}
      >
        <div style={{ transform: `translateY(${(1 - pushUp(t)) * WINDOW.height}px)` }}>
          <Screen view={trainView(t)} style={{ left: 0, top: 0 }} />
        </div>
      </div>
    </Placed>
  );
}

const TITLE = 'font-display font-semibold tracking-[-0.035em]';

/**
 * What the score is, in a plain line over the training screen: the share of held-out checks it
 * gets right, tasks it never trained on and Spark never sees, counting as the screen's does.
 */
function ScoreLine({ t, camera }: { t: number; camera: Point }) {
  if (t < T.trainRises + 0.5 || t > T.asked + 0.4) return null;
  const score = Math.round(scoreAt(HOOK_CLOCK(t)));
  return (
    <Placed camera={camera} at={SCORE_LINE.at} w={SCORE_LINE.w} h={SCORE_LINE.h}>
      <div className="flex h-full items-center justify-center">
        <span
          className={`${TITLE} whitespace-nowrap text-[76px] leading-none tabular-nums`}
          style={riseIn(t, T.trainRises + 0.7)}
        >
          Right on {score}% of tasks it never trained on.
        </span>
      </div>
    </Placed>
  );
}

/** The three requests, in the narration's own words, each rising on them, the last on two lines. */
const REQUESTS = [
  ['Own your intelligence.'],
  ['AI for the air-gapped economy.'],
  ['Vertical models,', 'built on rewards you can check.'],
] as const;

/** A line of the list making its room as it comes in, so the list stays centered as it builds. */
function Opening({
  t,
  at,
  gap,
  children,
}: {
  t: number;
  at: number;
  gap: number;
  children: ReactNode;
}) {
  const open = inOutCubic(span(t, at - 0.3, 0.7));
  return (
    <div className="grid" style={{ gridTemplateRows: `${open}fr` }}>
      <div className="min-h-0 overflow-hidden" style={{ paddingTop: gap }}>
        {children}
      </div>
    </div>
  );
}

/** Y Combinator's line, then its three requests building beneath it as one list. */
function Requests({ t, camera }: { t: number; camera: Point }) {
  const until = T.toLab - 0.1;
  // Y Combinator's line rises as the move across arrives, so the frame is never empty.
  const lead = T.asked - 0.6;
  if (!wordsShown(t, lead, until)) return null;
  return (
    <Placed camera={camera} at={STATION} w={LIST.w} h={LIST.h}>
      <div className="flex h-full flex-col justify-center">
        <Words
          t={t}
          text="Y Combinator asked for this three times."
          at={lead}
          until={until}
          className={`${TITLE} text-[72px] leading-[1.04]`}
        />
        {REQUESTS.map((lines, index) => {
          const at = T.requests[index]! + 0.35;
          return (
            <Opening key={lines[0]} t={t} at={at} gap={index === 0 ? 48 : 24}>
              {lines.map((line, part) => (
                <Words
                  key={line}
                  t={t}
                  text={line}
                  at={at + part * 0.14}
                  until={until + 0.06 * (index + 1)}
                  className={`${TITLE} text-[100px] leading-[1.04]`}
                />
              ))}
            </Opening>
          );
        })}
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
          until={T.how - 0.45}
          className={`${TITLE} text-[96px] leading-none`}
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
      <Train t={t} camera={camera} />
      <ScoreLine t={t} camera={camera} />
      <Founder t={t} camera={camera} />
    </div>
  );
}
