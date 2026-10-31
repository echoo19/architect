import { useEffect, useRef, type ReactNode } from 'react';
import {
  cn,
  Heading,
  LogoMark,
  ProgressStepper,
  StepTransition,
  travel,
  useTravel,
} from '@architect/ui';
import { isMac } from '../lib/platform';

const SETUP_STEPS = ['Edition', 'Model', 'Teacher', 'Faster training', 'Done'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export interface SetupShellProps {
  step: SetupStep;
  /** Buttons pinned under the content, such as Back and Continue. */
  footer?: ReactNode;
  children: ReactNode;
}

/** Where the last setup step stood, so the next one comes in from the side moved toward. */
let lastStep = -1;

/**
 * First-run setup in the flow's language: the step pills in the header, the flat ground below.
 * Each step slides in from its side as the pill slides to it, as the flow's steps do.
 */
export function SetupShell({ step, footer, children }: SetupShellProps) {
  const index = SETUP_STEPS.indexOf(step);
  const direction = useTravel(step, index, travel(lastStep, index));
  useEffect(() => {
    lastStep = index;
  }, [index]);
  return (
    <div className="flex h-full flex-col bg-ground">
      <header className="app-drag grid min-h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line bg-ground px-4 py-2">
        <div className={cn('flex min-w-0 items-center gap-2.5 pl-2.5', isMac() && 'pl-17')}>
          <LogoMark size={20} />
          <span className="truncate font-medium">Architect</span>
        </div>
        <ProgressStepper aria-label="Setup" steps={SETUP_STEPS} current={index} />
        <div className="pr-window-controls" />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-quiet">
        <StepTransition transitionKey={step} direction={direction} appear className="h-full">
          {/* From the top, so the heading stays where it is as a step's content comes and goes. */}
          <div className="flex min-h-full flex-col items-center gap-8 px-6 pb-10 pt-[clamp(40px,14vh,140px)]">
            {children}
          </div>
        </StepTransition>
      </main>
      {footer && (
        <footer className="shrink-0 border-t border-line bg-ground px-8 py-4">
          <div className="mx-auto flex max-w-[720px] flex-wrap items-center gap-2">{footer}</div>
        </footer>
      )}
    </div>
  );
}

export interface StepIntroProps {
  title: string;
  children: ReactNode;
}

/** A step's heading and one line on what it's for. The heading takes focus when it appears. */
export function StepIntro({ title, children }: StepIntroProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [title]);
  return (
    <div className="flex max-w-[600px] flex-col items-center gap-3.5 text-center">
      <Heading ref={heading} tabIndex={-1} as="h1" size="display-sm" className="outline-none">
        {title}
      </Heading>
      <p className="m-0 text-body text-fg text-pretty">{children}</p>
    </div>
  );
}
