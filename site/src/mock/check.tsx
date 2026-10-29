import { Badge, Button, cn, Heading } from '@architect/ui';
import { Check, ScrollText, SlidersHorizontal } from 'lucide-react';
import { FlowBar } from './flow-bar';
import { AppWindow } from './frame';
import { at } from './motion';
import {
  CONFIRM,
  CONFIRMED_ON,
  EXAMPLE,
  FOOTER_WAIT,
  JOB_NAME,
  RULE_LABEL,
  RULE_STEPS,
  stepPieces,
  type RuleStep,
} from './repair-rule';
import { ChapterStage } from './stage';

/** When the chapter's moments happen, in ms from the start. */
const CARD_AT = 400;
const STEPS_AT = 900;
const STEP_STEP = 280;
const EXAMPLE_AT = 2500;
const INPUTS_AT = 2900;
const INPUT_STEP = 100;
const LINES_AT = 3300;
const LINE_STEP = 300;
const ANSWER_AT = 5050;
const BAR_AT = 5550;
const PRESS_AT = 6650;
const CONFIRMED_AT = 7000;

/** The quiet name over a group inside the rule's card: "The rule, in words", "Examples". */
const groupName = 'm-0 text-sm font-normal text-fg-muted';

/** A step's words, with the files it names set quietly and what the person said after them. */
function StepWords({ step }: { step: RuleStep }) {
  return (
    <>
      {stepPieces(step).map((piece, index) =>
        piece.file ? (
          <span key={index} className="text-fg-muted">
            {piece.text}
          </span>
        ) : (
          piece.text
        ),
      )}
      {step.note !== undefined && <span className="text-fg-muted"> {step.note}</span>}
    </>
  );
}

