import type { ReactNode } from 'react';
import { cn, IconButton, ProgressStepper } from '@architect/ui';
import { X } from 'lucide-react';
import { isMac } from '../lib/platform';
import { navigate, paths } from '../lib/router';

const FLOW_STEPS = ['Describe', 'Define', 'Train', 'Results'] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

/** Improve agent's steps: the lessons it was taught, the improvement, and what it changed. */
export const IMPROVE_STEPS = ['Lessons', 'Improve', 'Results'] as const;

export interface FlowShellProps<Step extends string = FlowStep> {
  /** The job's name once it has one; "New agent" before. */
  title: ReactNode;
  step: Step;
  /** The steps the pills show: the new-agent flow's unless another flow names its own. */
  steps?: readonly Step[];
  /** Steps already passed that still need something from the person, marked in the pills. */
  attention?: readonly Step[];
  /** Header buttons on the right, such as Pause and Stop. */
  actions?: ReactNode;
  /** A bar pinned under the content, such as Back and Start training. */
  footer?: ReactNode;
  /** What the close button does; going home when absent. */
  onClose?: () => void;
  /** A panel at the content's right, such as an inspector, between the header and the footer. */
  aside?: ReactNode;
  children: ReactNode;
}

/** The "Make" layout: a header with the step pills over the flat ground. */
export function FlowShell<Step extends string = FlowStep>({
  title,
  step,
  steps,
  attention,
  actions,
  footer,
  onClose,
  aside,
  children,
}: FlowShellProps<Step>) {
  const pills: readonly string[] = steps ?? FLOW_STEPS;
  return (
    <div className="flex h-full flex-col bg-ground">
      {/*
        Two equal grid tracks keep the steps centered in the window. The side columns take the
        insets for the macOS traffic lights and the Windows and Linux window controls.
      */}
      <header className="app-drag grid min-h-[60px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line bg-ground px-4 py-2.5">
        <div className={cn('flex min-w-0 items-center gap-2', isMac() && 'pl-17')}>
          <IconButton label="Close" onClick={onClose ?? (() => navigate(paths.home()))}>
            <X size={18} strokeWidth={1.8} aria-hidden />
          </IconButton>
          <span className="min-w-0 truncate font-medium">{title}</span>
        </div>
        <ProgressStepper steps={pills} current={pills.indexOf(step)} attention={attention ?? []} />
        <div className="flex min-w-0 justify-end gap-2 pr-window-controls">{actions}</div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
        {aside}
      </div>
      {footer && (
        <footer className="shrink-0 border-t border-line bg-ground px-8 py-4">{footer}</footer>
      )}
    </div>
  );
}
