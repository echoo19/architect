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
 * a model, a goal, the brief and Start experiment, then the experiment's stages to a candidate
 * under evaluation. It is marked Preview: no result is shown.
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
export const tailPush = (t: number) => inOutCubic(span(t, T.wsp, PUSH));

/** How far the lockup has lifted, in frame pixels. */
export const lockupLift = (t: number) => tailPush(t) * FRAME.height;

const STEPS = ['Model', 'Goal', 'Compute', 'Brief'] as const;
const STEP_W = [74, 62, 90, 62] as const;
const STEP_X = STEP_W.map((_, i) => STEP_W.slice(0, i).reduce((a, b) => a + b, 0) + i * 4);
const STAGES = ['Baseline', 'Investigation', 'Proposed edit', 'Candidate evaluation', 'Results'];
const STAGE_W = [92, 118, 120, 172, 78] as const;
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
  let at = moves[0]![1];
  for (const [when, to] of moves.slice(1)) {
    const k = outQuart(span(t, when, 0.3));
    if (k <= 0) break;
    x = mix(x, xs[to]!, k);
    w = mix(w, ws[to]!, k);
    if (k >= 0.5) at = to;
  }
  return { x, w, at };
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
    <div className="flex flex-col gap-3.5 px-7 pt-5">
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
                <span className="font-medium">Qwen3-0.6B</span>
                <span className="font-mono text-[12px]">Qwen/Qwen3-0.6B</span>
              </span>
              <span className="w-24 text-right tabular-nums">596M</span>
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
            text="Stop repeating the same sentence in long answers"
            focus={outQuart(span(t, T.wspGoal + 0.1, 0.25))}
          />
          <Field
            label="Constraints"
            text="Short answers to arithmetic stay as they are"
            focus={0}
          />
        </StepPage>
      ),
    },
    {
      at: T.wspAstra - 0.2,
      node: (
        <StepPage title="The brief">
          <Field
            label="Objective"
            text="Cut the share of long answers that repeat a sentence."
            focus={0}
          />
          <Field
            label="Baseline"
            text="Measure the base, a repetition penalty and a system instruction."
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
          {STEPS.map((name, index) => (
            <span
              key={name}
              className={`absolute top-0 flex h-[34px] items-center justify-center gap-1 text-[14px] ${index === step.at ? 'font-medium' : ''}`}
              style={{ left: STEP_X[index], width: STEP_W[index] }}
            >
              {index < step.at && <Check size={13} strokeWidth={2.2} aria-hidden />}
              {name}
            </span>
          ))}
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

/** The experiment once started: its title, its stages, Astra's hypothesis and the candidate. */
function Experiment({ t }: { t: number }) {
  const stage = pill(
    t,
    [
      [0, 2],
      [T.wspTest - 0.1, 3],
    ],
    STAGE_X,
    STAGE_W,
  );
  const hypothesis = outQuart(span(t, T.wspPropose + 0.15, 0.35));
  const candidate = outQuart(span(t, T.wspEdits - 0.05, 0.35));
  const evaluating = t >= T.wspTest - 0.1;
  return (
    <div className="absolute inset-0 flex flex-col gap-3.5 bg-ground px-7 pt-5">
      <div className="flex items-center gap-3">
        <h1 className={`m-0 ${TYPE} text-[30px] leading-none`}>Loops in long answers</h1>
        <Badge>Running</Badge>
      </div>
      <div className="relative -ml-3 h-8 text-[13px]">
        <span
          aria-hidden
          className="absolute top-0 h-8 rounded-full bg-selected"
          style={{ left: stage.x, width: stage.w }}
        />
        {STAGES.map((name, index) => (
          <span
            key={name}
            className={`absolute top-0 flex h-8 items-center justify-center gap-1.5 whitespace-nowrap ${index === stage.at ? 'font-medium' : ''}`}
            style={{ left: STAGE_X[index], width: STAGE_W[index] }}
          >
            {index < stage.at && <Check size={13} strokeWidth={2.2} aria-hidden />}
            {name}
          </span>
        ))}
      </div>
      <p className="m-0 flex items-center gap-2.5 text-[14px]">
        <Spinner tone="mentor" size={15} />
        {evaluating ? 'Evaluating the candidate on dev' : 'Program 1 is proposing an edit'}
      </p>
      <div
        className="flex flex-col gap-2 rounded-card bg-card px-5 py-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
        style={{ opacity: hypothesis, transform: `translateY(${(1 - hypothesis) * 8}px)` }}
      >
        <span className="flex items-center gap-2 text-[14px] font-medium">
          <Lightbulb size={15} strokeWidth={1.8} className="text-mentor" aria-hidden />
          GPT-6 Astra&apos;s hypothesis
        </span>
        <span className="text-[14px] leading-snug">
          Repetition comes from a few late heads that copy the previous sentence.
        </span>
      </div>
      <div
        className="flex h-[52px] items-center gap-4 rounded-card bg-card px-5 text-[14px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]"
        style={{ opacity: candidate, transform: `translateY(${(1 - candidate) * 8}px)` }}
      >
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="font-medium">Candidate</span>
          <span className="font-mono text-[12px]">wspc-a7937b64b8ca</span>
        </span>
        <span className="flex items-center gap-2">
          <Spinner tone="mentor" size={14} />
          Evaluating
        </span>
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
            <span className="flex items-center gap-5" style={{ zoom: 2 }}>
              <span style={riseIn(t, T.wspName + 0.75)}>
                <Badge>Experimental</Badge>
              </span>
              <span style={riseIn(t, T.wspChoose - 0.35)}>
                <Badge>Preview</Badge>
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
