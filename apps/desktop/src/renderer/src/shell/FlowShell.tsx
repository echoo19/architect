import type { ReactNode } from 'react';
import { cn, IconButton, ProgressStepper } from '@architect/ui';
import { X } from 'lucide-react';
import { isMac } from '../lib/platform';
import { navigate, paths } from '../lib/router';

const FLOW_STEPS = ['Describe', 'Define', 'Train', 'Graduate'] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

export interface FlowShellProps {
  /** The job's name once it has one; "New agent" before. */
  title: ReactNode;
  step: FlowStep;
  /** Header buttons on the right, such as Pause and Stop. */
  actions?: ReactNode;
  /** A bar pinned under the content, such as Back and Start training. */
  footer?: ReactNode;
  children: ReactNode;
}

/** The "Make" layout: a header with the step pills over a dot-grid ground. */
export function FlowShell({ title, step, actions, footer, children }: FlowShellProps) {
  return (
    <div className="flex h-full flex-col bg-ground-flow">
      {/*
        Two equal grid tracks keep the steps centered in the window. The side columns take the
        insets for the macOS traffic lights and the Windows and Linux window controls.
      */}
      <header className="app-drag grid min-h-[60px] shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line bg-ground-flow px-4 py-2.5">
        <div className={cn('flex min-w-0 items-center gap-2', isMac() && 'pl-17')}>
          <IconButton label="Close" onClick={() => navigate(paths.home())}>
            <X size={18} strokeWidth={1.8} aria-hidden />
          </IconButton>
          <span className="min-w-0 truncate font-medium">{title}</span>
        </div>
        <ProgressStepper steps={FLOW_STEPS} current={FLOW_STEPS.indexOf(step)} />
        <div className="flex min-w-0 justify-end gap-2 pr-window-controls">{actions}</div>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto bg-dot-grid">{children}</main>
      {footer && (
        <footer className="shrink-0 border-t border-line bg-ground-flow px-8 py-4">{footer}</footer>
      )}
    </div>
  );
}
