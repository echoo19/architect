import { inOutCubic, span } from '../lab/time';
import { T } from './timeline';
import { Words } from './words';

/**
 * The film's segments. At each one the window glides out of the frame to the left; where a section
 * opens, its first line rises big on the ground in the narration's own words once the window has
 * gone; then the window glides back in from the right onto the section's first moment, its page
 * already changed, carrying the line out to the left. Every glide eases in and out; nothing walks
 * from one screen to the next.
 */
export interface Whip {
  /** The window starts out. */
  out: number;
  /** It starts back in. */
  in: number;
  /** The section's opening line. */
  line: string;
}

/** How long the window takes to go, and to come back. */
export const OUT = 0.7;
export const IN = 0.8;
/** Both ways the window eases in and out, so no glide starts or stops abruptly. */
export const outEase = inOutCubic;
export const inEase = inOutCubic;

export const WHIPS = {
  field: { out: T.fields - 0.5, in: T.fieldIn, line: 'Give it a field.' },
  beyond: { out: T.beyond - 0.45, in: T.notJust + 1.0, line: 'Not just academies.' },
  team: { out: T.scienceResolve, in: T.teamClick, line: 'Specialists work as a team.' },
  offline: { out: T.workspace - 1.0, in: T.network - 0.6, line: 'Cut the network.' },
} as const satisfies Record<string, Whip>;

/** When a whip's line starts to rise: as the window clears the frame, so the two never overlap. */
export const lineAt = (whip: Whip) => whip.out + OUT * 0.8;

/** How far the line is carried across the frame, in pixels, as the window comes back. */
const ACROSS = 2200;

/** The sections' lines, on the ground while the window is away. */
export function Chapters({ t }: { t: number }) {
  return (
    <>
      {Object.values(WHIPS).map((whip: Whip) => {
        if (t < whip.out || t > whip.in + IN) return null;
        const x = -ACROSS * inEase(span(t, whip.in, IN));
        return (
          <div
            key={whip.line}
            className="absolute inset-0 flex items-center justify-center"
            style={{ transform: `translateX(${x}px)`, zIndex: 31 }}
          >
            <Words
              t={t}
              text={whip.line}
              at={lineAt(whip)}
              stagger={0.07}
              className="justify-center whitespace-nowrap font-display text-[150px] font-semibold leading-none tracking-[-0.04em]"
            />
          </div>
        );
      })}
    </>
  );
}
