import type { ReactNode } from 'react';
import { StepTransition } from '@architect/ui';
import type { Route } from '../lib/router';
import { AgentSettingsModal } from '../workspace/settings/AgentSettingsModal';
import { useWorkspaceEvents } from '../workspace/store';
import { Sidebar } from './Sidebar';

/** The "Use" layout: the agents sidebar on the left, the current screen on the right. */
export function WorkspaceShell({ route, children }: { route: Route; children: ReactNode }) {
  useWorkspaceEvents();
  return (
    <div className="flex h-full bg-ground">
      <Sidebar route={route} />
      <main className="flex min-w-0 flex-1 flex-col">
        <StepTransition
          transitionKey={route.name === 'chat' ? route.chatId : route.name}
          className="flex min-h-0 flex-1 flex-col"
        >
          {children}
        </StepTransition>
      </main>
      <AgentSettingsModal route={route} />
    </div>
  );
}

export interface WorkspaceHeaderProps {
  title?: ReactNode;
  /** Right side, such as a status badge or an icon button. */
  actions?: ReactNode;
}

/** The draggable header above a chat. It leaves room for the native window controls. */
export function WorkspaceHeader({ title, actions }: WorkspaceHeaderProps) {
  return (
    <header className="app-drag flex min-h-14 shrink-0 items-center justify-between gap-3 py-2 pl-7 pr-window-controls [--window-controls-gap:20px]">
      <h1 className="m-0 min-w-0 truncate text-body font-medium">{title}</h1>
      {actions}
    </header>
  );
}
