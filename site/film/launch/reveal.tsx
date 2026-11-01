import type { Framing, Measured } from '../lab/film';
import { WINDOW } from '../lab/shell';
import { inOutCubic, mix, outExpo, outQuart, span } from '../lab/time';
import { CircleCheck } from 'lucide-react';
import type { CSSProperties } from 'react';
import {
  CERTIFICATE,
  CERTIFICATE_CHECK,
  CORVID,
  HARBORVIEW,
  OPEN_TEACHER,
  PLAN,
  REAL_ACADEMY,
} from './data';
import { T } from './timeline';
import { DIVE, gpuPoint, harborviewPoint, sciencePoint, vaultPoint } from './walk';
import { Words } from './words';

/**
 * The film's figures as type on their own ground: the sealed final tests, each opening out of a
 * point in the window and going back into one; the real academy's, on the ground beside the
 * window; and the open-weight teacher, under it.
 */

const FRAME = { width: 1920, height: 1080 } as const;

const FG = [244, 244, 242] as const;
const STUDENT = [138, 184, 255] as const;
const tone = (p: number) =>
  `rgb(${FG.map((value, i) => Math.round(mix(value, STUDENT[i]!, p))).join(' ')})`;

/**
 * A figure that fills the frame: what it is of, its number, and what follows the number. A final
 * test counts from Glimmer alone's score to the one it reached, in the student's blue.
 */
export interface Figure {
  title: string;
  from: number;
  to: number;
  /** What follows the number, smaller: "of 48", "GPUs". */
  unit: string;
  /** A line under the figure, in its own words, and when it rises. */
  under?: string;
  underAt?: number;
  /** When the number rises, if not with its count or just after the title. */
  numberAt?: number;
  /** A figure shown first in the same place, which gives way to the number as it rises. */
  lead?: { value: string; unit: string };
  /** Glimmer's passed work, in its blue. */
  student: boolean;
  /** When it rises, when its count lands on `to`, and when it goes back into its point. */
  at: number;
  lands: number;
  resolve: number;
  /** The point in the window it lives at, at a moment. */
  anchor: (measured: Measured, t: number) => readonly [number, number];
}

export const FIGURES: readonly Figure[] = [
  {
    title: HARBORVIEW.name,
    from: 0,
    to: HARBORVIEW.taught,
    unit: `of ${HARBORVIEW.of}`,
    under: `Glimmer alone: ${HARBORVIEW.alone}`,
    underAt: T.fortyThree + 1.3,
    student: true,
    at: T.hero,
    lands: T.fortyThree,
    resolve: T.resolve,
    // It opens past the vault's lock, and goes back into the point the taught arm lands on.
    anchor: (measured, t) => (t < T.vaultCut ? vaultPoint(measured) : harborviewPoint(measured)),
  },
  {
    title: CORVID.name,
    from: 0,
    to: CORVID.taught,
    unit: `of ${CORVID.of}`,
    under: `Glimmer alone: ${CORVID.alone}`,
    underAt: T.twentySeven + 1.3,
    student: true,
    at: T.scienceHero,
    lands: T.twentySeven,
    resolve: T.scienceResolve,
    anchor: (measured) => sciencePoint(measured),
  },
  {
    // The fine-tune's plan for a 235B model, out of its memory card.
    title: `${PLAN.model}, LoRA`,
    lead: { value: PLAN.figures[0][0], unit: 'parameters' },
    from: PLAN.fit.gpus,
    to: PLAN.fit.gpus,
    unit: 'GPUs',
    under: `in ${PLAN.fit.nodes} nodes, ${PLAN.fit.each} each`,
    underAt: T.gpuNumber + 0.3,
    numberAt: T.gpuNumber,
    student: false,
    at: T.gpuHero,
    lands: T.gpuHero,
    resolve: T.gpuResolve,
    anchor: (measured) => gpuPoint(measured),
  },
];

/**
 * A figure, full frame. It lives at a point in the window, at a size the camera's dive brings up
 * to full: Glimmer alone's count first, then the count it reached once taught, landing on the
 * word. As the camera comes back out it goes back to its point.
 */
