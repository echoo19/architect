import type { Measured } from '../lab/film';
import { WINDOW } from '../lab/shell';
import { inOutCubic, inOutQuint, mix, outQuart, span } from '../lab/time';
import { Screen } from './screen';
import { DURATION, T } from './timeline';
import { FULL, walkView } from './walk';
import { Words } from './words';

/**
 * The end. The window, as the full framing holds it, draws in to become Architect's mark: its
 * edge turns into the mark's square as what it shows goes, and the mark's A is drawn inside it.
 * The line is said beside it, then the name takes its place and the line moves under.
 */

const FRAME = { width: 1920, height: 1080 } as const;

/** The mark at the size the lockup sets it, as LogoMark draws it (a 24 box, its square inset 3). */
const MARK = 120;
const UNIT = MARK / 24;
/** The square's outer edge, its stroke and its outer radius, in pixels. */
const SQUARE = { outer: 19.4 * UNIT, stroke: 1.4 * UNIT, radius: 5.7 * UNIT } as const;
const NAME = { size: 124, gap: 32 } as const;
const LINE = { size: 52 } as const;

/** Where the lockup sits: the mark's box at the left, the name after it, the two centered. */
function lockup(measured: Measured) {
  const name = measured.get('wordmark')?.w ?? 600;
  const width = MARK + NAME.gap + name;
  const left = (FRAME.width - width) / 2;
  const top = FRAME.height / 2 - MARK / 2 - 36;
  return { left, top, nameLeft: left + MARK + NAME.gap };
}

export function Ending({ t, measured }: { t: number; measured: Measured }) {
  const p = inOutQuint(span(t, T.morph, 1.5));
  const at = lockup(measured);
  // The window's rect on screen, at the full framing, and the mark's square it becomes.
  const from = {
    w: WINDOW.width * FULL.s,
    h: WINDOW.height * FULL.s,
    x: FRAME.width / 2 - (WINDOW.width * FULL.s) / 2,
    y: FRAME.height / 2 - (WINDOW.height * FULL.s) / 2,
    r: 14 * FULL.s,
  };
  const inset = (MARK - SQUARE.outer) / 2;
  const to = {
    w: SQUARE.outer,
    h: SQUARE.outer,
    x: at.left + inset,
    y: at.top + inset,
    r: SQUARE.radius,
  };
  const rect = {
    w: mix(from.w, to.w, p),
    h: mix(from.h, to.h, p),
    x: mix(from.x, to.x, p),
    y: mix(from.y, to.y, p),
    r: mix(from.r, to.r, p),
  };
  // What the window shows shrinks with it, whole, and is gone before the square closes.
  const k = Math.min(rect.w / from.w, rect.h / from.h) * FULL.s;
  const content = 1 - outQuart(span(t, T.morph + 0.1, 0.75));
  const edge = outQuart(span(t, T.morph + 0.25, 0.9));
  const stroke = mix(1.5, SQUARE.stroke, edge);
  const draw = inOutCubic(span(t, T.morph + 1.25, 0.7));
  const line = inOutCubic(span(t, T.architect - 0.5, 0.75));
  const cover = inOutCubic(span(t, T.fade, DURATION - T.fade));
  return (
    <>
      <div
        className="absolute overflow-hidden"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          borderRadius: rect.r,
        }}
      >
        {content > 0 && (
          <div
            className="absolute left-1/2 top-1/2"
            style={{
              width: WINDOW.width,
              height: WINDOW.height,
              transform: `translate(-50%, -50%) scale(${k})`,
              opacity: content,
            }}
          >
            <Screen view={walkView(t)} style={{ left: 0, top: 0 }} />
          </div>
        )}
        <div
          className="absolute inset-0"
          style={{
            borderRadius: rect.r,
            boxShadow: `inset 0 0 0 ${stroke}px rgb(244 244 242 / ${mix(0, 1, edge)})`,
          }}
        />
      </div>
      <svg
        width={MARK}
        height={MARK}
        viewBox="0 0 24 24"
        fill="none"
        className="absolute"
        style={{ left: at.left, top: at.top }}
        aria-hidden
      >
        {draw > 0 && (
          <path
            d="M8 16 12 8l4 8"
            stroke="currentColor"
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - draw}
          />
        )}
      </svg>
      <div
        className="absolute"
        style={{ left: at.nameLeft, top: at.top + MARK / 2, transform: 'translateY(-50%)' }}
      >
        <Words
          t={t}
          text="Architect"
          at={T.architect + 0.05}
          className="whitespace-nowrap font-display text-[124px] font-semibold leading-none tracking-[-0.03em]"
        />
      </div>
      {t >= T.ownAI - 0.05 && (
        <div
          className="absolute"
          style={{
            left: at.nameLeft,
            top: mix(at.top + MARK / 2 - NAME.size * 0.5, at.top + MARK + 28, line),
            transformOrigin: '0 0',
            transform: `scale(${mix(1, LINE.size / NAME.size, line)})`,
          }}
        >
          <Words
            t={t}
            text="Your own AI."
            at={T.ownAI}
            className="whitespace-nowrap font-display text-[124px] font-semibold leading-none tracking-[-0.03em]"
          />
        </div>
      )}
      <div
        className="absolute inset-0 bg-ground"
        style={{ opacity: cover, zIndex: 60, pointerEvents: 'none' }}
      />
    </>
  );
}

/** "Architect", set as the lockup sets it, so its width can be read once. */
export function Wordmark() {
  return (
    <span
      data-frame="wordmark"
      className="absolute left-0 top-0 whitespace-nowrap font-display text-[124px] font-semibold leading-none tracking-[-0.03em] opacity-0"
    >
      Architect
    </span>
  );
}
