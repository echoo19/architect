import type { ReactNode } from 'react';
import type { RuleStep } from '@architect/shared';
import { cn } from '@architect/ui';

/** A piece of a step's words: plain, or a file's name in brackets that is set quietly. */
export interface StepPiece {
  text: string;
  file: boolean;
}

/**
 * A step's words cut around the files it names in brackets, "(customers.csv)", so the screen can
 * set each of them quietly beside the sentence instead of giving it the sentence's weight.
 */
export function stepPieces(text: string, files: readonly string[] = []): StepPiece[] {
  if (files.length === 0) return [{ text, file: false }];
  const brackets = files.map((file) => `(${file})`);
  const pattern = new RegExp(
    `(${brackets.map((bracket) => bracket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
  );
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, file: brackets.includes(part) }));
}

function Words({ step }: { step: RuleStep }): ReactNode {
  return (
    <>
      {stepPieces(step.text, step.files).map((piece, at) =>
        piece.file ? (
          <span key={at} className="font-mono">
            {piece.text}
          </span>
        ) : (
          piece.text
        ),
      )}
      {step.note !== undefined && <span> {step.note}</span>}
    </>
  );
}

interface RuleStepsProps {
  steps: readonly RuleStep[] | undefined;
  /** The rule as one sentence, said when there are no steps: a report made before they existed. */
  statement: string;
  /** The words' size: Define reads them at the body's, the results a step down. */
  size?: 'md' | 'sm';
  className?: string;
}

/**
 * The rule in words, as numbered steps: what is done to the amount, one thing at a time. The files
 * a step names are set quietly and what the person said it rests on follows it. A rule without
 * steps is said as its one sentence.
 */
export function RuleSteps({ steps, statement, size = 'md', className }: RuleStepsProps) {
  const text = size === 'md' ? 'text-body' : 'text-small text-fg';
  if (steps === undefined || steps.length === 0) {
    return <p className={cn('m-0 max-w-[640px] text-pretty', text, className)}>{statement}</p>;
  }
  return (
    <ol className={cn('m-0 flex max-w-[640px] list-none flex-col gap-1.5 p-0', text, className)}>
      {steps.map((step, at) => (
        <li key={`${at}:${step.text}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-1">
          <span aria-hidden className="text-fg tabular-nums">
            {at + 1}.
          </span>
          <span className="text-pretty">
            <Words step={step} />
          </span>
        </li>
      ))}
    </ol>
  );
}