export function Hero({
  t,
  view,
  measured,
  figure,
}: {
  t: number;
  view: Framing;
  measured: Measured;
  figure: Figure;
}) {
  if (t < figure.at - 0.05 || t > figure.resolve + 1.1) return null;
  const [x, y] = figure.anchor(measured, t);
  const shrink = mix(1, 0.3, inOutCubic(span(t, figure.resolve, 1.0)));
  const scale = (view.s / DIVE) * shrink;
  const sx = FRAME.width / 2 + (x - view.cx) * view.s;
  const sy = FRAME.height / 2 + (y - view.cy) * view.s;
  const counted = Math.round(
    mix(figure.from, figure.to, outQuart(span(t, figure.lands - 0.95, 0.95))),
  );
  const blue = figure.student ? 1 : 0;
  // A count rises as it starts, so no figure is on screen before it means something.
  const numberAt =
    figure.numberAt ?? (figure.from === figure.to ? figure.at + 0.08 : figure.lands - 0.95);
  // The frame is the window's card up close: it settles to the film's ground under the figure.
  const ground = Math.min(
    outQuart(span(t, figure.at - 0.2, 0.4)),
    1 - outQuart(span(t, figure.resolve, 0.45)),
  );
  const gone = outQuart(span(t, figure.resolve + 0.62, 0.3));
  // Rises into its mask, and when it gives way to another figure, rises out of it.
  const rise = (at: number, until = Infinity) => {
    const p = outExpo(span(t, at, 0.9));
    const out = inOutCubic(span(t, until, 0.4));
    return { transform: `translateY(${(1 - p) * 110 - out * 140}%)` };
  };
  return (
    <>
      <div className="absolute inset-0 bg-ground" style={{ opacity: ground, zIndex: 29 }} />
      <div
        className="absolute left-0 top-0"
        style={{
          transformOrigin: '0 0',
          transform: `translate(${sx}px, ${sy}px) scale(${scale})`,
          opacity: 1 - gone,
          zIndex: 30,
        }}
      >
        {/* The figure's row is centered on the point; the organization's name sits above it. */}
        <div className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-start">
          <span className="absolute bottom-full left-0 inline-block overflow-hidden pb-[0.1em]">
            <span
              className="inline-block whitespace-nowrap font-display text-[76px] font-semibold leading-none tracking-[-0.03em]"
              style={rise(figure.at)}
            >
              {figure.title}
            </span>
          </span>
          <span className="grid">
            {figure.lead && (
              <FigureRow
                value={figure.lead.value}
                unit={figure.lead.unit}
                small
                style={(delay) => rise(figure.at + 0.08 + delay, numberAt - 0.2)}
              />
            )}
            <FigureRow
              value={String(counted)}
              unit={figure.unit}
              color={tone(blue)}
              style={(delay) => rise(numberAt + delay)}
            />
          </span>
          {figure.under && (
            <span className="absolute left-0 top-full inline-block overflow-hidden pt-4">
              <span
                className="inline-block whitespace-nowrap font-display text-[76px] font-semibold leading-none tracking-[-0.03em]"
                style={rise(figure.underAt ?? figure.at + 0.35)}
              >
                {figure.under}
              </span>
            </span>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * The risk certificate's bound, on the ground at the window's left: wrong at most 5% when it
 * answers, then the check at the academy it never trained on, landing as held.
 */
export function CertFigure({ t }: { t: number }) {
  if (t < T.certHero - 0.05 || t > T.compute + 1.2) return null;
  const pct = Math.round(CERTIFICATE.wrong * 100);
  const held = outQuart(span(t, T.certificate + 0.5, 0.35));
  const type = 'whitespace-nowrap font-display font-semibold tracking-[-0.03em]';
  return (
    <div
      className="absolute flex w-[820px] flex-col gap-10"
      style={{ left: -1120, top: WINDOW.height / 2, transform: 'translateY(-50%)' }}
    >
      <span className="flex flex-col">
        <Words
          t={t}
          text="Wrong at most"
          at={T.certHero}
          className={`${type} text-[72px] leading-none`}
        />
        <span className="inline-block overflow-hidden">
          <span
            className={`inline-block ${type} text-[300px] leading-[0.9] tracking-[-0.05em] tabular-nums`}
            style={{
              transform: `translateY(${(1 - outExpo(span(t, T.certHero + 1.1, 0.9))) * 110}%)`,
            }}
          >
            {pct}%
          </span>
        </span>
      </span>
      <span className="flex flex-col gap-3">
        <Words
          t={t}
          text={CERTIFICATE_CHECK.name}
          at={T.certificate}
          className={`${type} text-[56px] leading-none`}
        />
        <span className="flex items-center gap-[0.4em] text-[56px]">
          <Words
            t={t}
            text={`${CERTIFICATE_CHECK.answered} · ${CERTIFICATE_CHECK.wrong}`}
            at={T.certificate + 0.15}
            stagger={0.04}
            className={`${type} leading-none`}
          />
          <span
            className={`flex items-center gap-3 text-student ${type} leading-none`}
            style={{ opacity: held, transform: `translateX(${(1 - held) * -12}px)` }}
          >
            <CircleCheck size={52} strokeWidth={2} aria-hidden />
            Held
          </span>
        </span>
      </span>
    </div>
  );
}

/** A figure's row: its number large, what follows it smaller, each rising in its own mask. */
function FigureRow({
  value,
  unit,
  color,
  small,
  style,
}: {
  value: string;
  unit: string;
  color?: string;
  /** Set smaller, for a longer figure that has to fit the frame. */
  small?: boolean;
  style: (delay: number) => CSSProperties;
}) {
  return (
    <span className="flex items-baseline gap-10 whitespace-nowrap font-display font-semibold leading-[0.9] tabular-nums [grid-area:1/1]">
      <span className="inline-block overflow-hidden pt-[0.06em]">
        <span
          className={`inline-block tracking-[-0.05em] ${small ? 'text-[300px]' : 'text-[420px]'}`}
          style={{ ...style(0), color }}
        >
          {value}
        </span>
      </span>
      <span className="inline-block overflow-hidden">
        <span
          className={`inline-block tracking-[-0.035em] ${small ? 'text-[110px]' : 'text-[150px]'}`}
          style={style(0.12)}
        >
          {unit}
        </span>
      </span>
    </span>
  );
}

/** The real academy's figure, on the ground at the window's right. */
export function RealFigure({ t }: { t: number }) {
  if (t < T.twelve - 0.05 || t > T.models + 1.5) return null;
  return (
    <div
      className="absolute flex w-max flex-col gap-2"
      style={{ left: WINDOW.width + 300, top: WINDOW.height / 2, transform: 'translateY(-50%)' }}
    >
      <span className="inline-block overflow-hidden">
        <span
          className="inline-block font-display text-[200px] font-semibold leading-[0.9] tracking-[-0.05em] text-student tabular-nums"
          style={{ transform: `translateY(${(1 - outExpo(span(t, T.twelve, 0.9))) * 110}%)` }}
        >
          {REAL_ACADEMY.taught}
        </span>
      </span>
      <Words
        t={t}
        text={`up from ${REAL_ACADEMY.alone}`}
        at={T.nine - 0.35}
        className="whitespace-nowrap font-display text-[64px] font-semibold leading-none tracking-[-0.03em]"
      />
    </div>
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
