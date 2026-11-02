import type { Framing, Measured } from '../lab/film';
import { WINDOW } from '../lab/shell';
import { inOutCubic, mix, outExpo, outQuart, span } from '../lab/time';
import { CircleCheck } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import {
  CERTIFICATE,
  CERTIFICATE_CHECK,
  CORVID,
  TRAINED,
  HARBORVIEW,
  OPEN_TEACHER,
  REAL_ACADEMY,
} from './data';
import { T } from './timeline';
import { IN, inEase } from './chapters';
import { Words } from './words';

/**
 * The film's figures as type on their own ground. The sealed final test at Harborview Prep and the
 * real academy fill the frame, growing out of the sealed card's title; every other figure rises on
 * the ground beside the window, which stays in frame under the app's backdrop, so it is always
 * plain where the number comes from.
 */

const FRAME = { width: 1920, height: 1080 } as const;

const FG = [244, 244, 242] as const;
const STUDENT = [138, 184, 255] as const;
const tone = (p: number) =>
  `rgb(${FG.map((value, i) => Math.round(mix(value, STUDENT[i]!, p))).join(' ')})`;

/** The hero's title size, and where its title starts from the frame's middle. */
const HERO_TITLE = 76;
const HERO_BLOCK = { left: -440, top: -300 } as const;

/**
 * The sealed final test, full frame, then the real academy in the same place. The sealed card's
 * own title grows out of the window into "Harborview Prep, never seen" as the frame settles to
 * the film's ground; it holds the frame's middle until the score's drop, when 43 of 48 rises under
 * it and lands on its word, Glimmer alone's under that. Then each line gives way to the real
 * academy's in place: its name, 12 of 24, up from 9. It leaves to the left as the window flies
 * back in from the right onto the certificate.
 */
export function Hero({ t, view, measured }: { t: number; view: Framing; measured: Measured }) {
  const away = T.toModels;
  if (t < T.grows - 0.05 || t > away + IN) return null;
  const sx = FRAME.width / 2;
  const sy = FRAME.height / 2;
  const counted = Math.round(mix(0, HARBORVIEW.taught, outQuart(span(t, T.fortyThreeRises, 0.5))));
  // The ground is lifted while the window is out of frame, just before it flies back in.
  const ground = t < away ? outQuart(span(t, T.grows + 0.1, 0.5)) : 0;
  const exit = -2200 * inEase(span(t, away, IN));
  // The card's title, where the camera sees it, grows into the figure's title.
  const card = measured.get('vault-title');
  const grow = inOutCubic(span(t, T.grows, 0.85));
  const from = card
    ? {
        x: FRAME.width / 2 + (card.x - view.cx) * view.s,
        y: FRAME.height / 2 + (card.y + card.h / 2 - view.cy) * view.s,
        k: (CARD_TITLE * view.s) / HERO_TITLE,
      }
    : { x: sx + HERO_BLOCK.left, y: sy + HERO_BLOCK.top + HERO_TITLE / 2, k: 1 };
  const to = { x: sx + HERO_BLOCK.left, y: sy + HERO_BLOCK.top + HERO_TITLE / 2 };
  // Alone, the title holds the frame's middle; it goes up to its place as the count rises.
  const alone = (1 - outQuart(span(t, T.fortyThreeRises - 0.05, 0.45))) * (FRAME.height / 2 - to.y);
  const titleX = mix(from.x - to.x, 0, grow);
  const titleY = mix(from.y - to.y - alone, 0, grow) + alone;
  const titleK = mix(from.k, 1, grow);
  // Clipped only as it leaves: before that it travels and holds outside its own box.
  const leaving = t >= T.side - 0.05;
  /** A line rising into its mask at `at` and, if `until` is given, leaving upward from it. */
  const move = (at: number, until = Infinity, dur = 0.9) => ({
    transform: `translateY(${(1 - outExpo(span(t, at, dur))) * 110 - inOutCubic(span(t, until, 0.4)) * 140}%)`,
  });
  const type = 'whitespace-nowrap font-display font-semibold leading-none tracking-[-0.03em]';
  return (
    <>
      <div className="absolute inset-0 bg-ground" style={{ opacity: ground, zIndex: 29 }} />
      <div
        className="absolute flex flex-col items-start gap-4"
        style={{
          left: sx + HERO_BLOCK.left,
          top: sy + HERO_BLOCK.top,
          transform: `translateX(${exit}px)`,
          zIndex: 30,
        }}
      >
        <span className="grid">
          <span
            className="[grid-area:1/1]"
            style={{ overflow: leaving ? 'hidden' : 'visible', paddingBottom: '0.12em' }}
          >
            <span
              className={`flex items-baseline text-[76px] ${type}`}
              style={{
                height: HERO_TITLE,
                // Spaced as the card's title is as it leaves the card, tightening as it grows.
                letterSpacing: `${mix(0, -0.03, grow)}em`,
                transformOrigin: '0 50%',
                transform: `translate(${titleX}px, ${titleY}px) scale(${titleK}) ${move(-Infinity, T.side).transform}`,
              }}
            >
              {HARBORVIEW.name}
              <span className="inline-block overflow-hidden pb-[0.12em]">
                <span className="inline-block" style={move(T.hero)}>
                  ,
                </span>
              </span>
              <span className="ml-[0.26em] inline-block overflow-hidden pb-[0.12em]">
                <span className="inline-block" style={move(T.hero + 0.06)}>
                  never seen
                </span>
              </span>
            </span>
          </span>
          {t >= T.side && (
            <span className="[grid-area:1/1]">
              <Words
                t={t}
                text="The real academy"
                at={T.side + 0.15}
                className={`text-[76px] ${type}`}
              />
            </span>
          )}
        </span>
        <span className="grid">
          <span className="[grid-area:1/1]">
            <FigureRow
              value={String(counted)}
              unit={`of ${HARBORVIEW.of}`}
              color={tone(1)}
              style={(delay) => move(T.fortyThreeRises + delay, T.twelve - 0.25 + delay, 0.6)}
            />
          </span>
          {t >= T.twelve - 0.3 && (
            <span className="[grid-area:1/1]">
              <FigureRow
                value={String(REAL_ACADEMY.taught)}
                unit={`of ${REAL_ACADEMY.of}`}
                color={tone(1)}
                style={(delay) => move(T.twelve - 0.2 + delay, Infinity, 0.6)}
              />
            </span>
          )}
        </span>
        <span className="grid">
          <span className="inline-block overflow-hidden pb-[0.12em] [grid-area:1/1]">
            <span
              className={`inline-block text-[76px] ${type}`}
              style={move(T.alone, T.twelve - 0.25)}
            >
              {`Glimmer alone: ${HARBORVIEW.alone}`}
            </span>
          </span>
          <span className="inline-block overflow-hidden pb-[0.12em] [grid-area:1/1]">
            <span className={`inline-block text-[76px] ${type}`} style={move(T.nine - 0.35)}>
              {`up from ${REAL_ACADEMY.alone}`}
            </span>
          </span>
        </span>
      </div>
    </>
  );
}

