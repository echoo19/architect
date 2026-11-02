import { outQuart, span } from '../lab/time';
import { T } from './timeline';
import { Words } from './words';

/**
 * The film's segments. At each whip the window flies out of the frame to the left, gathering
 * speed; where a section opens, its first line rises big on the ground in the narration's own
 * words as the window goes; then the window flies back in from the right at full speed, settling
 * on the section's first moment with its page already changed, and carries the line out to the
 * left. A whip with no line cuts between two moments of one section. Nothing walks from one
 * screen to the next.
 */
export interface Whip {
  /** The window starts out. */
  out: number;
  /** It starts back in. */
  in: number;
  /** The section's opening line. */
  line?: string;
}

/** How long the window takes to go, and to come back. */
export const OUT = 0.45;
export const IN = 0.6;
/** Going, it gathers speed; coming back, it arrives at speed and settles. */
export const outEase = (p: number) => p * p * p;
export const inEase = outQuart;

export const WHIPS = {
  field: { out: T.fields - 0.5, in: T.fieldIn, line: 'Give it a field.' },
  beyond: { out: T.beyond - 0.45, in: T.notJust + 1.0, line: 'Not just academies.' },
  team: { out: T.teamClick - 0.45, in: T.teamClick },
  offline: { out: T.workspace - 0.6, in: T.network - 0.35, line: 'Cut the network.' },
} as const satisfies Record<string, Whip>;

/** When a whip's line starts to rise: as the window is on its way out. */
export const lineAt = (whip: Whip) => whip.out + 0.3;

/** How far the line is carried across the frame, in pixels, as the window comes back. */
const ACROSS = 2200;

/** The sections' lines, on the ground while the window is away. */
export function Chapters({ t }: { t: number }) {
  return (
    <>
      {Object.values(WHIPS).map((whip: Whip) => {
        if (!whip.line || t < whip.out || t > whip.in + IN) return null;
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
