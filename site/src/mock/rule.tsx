import { Button } from '@architect/ui';
import { Check } from 'lucide-react';
import { FlowBar } from './flow-bar';
import { AppWindow } from './frame';
import { Swap } from './kit';
import { at } from './motion';
import { EXAMPLE, JOB_NAME, RULE_LABEL, RULE_STEPS, stepPieces } from './repair-rule';
import { ChapterStage } from './stage';

/**
 * The rule as the Define screen shows it: Spark's reading of the repair shop's pricing as five
 * steps, one of the shop's own tickets worked through them, and the person's confirmation. The
 * steps and the working are the app's, read from the draft the way the app reads it; as the
 * working comes up line by line, the step each line belongs to is lit.
 */

/** The step of the rule each line of the working comes from, by index. */
const LINE_STEP = [0, 1, 2, 2, 3, 4] as const;

/** When things happen, in ms from the start. */
const STEPS = 350;
const STEP_GAP = 130;
const CARD = 1200;
const LINES = 1900;
const LINE_GAP = 640;
const ANSWER = LINES + 6 * LINE_GAP + 200;
const CONFIRM = ANSWER + 1100;

/** One line of the working: the step it applies, and the number it came to. */
function Working() {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {EXAMPLE.lines.map((line, index) => {
        const last = index === EXAMPLE.lines.length - 1;
        return (
          <li
            key={line.text}
            className="a a-up flex min-h-10 items-center justify-between gap-6 border-t border-line tabular-nums"
            style={at(LINES + index * LINE_GAP, { dy: 8, dur: 520 })}
          >
            <span className={last ? 'font-medium' : undefined}>{line.text}</span>
            <span className={last ? 'font-medium' : undefined}>{line.value}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function RuleMock() {
  return (
    <ChapterStage
      id="rule"
      label="The Architect Define screen for the repair shop's ticket costs. Spark's rule is five steps: round labor hours up to a multiple of 0.5, multiply by 65, take 10% off when the customer is a member, add parts cost, and round to the nearest cent. Beside it, ticket T-2014 is worked through the steps, line by line, to $292.50. The person presses Confirm the rule, and Start training becomes available."
      heightWide={700}
    >
      <AppWindow className="inset-x-3 bottom-3 top-3 flex flex-col wide:inset-x-7 wide:top-6">
        <FlowBar title={JOB_NAME} current={1} />
        <div className="min-h-0 flex-1 overflow-hidden px-10 pt-9 narrow:px-4 narrow:pt-6">
          <h3 className="m-0 font-display text-h1 font-semibold">{RULE_LABEL}</h3>
          <div className="mt-6 grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-x-14 narrow:grid-cols-1 narrow:gap-y-8">
            <ol aria-label="The rule" className="m-0 flex list-none flex-col self-start p-0">
              {RULE_STEPS.map((step, index) => (
                <li
                  key={step.text}
                  className="a a-up relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-1 border-t border-line py-3.5 text-body"
                  style={at(STEPS + index * STEP_GAP, { dy: 12, dur: 600 })}
                >
                  {/* Lit while the line of the working that applies this step comes up. */}
                  {LINE_STEP.map((from, line) =>
                    from === index ? (
                      <span
                        key={line}
                        aria-hidden
                        className="a a-flash pointer-events-none absolute inset-x-[-12px] inset-y-0 rounded-control bg-hover opacity-0"
                        style={at(LINES + line * LINE_GAP - 100, { dur: LINE_GAP + 500 })}
                      />
                    ) : null,
                  )}
                  <span className="relative font-medium tabular-nums">{index + 1}</span>
                  <span className="relative flex flex-col gap-0.5">
                    <span>
                      {stepPieces(step).map((piece, index) =>
                        piece.file ? (
                          <span key={index} className="font-mono text-small">
                            {piece.text}
                          </span>
                        ) : (
                          piece.text
                        ),
                      )}
                    </span>
                    {step.note && <span className="text-small">{step.note}</span>}
                  </span>
                </li>
              ))}
            </ol>
            <section
              aria-label="Worked example"
              className="a a-up self-start rounded-card bg-card px-6 pb-3 pt-5 shadow-edge"
              style={at(CARD, { dy: 16, dur: 700 })}
            >
              <div className="flex items-baseline justify-between gap-4 pb-4 narrow:flex-col narrow:gap-1.5">
                <h4 className="m-0 font-sans text-body font-medium">{EXAMPLE.request}</h4>
                <span
                  className="a a-pop font-display text-h1 font-semibold tabular-nums"
                  style={at(ANSWER, { dur: 420 })}
                >
                  {EXAMPLE.answer}
                </span>
              </div>
              <ul
                aria-label="What it read from the records"
                className="a a-up m-0 flex list-none flex-wrap gap-x-6 gap-y-1 p-0 pb-4 text-ui"
                style={at(CARD + 400, { dy: 8 })}
              >
                {EXAMPLE.inputs.map((input) => (
                  <li key={input.label}>
                    {input.label} <span className="font-medium tabular-nums">{input.value}</span>
                  </li>
                ))}
              </ul>
              <Working />
            </section>
          </div>
        </div>
        <div className="flex h-[76px] shrink-0 items-center justify-between gap-3 border-t border-line px-6 narrow:px-4">
          <Button variant="secondary" size="md" tabIndex={-1} className="narrow:hidden">
            Change the description
          </Button>
          <Swap
            at={CONFIRM}
            className="ml-auto justify-items-end"
            before={
              <Button variant="primary" size="md" tabIndex={-1}>
                Confirm the rule
              </Button>
            }
            after={
              <span className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-student">
                  <Check size={16} strokeWidth={2} aria-hidden />
                  Confirmed
                </span>
                <Button variant="primary" size="md" tabIndex={-1}>
                  Start training
                </Button>
              </span>
            }
          />
        </div>
      </AppWindow>
    </ChapterStage>
  );
}
