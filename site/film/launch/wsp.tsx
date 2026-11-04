import type { ReactNode } from 'react';
import { Badge, Button, Spinner } from '@architect/ui';
import { Check, CircleCheck, Lightbulb, Lock, X } from 'lucide-react';
import { RIM } from './screen';
import { clamp, inOutCubic, mix, outQuart, span } from '../lab/time';
import { DURATION, T } from './timeline';
import { riseIn, Words } from './words';

/**
 * After the lockup, Architect WSP. The lockup lifts away as the research that inspired it rises:
 * its title block as published, in a window at the right, its line and credit at the left. On the
 * name, the page pushes up out of that window and Architect WSP's new-experiment flow pushes in:
 * a model, a goal, the brief and Start experiment, then the experiment's stages to its candidate,
 * kept, and the result. What it shows is Architect WSP's first real benchmark
 * (docs/comparisons/wsp-bench-1.md, Nov 4): the flow and the experiment are fault-01's, as the
 * runner recorded them (runs/wsp-bench-1), and the result is the benchmark's, across its 7 faults.
 */

const FRAME = { width: 1920, height: 1080 } as const;
const TYPE = 'font-display font-semibold tracking-[-0.03em]';

/** The window the research page and then the app sit in, and how much the app is magnified in it. */
const CARD = { left: 700, top: 234, width: 1120, height: 612 } as const;
const ZOOM = 1.82;
const VIEW = { width: CARD.width / ZOOM, height: CARD.height / ZOOM } as const;
const COLUMN = { left: 120, width: 560 } as const;

/** The research page's title block, captured as published (runs/film/launch/wsp/capture.mjs). */
export const RESEARCH_IMAGE = './research/weight-space-programming.png';

/** The vertical move from the lockup down to the research: 0 on the lockup, 1 on the research. */
const PUSH = 1.1;

/** When Start experiment is pressed: once the brief is in, before the run page comes in. */
const PRESS = T.wspAstra + 0.12;

/** The experiment's title, as it is set on the brief. */
const TITLE = 'Repair a damaged model';

/** When the result comes in: the candidate kept, the stages done, the figures. */
const RESULT = T.wspWeight + 0.25;
export const tailPush = (t: number) => inOutCubic(span(t, T.wsp, PUSH));

/** How far the lockup has lifted, in frame pixels. */
export const lockupLift = (t: number) => tailPush(t) * FRAME.height;

const STEPS = ['Model', 'Goal', 'Compute', 'Brief'] as const;
const STEP_W = [74, 62, 90, 62] as const;
const STEP_X = STEP_W.map((_, i) => STEP_W.slice(0, i).reduce((a, b) => a + b, 0) + i * 4);
const STAGES = ['Baseline', 'Investigation', 'Proposed edit', 'Candidate evaluation', 'Results'];
const STAGE_W = [88, 114, 116, 166, 74] as const;
const STAGE_X = STAGE_W.map((_, i) => STAGE_W.slice(0, i).reduce((a, b) => a + b, 0) + i * 4);

/** A pill that slides from one position to the next over a product-speed move. */
function pill(
  t: number,
  moves: readonly (readonly [number, number])[],
  xs: readonly number[],
  ws: readonly number[],
) {
  let x = xs[moves[0]![1]]!;
  let w = ws[moves[0]![1]]!;
  let pos = moves[0]![1];
  for (const [when, to] of moves.slice(1)) {
    const k = outQuart(span(t, when, 0.3));
    if (k <= 0) break;
    x = mix(x, xs[to]!, k);
    w = mix(w, ws[to]!, k);
    pos = mix(pos, to, k);
  }
  return { x, w, pos };
}

/**
 * A row of steps under a sliding pill. Every label keeps its place and weight whatever its state,
 * with its check's room kept beside it: a step turns done by its check fading in as the pill leaves
 * it, so no label ever moves or shows twice.
 */
