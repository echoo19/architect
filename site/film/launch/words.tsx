import { inOutCubic, outExpo, span } from '../lab/time';

/**
 * A line of display type that rises into place word by word behind a mask, and leaves upward the
 * same way. Each word is its own mask, so a long line wraps where it would and stays whole.
 */
export function Words({
  t,
  text,
  at,
  until = Infinity,
  stagger = 0.06,
  className,
}: {
  t: number;
  text: string;
  at: number;
  until?: number;
  stagger?: number;
  className?: string;
}) {
  return (
    <span className={`flex flex-wrap gap-x-[0.26em] ${className ?? ''}`}>
      {text.split(' ').map((word, index) => {
        const enter = outExpo(span(t, at + index * stagger, 0.9));
        const leave = inOutCubic(span(t, until + index * 0.012, 0.45));
        return (
          <span key={index} className="inline-block overflow-hidden pb-[0.12em]">
            <span
              className="inline-block"
              style={{ transform: `translateY(${(1 - enter) * 110 - leave * 110}%)` }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** Whether a line set with `Words` has anything on screen at `t`. */
export const wordsShown = (t: number, at: number, until = Infinity) =>
  t >= at - 0.05 && t < until + 0.8;
