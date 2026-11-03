import type { Measured } from '../lab/film';
import { inOutCubic, mix, span } from '../lab/time';
import { DURATION, T } from './timeline';
import { Words } from './words';

/**
 * The end, full size, on the film's ground once the window has flown out: the line is said large
 * in the middle of the frame, then Architect's mark draws itself beside where the name rises, and
 * the line moves under the name.
 */

const FRAME = { width: 1920, height: 1080 } as const;

/** The mark at the size the lockup sets it, drawn as LogoMark draws it (a 24 box). */
const MARK = 176;
const NAME = { size: 184, gap: 44 } as const;
const LINE = { size: 64 } as const;

/** The line rises as the window gliding out clears the middle of the frame, a little before its word. */
const LINE_AT = T.ownAI - 0.7;

/** Where the lockup sits: the mark's box at the left, the name after it, the two centered. */
function lockup(measured: Measured) {
  const name = measured.get('wordmark')?.w ?? 880;
  const width = MARK + NAME.gap + name;
  const left = (FRAME.width - width) / 2;
  const top = FRAME.height / 2 - MARK / 2 - 50;
  return { left, top, nameLeft: left + MARK + NAME.gap };
}

export function Ending({ t, measured }: { t: number; measured: Measured }) {
  const at = lockup(measured);
  const square = inOutCubic(span(t, T.architect - 0.3, 0.6));
  const draw = inOutCubic(span(t, T.architect + 0.05, 0.6));
  const line = inOutCubic(span(t, T.architect - 0.5, 0.75));
  const cover = inOutCubic(span(t, T.fade, DURATION - T.fade));
  // Said alone, the line sits centered over the lockup's middle; it moves under the name.
  const lineLeft = mix(at.nameLeft - (MARK + NAME.gap) / 2, at.nameLeft, line);
  const lineTop = mix(at.top + MARK / 2 - NAME.size * 0.5, at.top + MARK + 32, line);
  return (
    <>
      <svg
        width={MARK}
        height={MARK}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute"
        style={{ left: at.left, top: at.top }}
        aria-hidden
      >
        {square > 0 && (
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="5"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - square}
          />
        )}
        {draw > 0 && (
          <path d="M8 16 12 8l4 8" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - draw} />
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
          className="whitespace-nowrap font-display text-[184px] font-semibold leading-none tracking-[-0.03em]"
        />
      </div>
      {t >= LINE_AT - 0.05 && (
        <div
          className="absolute"
          style={{
            left: lineLeft,
            top: lineTop,
            transformOrigin: '0 0',
            transform: `scale(${mix(1, LINE.size / NAME.size, line)})`,
          }}
        >
          <Words
            t={t}
            text="Your own AI."
            at={LINE_AT}
            className="whitespace-nowrap font-display text-[184px] font-semibold leading-none tracking-[-0.03em]"
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
      className="absolute left-0 top-0 whitespace-nowrap font-display text-[184px] font-semibold leading-none tracking-[-0.03em] opacity-0"
    >
      Architect
    </span>
  );
}
