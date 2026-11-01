import type { CSSProperties, ReactNode } from 'react';
import { WHY, WHY_AT, WHY_END } from './cues';
import { AppWindow, camera, type Framing, type Measured } from './film';
import { WINDOW } from './shell';
import { clamp, inOutCubic, mix, outExpo, outQuart, span } from './time';

/**
 * Why we made Architect, between the opening and the walkthrough. Our reason first, in two lines;
 * then the three requests Y Combinator published after we had started, each in its own words, one
 * after another, while the narration says what each asks for. The scene leaves the Lab's window at
 * one moment of the walkthrough and comes back to it at the same moment, so the cut on each side
 * is seamless.
 */

/** The walkthrough's moment the scene leaves and returns to, in authored seconds. */
export const WHY_FROM = 13.6;

const FRAME = { width: 1920, height: 1080 } as const;

/** The scene's length, in seconds: it ends on the Lab's window, as the walkthrough has it. */
const WHY_LENGTH = WHY_END - WHY_AT;

/** One block of type on the ground: when it comes in and when it goes. */
interface Card {
  at: number;
  until: number;
}

interface Request {
  title: string;
  author: string;
  quote: string;
}

const REQUESTS: readonly Request[] = [
  {
    title: 'Own Your Intelligence',
    author: 'Jon Xu',
    quote:
      'Someone has to turn workflows into evals, expertise into training data, production failures into improvements, and carry all of it forward with each new base model.',
  },
  {
    title: 'AI for the Air-Gapped Economy',
    author: 'Brad Flora',
    quote: "The most valuable data in the world isn't in the cloud.",
  },
  {
    title: 'Vertical Foundation Models',
    author: 'Diana Hu',
    quote: 'The hard part is getting high-quality, vertical-specific, verifiable rewards.',
  },
];

/**
 * Words that rise into place behind a mask and leave upward, as the opening's line does. Each
 * word is its own mask, so a long line wraps where it would and every word stays whole.
 */
function Words({
  t,
  text,
  card,
  stagger = 0.05,
  className,
}: {
  t: number;
  text: string;
  card: Card;
  stagger?: number;
  className?: string;
}) {
  return (
    <span className={`flex flex-wrap gap-x-[0.26em] ${className ?? ''}`}>
      {text.split(' ').map((word, index) => {
        const enter = outExpo(span(t, card.at + index * stagger, 0.9));
        const leave = inOutCubic(span(t, card.until + index * 0.006, 0.45));
        return (
          <span key={index} className="inline-block overflow-hidden pb-[0.1em]">
            <span
              className="inline-block"
              style={{ transform: `translateY(${(1 - enter) * 105 - leave * 105}%)` }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </span>
  );
}

const shown = (t: number, card: Card) => t >= card.at - 0.05 && t < card.until + 0.6;

/** A block of type, set from the frame's left edge and centered in its height. */
function Block({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-center gap-7 px-[200px]">{children}</div>
  );
}

/** A line of our own: a headline, and the sentence under it. */
function Statement({
  t,
  card,
  line,
  under,
}: {
  t: number;
  card: Card;
  line: string;
  under: string;
}) {
  if (!shown(t, card)) return null;
  return (
    <Block>
      <Words
        t={t}
        text={line}
        card={card}
        className="max-w-[1400px] font-display text-[68px] font-semibold leading-[1.08] tracking-[-0.03em]"
      />
      <Words
        t={t}
        text={under}
        card={{ at: card.at + 0.45, until: card.until }}
        stagger={0.03}
        className="max-w-[1400px] text-[42px] leading-[1.3]"
      />
    </Block>
  );
}

/** One request: its title, who wrote it, and its words. */
function RequestCard({ t, request, card }: { t: number; request: Request; card: Card }) {
  if (!shown(t, card)) return null;
  return (
    <Block>
      <span className="flex flex-col gap-3">
        <Words
          t={t}
          text={request.title}
          card={card}
          className="font-display text-[76px] font-semibold leading-[1.05] tracking-[-0.03em]"
        />
        <Words
          t={t}
          text={request.author}
          card={{ at: card.at + 0.2, until: card.until }}
          className="text-[36px] font-medium"
        />
      </span>
      <Words
        t={t}
        text={`“${request.quote}”`}
        card={{ at: card.at + 0.4, until: card.until }}
        stagger={0.022}
        className="mt-4 max-w-[1500px] text-[46px] leading-[1.32]"
      />
    </Block>
  );
}

/** The Lab's window under a camera, as the walkthrough draws it. */
export function World({
  view,
  children,
  style,
}: {
  view: Framing;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="absolute inset-0" style={style}>
      <div
        className="absolute left-0 top-0"
        style={{
          transformOrigin: '0 0',
          transform: `translate(${FRAME.width / 2}px, ${FRAME.height / 2}px) scale(${view.s}) translate(${-view.cx}px, ${-view.cy}px)`,
        }}
      >
        <div
          className="absolute left-0 top-0"
          style={{ width: WINDOW.width, height: WINDOW.height }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export function WhyScene({ t, measured }: { t: number; measured: Measured }) {
  const lab = camera(measured, WHY_FROM);
  // The Lab's window steps back and goes as the first line comes in, and comes back the same way
  // as the last request leaves, to the framing the walkthrough left it in.
  const leave = inOutCubic(span(t, 0, 0.7));
  const back = inOutCubic(span(t, WHY_LENGTH - 1.1, 1.0));
  const away = leave - back;
  return (
    <>
      {away < 1 && (
        <World
          view={{ ...lab, s: lab.s * mix(1, 0.9, away) }}
          style={{ opacity: 1 - outQuart(clamp(away * 1.25)) }}
        >
          <AppWindow t={WHY_FROM} />
        </World>
      )}
      <Statement
        t={t}
        card={WHY.reason}
        line="Teams that build with AI rent it."
        under="Their data goes to someone else's model with every request."
      />
      <Statement
        t={t}
        card={WHY.answer}
        line="Architect has a large model teach a small one the work, then leave."
        under="What's left runs on the team's own computer, with a record of what it can and can't do."
      />
      <Statement
        t={t}
        card={WHY.asked}
        line="After we started building, Y Combinator asked for the same thing three times."
        under="Requests for Startups, Winter 2027"
      />
      {REQUESTS.map((request, index) => (
        <RequestCard key={request.title} t={t} request={request} card={WHY.requests[index]!} />
      ))}
    </>
  );
}
