import type { CSSProperties, ReactNode } from 'react';
import { FieldAssetsPage, LabHome } from './pages-lab';
import { ROW, SIDEBAR, Sidebar, WINDOW } from './shell';
import { AppWindow, camera, content, FLOW, type Framing, type Measured } from './film';
import { clamp, inOutCubic, mix, outExpo, outQuart, span } from './time';

/**
 * Why we made Architect, between the opening and the walkthrough. Our reason first, in two lines;
 * then the three requests Y Combinator published after we had started, each in its own words and
 * each answered by the part of Architect that does it. The scene leaves the Lab's window at one
 * moment of the walkthrough and returns to it at the same moment, so the cut around it is seamless.
 */

/** The walkthrough's moment the scene leaves and returns to, in authored seconds. */
export const WHY_FROM = 13.6;

const FRAME = { width: 1920, height: 1080 } as const;

/** The scene's length, in seconds: it ends on the Lab's window, as the walkthrough has it. */
export const WHY_LENGTH = 23.4;

/** One block of type on the ground: when it comes in and when it goes. */
interface Card {
  at: number;
  until: number;
}

const REASON: Card = { at: 0.45, until: 2.7 };
const ANSWER: Card = { at: 3.05, until: 5.6 };
const ASKED: Card = { at: 5.95, until: 7.6 };

interface Request extends Card {
  title: string;
  author: string;
  quote: string;
  /** The part of Architect that answers it: when it is on screen. */
  cut: Card;
}

const REQUESTS: readonly Request[] = [
  {
    title: 'Own Your Intelligence',
    author: 'Jon Xu',
    quote:
      'Someone has to turn workflows into evals, expertise into training data, production failures into improvements, and carry all of it forward with each new base model.',
    at: 7.95,
    until: 11.85,
    cut: { at: 12.15, until: 13.8 },
  },
  {
    title: 'AI for the Air-Gapped Economy',
    author: 'Brad Flora',
    quote: "The most valuable data in the world isn't in the cloud.",
    at: 14.1,
    until: 16.1,
    cut: { at: 16.4, until: 18.05 },
  },
  {
    title: 'Vertical Foundation Models',
    author: 'Diana Hu',
    quote: 'The hard part is getting high-quality, vertical-specific, verifiable rewards.',
    at: 18.35,
    until: 20.95,
    cut: { at: 21.25, until: WHY_LENGTH },
  },
];

/** The two parts of the walkthrough the first two requests cut to, in authored seconds. */
const TRAIN_FROM = 69.0;
const OFFLINE_FROM = 128.0;
/** The Lab's page at the moment the scene returns to it, in seconds from its start. */
const LAB_AT = WHY_FROM - 12.0;

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
function RequestCard({ t, request }: { t: number; request: Request }) {
  if (!shown(t, request)) return null;
  return (
    <Block>
      <span className="flex flex-col gap-3">
        <Words
          t={t}
          text={request.title}
          card={request}
          className="font-display text-[76px] font-semibold leading-[1.05] tracking-[-0.03em]"
        />
        <Words
          t={t}
          text={request.author}
          card={{ at: request.at + 0.2, until: request.until }}
          className="text-[36px] font-medium"
        />
      </span>
      <Words
        t={t}
        text={`“${request.quote}”`}
        card={{ at: request.at + 0.4, until: request.until }}
        stagger={0.022}
        className="mt-4 max-w-[1500px] text-[46px] leading-[1.32]"
      />
    </Block>
  );
}