/** The rule in words, as numbered steps: one thing done to the amount at a time. */
function Steps() {
  return (
    <ol
      aria-label="The rule, in steps"
      className="m-0 flex max-w-[640px] list-none flex-col gap-1.5 p-0 text-md"
    >
      {RULE_STEPS.map((step, index) => (
        <li
          key={step.text}
          className="a a-up grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-1"
          style={at(STEPS_AT + index * STEP_STEP, { dy: 8, dur: 520 })}
        >
          <span aria-hidden className="text-fg-muted tabular-nums">
            {index + 1}.
          </span>
          <span className="text-pretty">
            <StepWords step={step} />
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One of the rule's worked examples, from the shop's own records: the question, what was read from
 * the ticket and its customer, and the working line by line. The answer lands once it is worked out.
 */
function Example() {
  return (
    <li
      className="a a-up flex flex-col gap-3.5 rounded-2xl border border-line-card bg-panel px-5 py-[18px] narrow:px-3 narrow:py-3.5"
      style={at(EXAMPLE_AT, { dy: 16, dur: 600 })}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="min-w-0 text-md text-pretty">{EXAMPLE.request}</span>
        <span
          className="a a-up text-xl font-medium tabular-nums"
          style={at(ANSWER_AT, { dy: 8, dur: 480 })}
        >
          {EXAMPLE.answer}
        </span>
      </div>
      <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 text-sm narrow:hidden">
        {EXAMPLE.inputs.map((input, index) => (
          <div
            key={input.label}
            className="a a-up flex gap-2"
            style={at(INPUTS_AT + index * INPUT_STEP, { dy: 6, dur: 420 })}
          >
            <dt className="text-fg-muted">{input.label}</dt>
            <dd className="m-0 font-mono text-xs leading-5 text-fg-secondary">{input.value}</dd>
          </div>
        ))}
      </dl>
      <ol className="m-0 flex list-none flex-col gap-1.5 border-t border-line-row p-0 pt-3 text-sm">
        {EXAMPLE.lines.map((line, index) => (
          <li
            key={line.text}
            className={cn(
              'a a-up grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4',
              index === EXAMPLE.lines.length - 1 && 'font-medium',
            )}
            style={at(LINES_AT + index * LINE_STEP, { dy: 6, dur: 420 })}
          >
            <span className="text-pretty text-fg-secondary">{line.text}</span>
            <span className="font-mono tabular-nums">{line.value}</span>
          </li>
        ))}
      </ol>
    </li>
  );
}

/** The rule's card: what it is for, its steps, and an example worked through. */
function RuleCard() {
  return (
    <article
      aria-label={RULE_LABEL}
      className="a a-up flex flex-col gap-6 rounded-3xl border border-line-card bg-card px-7 py-[26px] narrow:gap-5 narrow:px-3.5 narrow:py-4"
      style={at(CARD_AT, { dy: 18, dur: 640 })}
    >
      <header>
        <h3 className="m-0 flex items-center gap-2.5 text-lg font-medium">
          <ScrollText size={18} strokeWidth={1.7} className="shrink-0 text-fg-muted" aria-hidden />
          {RULE_LABEL}
        </h3>
      </header>
      <div className="flex flex-col gap-3">
        <h4 className={groupName}>The rule, in words</h4>
        <Steps />
      </div>
      <div className="flex flex-col gap-3.5">
        <h4 className={cn(groupName, 'narrow:hidden')}>Examples</h4>
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
          <Example />
        </ul>
      </div>
    </article>
  );
}

/**
 * The bar under the rule: training can't start until the person confirms it. The button is
 * pressed, and the bar leaves, as it does in the app once the rule is confirmed.
 */
function ConfirmBar() {
  return (
    <div className="a a-up motion-only" style={at(BAR_AT, { dy: 14, dur: 560 })}>
      <div
        className="a a-exit-up flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-list px-6 py-5 narrow:px-4 narrow:py-4"
        style={at(CONFIRMED_AT, { dur: 280, dy: 0 })}
      >
        <p className="m-0 max-w-[430px] text-fg-secondary text-pretty">
          {CONFIRM.says[0]} <span className="narrow:hidden">{CONFIRM.says[1]}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" tabIndex={-1} className="narrow:hidden">
            {CONFIRM.change}
          </Button>
          <span className="a a-press inline-flex" style={at(PRESS_AT, { dur: 300 })}>
            <Button variant="primary" tabIndex={-1}>
              <Check size={16} strokeWidth={2} aria-hidden />
              {CONFIRM.confirm}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * The bar under the screen: Start training waits, and says why, until the rule is confirmed. When
 * it is, the line changes and the button is the one that can be pressed.
 */
function DefineFooter() {
  return (
    <footer className="shrink-0 border-t border-line bg-ground-flow px-8 py-4 narrow:px-4">
      <div className="mx-auto flex max-w-[880px] items-center justify-between gap-3">
        <Button variant="ghost" tabIndex={-1} className="-ml-3 narrow:hidden">
          <SlidersHorizontal size={16} strokeWidth={1.8} aria-hidden />
          Advanced settings
        </Button>
        <div className="flex items-center gap-2 narrow:ml-auto">
          <span className="mr-2 grid justify-items-end text-sm text-fg-muted narrow:hidden [&>*]:[grid-area:1/1]">
            <span className="a a-exit-up motion-only" style={at(CONFIRMED_AT, { dur: 240, dy: 0 })}>
              {FOOTER_WAIT.waiting}
            </span>
            <span className="a a-up" style={at(CONFIRMED_AT + 150, { dy: 6, dur: 360 })}>
              {FOOTER_WAIT.ready}
            </span>
          </span>
          <Button tabIndex={-1}>Back</Button>
          <span className="grid [&>*]:[grid-area:1/1]">
            <Button
              variant="primary"
              disabled
              tabIndex={-1}
              className="a a-exit-up motion-only"
              style={at(CONFIRMED_AT, { dur: 240, dy: 0 })}
            >
              Start training
            </Button>
            <Button
              variant="primary"
              tabIndex={-1}
              className="a a-pop"
              style={at(CONFIRMED_AT + 150, { dur: 320 })}
            >
              Start training
            </Button>
          </span>
        </div>
      </div>
    </footer>
  );
}

/**
 * The second chapter: Define, at the rule. Spark turned the repair shop's pricing policy into a
 * rule, and the screen puts it in front of the person as numbered steps with one ticket worked
 * through it. Training waits for the person to confirm it, so the chapter ends on the button.
 */
export function CheckMock() {
  return (
    <ChapterStage
      id="check"
      label="The Architect Define screen for the Repair ticket cost helper, at the rule. Spark turned the shop's pricing policy into a rule for ticket costs, shown as five steps: round labor hours up to a multiple of 0.5, multiply by 65, when member is yes multiply by 0.9, add parts cost, where an empty parts cost counts as 0 as the person said, and round the result to the nearest cent. One of the shop's own tickets, T-2014, is worked through it line by line and comes to $292.50. Start training is unavailable, and the screen says training can't start until the person confirms the rule. The person presses Confirm the rule, the rule shows as confirmed, and Start training can be pressed."
      heightWide={945}
      heightCompact={1180}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar title={JOB_NAME} current={1} />
        <div className="min-h-0 flex-1 overflow-hidden bg-ground-flow bg-dot-grid">
          <section
            aria-label="Check the rule"
            className="mx-auto box-content flex w-full max-w-[880px] flex-col gap-[18px] px-8 pt-6 narrow:box-border narrow:px-3 narrow:pt-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Heading as="h3">Check the rule</Heading>
              <span className="a a-pop inline-flex" style={at(CONFIRMED_AT + 100, { dur: 360 })}>
                <Badge tone="student" icon={<Check size={14} strokeWidth={2} aria-hidden />}>
                  <span>
                    Confirmed<span className="narrow:hidden"> on {CONFIRMED_ON}</span>
                  </span>
                </Badge>
              </span>
            </div>
            <RuleCard />
            <ConfirmBar />
          </section>
        </div>
        <DefineFooter />
      </AppWindow>
    </ChapterStage>
  );
}