function StepLabels({
  names,
  xs,
  ws,
  pos,
  size,
  height,
}: {
  names: readonly string[];
  xs: readonly number[];
  ws: readonly number[];
  pos: number;
  size: number;
  height: number;
}) {
  return names.map((name, index) => (
    <span
      key={name}
      className="absolute top-0 flex items-center justify-center gap-1.5 whitespace-nowrap"
      style={{ left: xs[index], width: ws[index], height, fontSize: size }}
    >
      <span className="flex" style={{ opacity: clamp((pos - index) * 1.6) }}>
        <Check size={13} strokeWidth={2.2} aria-hidden />
      </span>
      {name}
    </span>
  ));
}

function Field({ label, text, focus }: { label: string; text: string; focus: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[14px] font-medium">{label}</span>
      <div
        className="rounded-[10px] bg-field px-3.5 py-2.5 text-[14px] leading-snug"
        style={{
          boxShadow: `inset 0 0 0 1px rgb(255 255 255 / ${0.1 + 0.25 * focus})`,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function StepPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-7 pt-4">
      <h1 className={`m-0 ${TYPE} text-[27px] leading-none`}>{title}</h1>
      {children}
    </div>
  );
}

/** The new-experiment flow, cropped to its column: the steps' bar, a step, the bar with the way on. */
function Flow({ t }: { t: number }) {
  const moves = [
    [0, 0],
    [T.wspGoal - 0.1, 1],
    [T.wspAstra - 0.45, 2],
    [T.wspAstra - 0.2, 3],
  ] as const;
  const step = pill(t, moves, STEP_X, STEP_W);
  const chosen = outQuart(span(t, T.wspChoose + 0.25, 0.2));
  const pages: { at: number; node: ReactNode }[] = [
    {
      at: -Infinity,
      node: (
        <StepPage title="Which model?">
          <span className="flex items-center gap-2 text-[13px]">
            <Lock size={14} strokeWidth={1.8} aria-hidden />
            Read only: nothing is ever written to the original checkpoint.
          </span>
          <div className="overflow-hidden rounded-[12px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)]">
            <div className="flex h-9 items-center border-b border-line px-4 text-[13px] font-medium">
              <span className="flex-1">Model</span>
              <span className="w-24 text-right">Parameters</span>
              <span className="w-32 pl-6">Compatibility</span>
            </div>
            <div
              className="flex h-[54px] items-center px-4 text-[14px]"
              style={{ background: `rgb(255 255 255 / ${0.07 * chosen})` }}
            >
              <span className="flex w-6 items-center" style={{ opacity: chosen }}>
                <Check size={15} strokeWidth={2.2} aria-hidden />
              </span>
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="font-medium">fault-01</span>
                <span className="font-mono text-[12px]">models/fault-01</span>
              </span>
              <span className="w-24 text-right tabular-nums">84,288</span>
              <span className="flex w-32 items-center gap-2 pl-6">
                <CircleCheck size={15} strokeWidth={1.8} className="text-student" aria-hidden />
                Supported
              </span>
            </div>
          </div>
        </StepPage>
      ),
    },
    {
      at: T.wspGoal - 0.1,
      node: (
        <StepPage title="What should change?">
          <Field
            label="Goal"
            text="Find the damage in its weights and repair it, so it reverses strings correctly again."
            focus={outQuart(span(t, T.wspGoal + 0.1, 0.25))}
          />
          <Field label="Constraints" text="Change as few weights as the repair needs." focus={0} />
        </StepPage>
      ),
    },
    {
      at: T.wspAstra - 0.2,
      node: (
        <StepPage title="The brief">
          <Field label="Title" text={TITLE} focus={0} />
          <Field
            label="Objective"
            text="Restore exact six-letter reversal in fault-01 by repairing damaged weights with the fewest scalar changes."
            focus={0}
          />
        </StepPage>
      ),
    },
  ];
  const brief = t >= T.wspAstra - 0.1;
  // Continue is pressed for the goal, Start experiment once the brief is in.
  const press = Math.max(
    Math.sin(Math.PI * span(t, T.wspGoal - 0.3, 0.16)),
    Math.sin(Math.PI * span(t, PRESS, 0.16)),
  );
  const pressScale = 1 - 0.06 * press;
  return (
    <div className="absolute inset-0 bg-ground">
      <header className="absolute inset-x-0 top-0 flex h-12 items-center border-b border-line">
        <span className="ml-5 flex items-center gap-3 text-[14px] font-medium">
          <X size={16} strokeWidth={1.8} aria-hidden />
          New experiment
        </span>
        <div className="absolute top-[7px] h-[34px]" style={{ left: 268 }}>
          <span
            aria-hidden
            className="absolute top-0 h-[34px] rounded-full bg-selected"
            style={{ left: step.x, width: step.w }}
          />
          <StepLabels names={STEPS} xs={STEP_X} ws={STEP_W} pos={step.pos} size={14} height={34} />
        </div>
      </header>
      <div className="absolute inset-x-0 overflow-hidden" style={{ top: 48, bottom: 56 }}>
        {pages.map((page, index) => {
          const next = pages[index + 1];
          // The step going leaves quickly before the next one lands, so two titles never overlap.
          const enter = index === 0 ? 1 : outQuart(span(t, page.at + 0.1, 0.28));
          const leave = next ? outQuart(span(t, next.at, 0.14)) : 0;
          if (enter <= 0 || leave >= 1) return null;
          return (
            <div
              key={index}
              className="absolute inset-0"
              style={{
                opacity: clamp(enter * 1.5) * (1 - leave),
                transform: `translateX(${(1 - enter) * 36 - leave * 36}px)`,
              }}
            >
              {page.node}
            </div>
          );
        })}
      </div>
      <footer className="absolute inset-x-0 bottom-0 flex h-14 items-center justify-end border-t border-line px-6">
        <span style={{ transform: `scale(${pressScale})` }} className="inline-block">
          <Button variant="primary" size="md">
            {brief ? 'Start experiment' : 'Continue'}
          </Button>
        </span>
      </footer>
    </div>
  );
}

/** A figure of the result, as the experiment's result cards set one: its name, then the figure. */
function Figure({ label, value, at, t }: { label: string; value: string; at: number; t: number }) {
  const k = outQuart(span(t, at, 0.4));
  return (
    <div
      className="flex flex-1 flex-col gap-1 rounded-card bg-card px-5 py-3.5 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
      style={{ opacity: k, transform: `translateY(${(1 - k) * 8}px)` }}
    >
      <span className="text-[14px] font-medium">{label}</span>
      <span className={`${TYPE} whitespace-nowrap text-[36px] leading-none tabular-nums`}>
        {value}
      </span>
    </div>
  );
}

/**
 * fault-01's experiment once started: its title, its stages, GPT-6 Astra's hypothesis and the
 * candidate; then the candidate kept and, in the hypothesis's place, the benchmark's result.
 */
function Experiment({ t }: { t: number }) {
  const stage = pill(
    t,
    [
      [0, 2],
      [T.wspTest - 0.1, 3],
      [RESULT, 4],
    ],
    STAGE_X,
    STAGE_W,
  );
  const hypothesis = outQuart(span(t, T.wspPropose + 0.15, 0.35));
  const candidate = outQuart(span(t, T.wspTest, 0.35));
  const result = inOutCubic(span(t, RESULT, 0.5));
  const measuring = t >= T.wspTest - 0.1;
  return (
    <div className="absolute inset-0 flex flex-col bg-ground px-7 pt-5">
      <div className="flex items-center gap-3">
        <h1 className={`m-0 ${TYPE} text-[30px] leading-none`}>{TITLE}</h1>
        <Badge>{result > 0.5 ? 'Qualified' : 'Running'}</Badge>
      </div>
      <div className="relative -ml-3 mt-3.5 h-8 text-[13px]">
        <span
          aria-hidden
          className="absolute top-0 h-8 rounded-full bg-selected"
          style={{ left: stage.x, width: stage.w }}
        />
        <StepLabels
          names={STAGES}
          xs={STAGE_X}
          ws={STAGE_W}
          pos={stage.pos}
          size={13}
          height={32}
        />
      </div>
      <div className="overflow-hidden" style={{ height: mix(34, 0, result), opacity: 1 - result }}>
        <p className="m-0 mt-3.5 flex items-center gap-2.5 text-[14px]">
          <Spinner tone="mentor" size={15} />
          {measuring ? 'Measuring candidate e275d438' : 'GPT-6 Astra is writing program 4'}
        </p>
      </div>
      <div className="relative mt-3.5" style={{ height: mix(100, 118, result) }}>
        {result < 1 && (
          <div
            className="absolute inset-x-0 top-0 flex flex-col gap-2 rounded-card bg-card px-5 py-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
            style={{
              opacity: hypothesis * (1 - clamp(result * 2)),
              transform: `translateY(${(1 - hypothesis) * 8 - result * 14}px)`,
            }}
          >
            <span className="flex items-center gap-2 text-[14px] font-medium">
              <Lightbulb size={15} strokeWidth={1.8} className="text-mentor" aria-hidden />
              GPT-6 Astra&apos;s hypothesis
            </span>
            <span className="text-[14px] leading-snug">
              Layer-0 attention&apos;s output projection contains a dense rank-one additive fault.
            </span>
          </div>
        )}
        {result > 0 && (
          <div className="absolute inset-x-0 top-0 flex flex-col gap-2.5">
            <span
              className={`${TYPE} text-[22px] leading-[24px]`}
              style={{
                opacity: clamp(result * 1.6 - 0.4),
                transform: `translateY(${(1 - result) * 10}px)`,
              }}
            >
              A small model with planted faults
            </span>
            <div className="flex gap-3">
              <Figure t={t} at={RESULT + 0.15} label="Planted faults repaired" value="6 of 7" />
              <Figure t={t} at={RESULT + 0.27} label="Sealed accuracy" value="15% → 96%" />
            </div>
          </div>
        )}
      </div>
      <div
        className="mt-3.5 flex h-[52px] shrink-0 items-center gap-4 rounded-card bg-card px-5 text-[14px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
        style={{ opacity: candidate, transform: `translateY(${(1 - candidate) * 8}px)` }}
      >
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium">Candidate</span>
          <span className="font-mono text-[12px]">wspc-e275d4384395c912ea65</span>
        </span>
        {/* Evaluating goes before Kept comes in, so the two never sit on one spot. */}
        {t < T.wspWeight + 0.1 ? (
          <span
            className="flex items-center gap-2"
            style={{ opacity: 1 - outQuart(span(t, T.wspWeight - 0.02, 0.1)) }}
          >
            <Spinner tone="mentor" size={14} />
            Evaluating
          </span>
        ) : (
          <span
            className="flex items-center gap-2 font-medium text-student"
            style={{
              opacity: outQuart(span(t, T.wspWeight + 0.1, 0.2)),
              transform: `translateY(${(1 - outQuart(span(t, T.wspWeight + 0.1, 0.25))) * 4}px)`,
            }}
          >
            <Check size={15} strokeWidth={2.2} aria-hidden />
            Kept
          </span>
        )}
      </div>
    </div>
  );
}

/** What the window shows: the research page, pushed up out of it by the app's flow, then the run. */
function CardContent({ t }: { t: number }) {
  const swap = inOutCubic(span(t, T.wspName - 0.2, 0.9));
  const started = outQuart(span(t, T.wspPropose - 0.05, 0.3));
  return (
    <>
      {swap < 1 && (
        <img
          src={RESEARCH_IMAGE}
          alt=""
          className="absolute left-0 top-0"
          style={{
            width: CARD.width,
            height: CARD.height,
            objectFit: 'cover',
            transform: `translateY(${-swap * CARD.height}px)`,
          }}
        />
      )}
      {swap > 0 && (
        <div
          className="absolute left-0 top-0 overflow-hidden"
          style={{
            width: VIEW.width,
            height: VIEW.height,
            zoom: ZOOM,
            transform: `translateY(${(1 - swap) * VIEW.height}px)`,
          }}
        >
          {started < 1 && (
            <div className="absolute inset-0" style={{ opacity: 1 - started }}>
              <Flow t={t} />
            </div>
          )}
          {started > 0 && (
            <div
              className="absolute inset-0"
              style={{ opacity: started, transform: `translateY(${(1 - started) * 10}px)` }}
            >
              <Experiment t={t} />
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function WspTail({ t }: { t: number }) {
  const push = tailPush(t);
  const credit = T.wspName - 0.35;
  const cover = inOutCubic(span(t, T.fade, DURATION - T.fade));
  // A slow push in from the name to the end, so the scene keeps resolving as it holds.
  const drift =
    1 + 0.035 * (0.5 - 0.5 * Math.cos(Math.PI * span(t, T.wspName, DURATION - T.wspName)));
  return (
    <>
      <div
        className="absolute left-0 top-0"
        style={{
          width: FRAME.width,
          height: FRAME.height,
          transformOrigin: '50% 50%',
          transform: `translateY(${(1 - push) * FRAME.height}px) scale(${drift})`,
        }}
      >
        <div
          className="absolute overflow-hidden rounded-[14px] bg-ground"
          style={{ ...CARD, boxShadow: RIM }}
        >
          <CardContent t={t} />
        </div>
        <div
          className="absolute flex flex-col"
          style={{
            left: COLUMN.left,
            width: COLUMN.width,
            top: FRAME.height / 2,
            transform: 'translateY(-50%)',
          }}
        >
          {t < credit + 0.9 && (
            <div className="flex flex-col gap-9">
              <span className="flex flex-col">
                <Words
                  t={t}
                  text="Inspired by"
                  at={T.wsp + 0.55}
                  until={credit}
                  className={`${TYPE} text-[84px] leading-none`}
                />
                <Words
                  t={t}
                  text="MIT research"
                  at={T.wsp + 0.7}
                  until={credit}
                  className={`${TYPE} text-[84px] leading-none`}
                />
              </span>
              <span className="flex flex-col gap-2 text-[34px] leading-tight">
                <span style={riseIn(t, T.wsp + 1.0, credit + 0.05)}>
                  Takehi, Teoh, Zhang and Khattab
                </span>
                <span style={riseIn(t, T.wsp + 1.06, credit + 0.08)}>MIT CSAIL, 2026</span>
                <span style={riseIn(t, T.wsp + 1.12, credit + 0.11)}>rikiyat.github.io</span>
              </span>
            </div>
          )}
        </div>
        {t >= T.wspName - 0.2 && (
          <div
            className="absolute flex flex-col gap-10"
            style={{
              left: COLUMN.left,
              width: COLUMN.width,
              top: FRAME.height / 2,
              transform: 'translateY(-50%)',
            }}
          >
            <span className="flex flex-col">
              <Words
                t={t}
                text="Architect"
                at={T.wspName - 0.1}
                className={`${TYPE} text-[112px] leading-none`}
              />
              <Words
                t={t}
                text="WSP"
                at={T.wspName + 0.35}
                className={`${TYPE} text-[112px] leading-none`}
              />
            </span>
            <span className="flex items-center" style={{ zoom: 2 }}>
              <span style={riseIn(t, T.wspName + 0.75)}>
                <Badge>Experimental</Badge>
              </span>
            </span>
          </div>
        )}
      </div>
      <div
        className="absolute inset-0 bg-ground"
        style={{ opacity: cover, zIndex: 60, pointerEvents: 'none' }}
      />
    </>
  );
}