/** The size of a card's title in the window (packages/ui's `text-body`). */
const CARD_TITLE = 15;

/** A figure's row: its number large, what follows it smaller, each rising in its own mask. */
function FigureRow({
  value,
  unit,
  color,
  style,
}: {
  value: string;
  unit: string;
  color?: string;
  style: (delay: number) => CSSProperties;
}) {
  return (
    <span className="flex items-baseline gap-10 whitespace-nowrap font-display font-semibold leading-[0.9] tabular-nums">
      <span className="inline-block overflow-hidden pt-[0.06em]">
        <span
          className="inline-block text-[420px] tracking-[-0.05em]"
          style={{ ...style(0), color }}
        >
          {value}
        </span>
      </span>
      <span className="inline-block overflow-hidden">
        <span className="inline-block text-[150px] tracking-[-0.035em]" style={style(0.12)}>
          {unit}
        </span>
      </span>
    </span>
  );
}

/** Where a figure stands on the ground, in window pixels: past the window's right edge, or its left. */
const RIGHT = WINDOW.width + 133;
const LEFT = -1157;
/** The ground's width beside the window as the side framings show it. */
const GROUND = 1050;

const TYPE = 'font-display font-semibold tracking-[-0.03em]';

/** A mask a figure rises into and leaves upward from. */
function Rising({
  t,
  at,
  until,
  className,
  children,
}: {
  t: number;
  at: number;
  until: number;
  className: string;
  children: ReactNode;
}) {
  const p = outExpo(span(t, at, 0.9));
  const out = inOutCubic(span(t, until, 0.45));
  return (
    <span className="inline-block overflow-hidden pt-[0.04em]">
      <span
        className={`inline-block ${className}`}
        style={{ transform: `translateY(${(1 - p) * 110 - out * 140}%)` }}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * A figure on the ground beside the window: a plain heading, the number large with what follows
 * it, and a line under it, each rising on its word and leaving upward together.
 */
function GroundFigure({
  t,
  x,
  heading,
  headingAt,
  value,
  count,
  valueAt,
  unit,
  under,
  underAt,
  until,
  student,
}: {
  t: number;
  x: number;
  /** Its lines, each set where it should break. */
  heading: readonly string[];
  headingAt: number;
  value: number;
  /** The number counts up from nothing as it rises, landing 0.5 s after `valueAt`. */
  count?: boolean;
  valueAt: number;
  unit?: string;
  under?: string;
  underAt?: number;
  until: number;
  student?: boolean;
}) {
  if (t < headingAt - 0.05 || t > until + 0.9) return null;
  const shown = count ? Math.round(mix(0, value, outQuart(span(t, valueAt, 0.5)))) : value;
  return (
    <div
      className="absolute flex flex-col gap-5"
      style={{ left: x, width: GROUND, top: WINDOW.height / 2, transform: 'translateY(-50%)' }}
    >
      <span className="flex flex-col">
        {heading.map((line, index) => (
          <Words
            key={line}
            t={t}
            text={line}
            at={headingAt + index * 0.12}
            until={until}
            className={`${TYPE} whitespace-nowrap text-[84px] leading-[1.04]`}
          />
        ))}
      </span>
      <span className="flex items-baseline gap-8 whitespace-nowrap">
        <Rising
          t={t}
          at={valueAt}
          until={until}
          className={`${TYPE} text-[340px] leading-[0.9] tracking-[-0.05em] tabular-nums ${student ? 'text-student' : ''}`}
        >
          {shown}
        </Rising>
        {unit && (
          <Rising
            t={t}
            at={valueAt + 0.12}
            until={until}
            className={`${TYPE} text-[120px] leading-none`}
          >
            {unit}
          </Rising>
        )}
      </span>
      {under && (
        <Words
          t={t}
          text={under}
          at={underAt ?? valueAt + 0.4}
          until={until}
          className={`${TYPE} text-[84px] leading-[1.04]`}
        />
      )}
    </div>
  );
}

/** Inventory desk's final test at the screening lab it never saw, at the window's right. */
export function ScienceFigure({ t }: { t: number }) {
  return (
    <GroundFigure
      t={t}
      x={RIGHT}
      heading={[`${CORVID.name},`, 'never seen']}
      headingAt={T.scienceHero}
      value={CORVID.taught}
      count
      valueAt={T.twentySevenRises}
      unit={`of ${CORVID.of}`}
      under={`Glimmer alone: ${CORVID.alone}`}
      underAt={T.scienceAlone}
      until={T.scienceResolve - 0.1}
      student
    />
  );
}

/**
 * The real fine-tune, at the window's right: one GPU, trained in minutes, held from "on a single
 * GPU" through the cluster line, while the plan beside it shows the bigger run.
 */
export function GpuFigures({ t }: { t: number }) {
  return (
    <GroundFigure
      t={t}
      x={RIGHT}
      heading={[TRAINED.model]}
      headingAt={T.gpuTrained}
      value={TRAINED.gpus}
      valueAt={T.gpuTrained + 0.1}
      unit="GPU"
      under={`trained in ${TRAINED.minutes} minutes`}
      underAt={T.gpuTrained + 0.35}
      until={T.openBeat - 0.4}
      student
    />
  );
}

/**
 * The risk certificate's bound, on the ground at the window's left: wrong at most 5% when it
 * answers, then the check at the academy it never trained on, landing as held. It goes as the
 * camera turns to Compute.
 */
export function CertFigure({ t }: { t: number }) {
  if (t < T.certHero - 0.05 || t > T.compute + 0.6) return null;
  const pct = Math.round(CERTIFICATE.wrong * 100);
  const held = outQuart(span(t, T.certificate + 0.5, 0.35));
  const until = T.compute - 0.15;
  const gone = outQuart(span(t, until, 0.3));
  const place = {
    left: LEFT,
    width: GROUND,
    top: WINDOW.height / 2,
    transform: 'translateY(-50%)',
  };
  return (
    <>
      <div className="absolute flex flex-col gap-10" style={place}>
        <span className="flex flex-col">
          <Words
            t={t}
            text="Wrong at most"
            at={T.certHero}
            until={until}
            className={`${TYPE} whitespace-nowrap text-[84px] leading-none`}
          />
          <Rising
            t={t}
            at={T.certHero + 1.1}
            until={until}
            className={`${TYPE} text-[340px] leading-[0.9] tracking-[-0.05em] tabular-nums`}
          >
            {pct}%
          </Rising>
          <Words
            t={t}
            text="of requests like these"
            at={T.certHero + 1.5}
            until={until}
            className={`${TYPE} text-[64px] leading-none`}
          />
        </span>
        <span className="flex flex-col gap-3">
          <Words
            t={t}
            text={CERTIFICATE_CHECK.name}
            at={T.certificate}
            until={until}
            className={`${TYPE} text-[64px] leading-none`}
          />
          <span className="flex items-center gap-[0.4em] text-[64px]">
            <Words
              t={t}
              text={`${CERTIFICATE_CHECK.answered}, ${CERTIFICATE_CHECK.wrong}`}
              at={T.certificate + 0.15}
              until={until}
              stagger={0.04}
              className={`${TYPE} leading-none`}
            />
            <span
              className={`flex items-center gap-3 whitespace-nowrap text-student ${TYPE} leading-none`}
              style={{
                opacity: held * (1 - gone),
                transform: `translateX(${(1 - held) * -12}px)`,
              }}
            >
              <CircleCheck size={60} strokeWidth={2} aria-hidden />
              Held
            </span>
          </span>
        </span>
      </div>
    </>
  );
}

/** A model's mark: its initial on its own color, as an agent's avatar is drawn. */
function ModelMark({ name, color }: { name: string; color: 'mentor' | 'student' }) {
  return (
    <span
      className={`flex size-[104px] shrink-0 items-center justify-center rounded-[26px] font-display text-[54px] font-semibold leading-none ${
        color === 'mentor'
          ? 'bg-[rgb(240_180_112/0.14)] text-mentor'
          : 'bg-student-soft text-student'
      }`}
    >
      {name.charAt(0)}
    </span>
  );
}

const MUSE = { size: 96, gap: 0.26 } as const;

/**
 * The open-weight teacher: Spark, then the open model it can be, by the student it teaches. The
 * words around Spark's name grow out of it, so the name itself never moves but to make room.
 */
export function OpenTeacher({ t, measured }: { t: number; measured: Measured }) {
  if (t < T.openBeat + 0.3 || t > T.beyond + 1.2) return null;
  const words = OPEN_TEACHER.split(' ');
  const room = (measured.get('muse-word')?.w ?? 200) + MUSE.size * MUSE.gap;
  const grow = inOutCubic(span(t, T.muse - 0.6, 0.6));
  const enter = (at: number) => {
    const p = outExpo(span(t, at, 0.9));
    return { transform: `translateY(${(1 - p) * 110}%)` };
  };
  const word = (text: string, at: number, extra?: string) => (
    <span className={`inline-block overflow-hidden pb-[0.12em] ${extra ?? ''}`}>
      <span className="inline-block" style={enter(at)}>
        {text}
      </span>
    </span>
  );
  const name = 'font-display font-semibold leading-none tracking-[-0.03em]';
  const appear = (at: number) => ({
    opacity: outQuart(span(t, at, 0.35)),
    transform: `scale(${mix(0.8, 1, outExpo(span(t, at, 0.7)))})`,
  });
  return (
    <div className="absolute left-0 flex flex-col gap-6" style={{ top: WINDOW.height + 220 }}>
      <span className="flex items-center gap-7">
        <span style={appear(T.openBeat + 0.45)}>
          <ModelMark name="Spark" color="mentor" />
        </span>
        <span
          className={`relative flex whitespace-nowrap text-mentor ${name}`}
          style={{ fontSize: MUSE.size }}
        >
          <span className="absolute left-0 top-0">{word(words[0]!, T.muse + 0.02)}</span>
          <span className="flex gap-[0.26em]" style={{ transform: `translateX(${grow * room}px)` }}>
            {word(words[1]!, T.openBeat + 0.55)}
            {t >= T.muse - 0.3 && word(words[2]!, T.muse - 0.1)}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-7">
        <span style={appear(T.openBeat + 0.8)}>
          <ModelMark name="Glimmer" color="student" />
        </span>
        <span className={`whitespace-nowrap text-student ${name}`} style={{ fontSize: MUSE.size }}>
          {word('Glimmer', T.openBeat + 0.9)}
        </span>
      </span>
      {/* What the swap means, in plain words, on the ground at the window's right. */}
      <div
        className="absolute flex flex-col"
        style={{ left: RIGHT + 20, top: -460, width: GROUND }}
      >
        <Words
          t={t}
          text="Even the teacher can be open weights."
          at={T.openBeat + 0.7}
          until={T.beyond - 0.6}
          className={`${TYPE} text-[96px] leading-[1.04]`}
        />
      </div>
    </div>
  );
}

/** "Muse", set as the open teacher's line sets it, so its width can be read once. */
export function MuseWord() {
  return (
    <span
      data-frame="muse-word"
      className="absolute left-0 top-0 font-display font-semibold leading-none tracking-[-0.03em] opacity-0"
      style={{ fontSize: MUSE.size }}
    >
      {OPEN_TEACHER.split(' ')[0]}
    </span>
  );
}
