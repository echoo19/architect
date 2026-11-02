import { inOutCubic, outExpo, span } from '../lab/time';

/**
 * How a piece of the film's type comes in and goes: it rises a little into place as it fades in,
 * and leaves upward as it fades out. Nothing is masked, so no letter is ever cut by an edge.
 */
export function riseIn(t: number, at: number, until = Infinity, dur = 0.9) {
  const enter = outExpo(span(t, at, dur));
  const leave = inOutCubic(span(t, until, 0.4));
  return {
    opacity: Math.min(1, enter * 1.4) * (1 - leave),
    transform: `translateY(${(1 - enter) * 0.45 - leave * 0.3}em)`,
  };
}

/** A line of display type that rises into place word by word, and leaves upward the same way. */
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
      {text.split(' ').map((word, index) => (
        <span
          key={index}
          className="inline-block pb-[0.12em]"
          style={riseIn(t, at + index * stagger, until + index * 0.012)}
        >
          {word}
        </span>
      ))}
    </span>
  );
}

/** Whether a line set with `Words` has anything on screen at `t`. */
export const wordsShown = (t: number, at: number, until = Infinity) =>
  t >= at - 0.05 && t < until + 0.8;