/** The Lab's window under a camera, as the walkthrough draws it. */
function World({
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

/** A framing pushed in a little over a cut, so a held view still moves. */
const push = (view: Framing, p: number, by = 0.035): Framing => ({
  ...view,
  s: view.s * (1 + by * p),
});

/** How far a cut is in, from 0 to 1, and back out. */
function cutIn(t: number, cut: Card): number {
  return Math.min(outQuart(span(t, cut.at, 0.45)), 1 - outQuart(span(t, cut.until, 0.3)));
}

/**
 * The Lab's window on the academy field's Assets tab, with Fields chosen in the sidebar. As the
 * scene ends the window goes back to the Lab as the app does: the selection slides up, the page
 * goes and the Lab's page rises in, as the walkthrough left it.
 */
function AssetsWindow({ lt, back }: { lt: number; back: number }) {
  const going = outQuart(span(back, 0, 0.3));
  const coming = outQuart(span(back, 0.1, 0.5));
  return (
    <div
      className="absolute overflow-hidden rounded-[14px] bg-ground"
      style={{
        width: WINDOW.width,
        height: WINDOW.height,
        boxShadow: 'inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 30px 80px rgb(0 0 0 / 0.5)',
      }}
    >
      {going < 1 && (
        <div
          className="absolute overflow-hidden"
          style={{ left: SIDEBAR, top: 0, right: 0, bottom: 0, opacity: 1 - going }}
        >
          <FieldAssetsPage lt={lt} />
        </div>
      )}
      {coming > 0 && (
        <div
          className="absolute overflow-hidden"
          style={{
            left: SIDEBAR,
            top: 0,
            right: 0,
            bottom: 0,
            opacity: coming,
            transform: `translateY(${(1 - coming) * 10}px)`,
          }}
        >
          <LabHome lt={LAB_AT} />
        </div>
      )}
      <Sidebar
        state={{
          fillTop: mix(ROW.place(1), ROW.place(0), outQuart(span(back, 0, 0.32))),
          fillHeight: ROW.height,
          fill: 1,
          chat: 0,
          agents: 1,
          rest: 1,
        }}
      />
    </div>
  );
}

export function WhyScene({ t, measured }: { t: number; measured: Measured }) {
  const lab = camera(measured, WHY_FROM);
  // The Lab's window steps back and goes as the first line comes in.
  const leave = inOutCubic(span(t, 0, 0.7));
  const [first, second, third] = REQUESTS as [Request, Request, Request];

  const train = push(FLOW, span(t, first.cut.at, 1.8));
  const offline = push({ cx: 700, cy: 190, s: 2.1 }, span(t, second.cut.at, 1.8));
  const assets = push(content(108, 2.08), span(t, third.cut.at, 1.2), 0.02);
  // The last cut pulls back to the Lab as the walkthrough left it, and the page turns to it.
  const returning = WHY_LENGTH - 1.0;
  const back = inOutCubic(span(t, returning, 0.95));
  const assetsView: Framing = {
    cx: mix(assets.cx, lab.cx, back),
    cy: mix(assets.cy, lab.cy, back),
    s: Math.exp(mix(Math.log(assets.s), Math.log(lab.s), back)),
  };
  const arrive = outQuart(span(t, third.cut.at, 0.45));

  return (
    <>
      {leave < 1 && (
        <World
          view={{ ...lab, s: lab.s * mix(1, 0.9, leave) }}
          style={{ opacity: 1 - outQuart(clamp(leave * 1.25)) }}
        >
          <AppWindow t={WHY_FROM} />
        </World>
      )}
      <Statement
        t={t}
        card={REASON}
        line="Teams that build with AI rent it."
        under="Their data goes to someone else's model with every request."
      />
      <Statement
        t={t}
        card={ANSWER}
        line="Architect has a large model teach a small one the work, then leave."
        under="What's left runs on the team's own computer, with a record of what it can and can't do."
      />
      <Statement
        t={t}
        card={ASKED}
        line="After we started building, Y Combinator asked for the same thing three times."
        under="Requests for Startups, Winter 2027"
      />
      {REQUESTS.map((request) => (
        <RequestCard key={request.title} t={t} request={request} />
      ))}
      {cutIn(t, first.cut) > 0 && (
        <World
          view={{ ...train, s: train.s * mix(0.94, 1, cutIn(t, first.cut)) }}
          style={{ opacity: cutIn(t, first.cut) }}
        >
          <AppWindow t={TRAIN_FROM + (t - first.cut.at)} />
        </World>
      )}
      {cutIn(t, second.cut) > 0 && (
        <World
          view={{ ...offline, s: offline.s * mix(0.94, 1, cutIn(t, second.cut)) }}
          style={{ opacity: cutIn(t, second.cut) }}
        >
          <AppWindow t={OFFLINE_FROM + (t - second.cut.at)} />
        </World>
      )}
      {arrive > 0 && (
        <World
          view={{ ...assetsView, s: assetsView.s * mix(0.94, 1, arrive) }}
          style={{ opacity: arrive }}
        >
          <AssetsWindow lt={t - third.cut.at} back={t - returning} />
        </World>
      )}
    </>
  );
}
