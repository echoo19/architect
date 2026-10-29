import type { CSSProperties, ReactNode } from 'react';
import { AgentAvatar, Badge, cn, Composer, IconButton, LogoMark } from '@architect/ui';
import {
  ChevronDown,
  Ellipsis,
  HardDrive,
  Laptop,
  Layers,
  Lock,
  Plus,
  Settings,
} from 'lucide-react';
import { noop } from './noop';

/**
 * The pieces of Architect's window that screens share: the frame, the agents sidebar, the chat's
 * header, the composer and the quiet line under it. They use the product's own components and
 * tokens so the page's mocks and the app cannot drift apart.
 */

export function AppWindow({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'absolute overflow-hidden rounded-[10px] border border-line-control bg-ground',
        'shadow-[0_28px_70px_-28px_rgb(0_0_0/0.8)]',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

export interface SidebarChat {
  title: string;
  /** The chat that is open. */
  current?: boolean;
  /** A change in it is waiting for the person to allow it. */
  awaitsApproval?: boolean;
}

export interface SidebarAgent {
  name: string;
  chats: readonly SidebarChat[];
}

const navRow =
  'flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-fg-secondary';

/** The agents sidebar, as the workspace draws it. */
export function Sidebar({
  agents,
  className,
}: {
  agents: readonly SidebarAgent[];
  className?: string;
}) {
  return (
    <nav
      className={cn(
        'flex h-full w-60 shrink-0 flex-col gap-5 border-r border-line bg-sidebar px-3 pb-3.5',
        className,
      )}
    >
      <div className="-mx-3 flex h-12 shrink-0 items-center gap-2.5 px-5.5 pt-5">
        <LogoMark size={20} />
        <span className="text-md font-semibold tracking-tight">Architect</span>
      </div>
      <div className="flex items-center gap-0.5">
        <span className={cn(navRow, 'min-w-0 flex-1')}>
          <Plus size={16} strokeWidth={1.8} aria-hidden />
          New agent
        </span>
        <IconButton label="Agent menu" size="md" tabIndex={-1}>
          <Ellipsis size={16} strokeWidth={1.8} aria-hidden />
        </IconButton>
      </div>
      <div className="flex flex-col gap-3">
        {agents.map((agent) => (
          <div key={agent.name} className="flex flex-col gap-0.5">
            <div className="flex h-9 items-center gap-2.5 pl-2.5 pr-0.5">
              <AgentAvatar name={agent.name} className="text-[13px]!" />
              <span className="min-w-0 flex-1 truncate font-medium">{agent.name}</span>
              <IconButton label={`New chat with ${agent.name}`} size="xs" tabIndex={-1}>
                <Plus size={14} strokeWidth={1.8} aria-hidden />
              </IconButton>
              <IconButton label={`${agent.name} settings`} size="xs" tabIndex={-1}>
                <Ellipsis size={16} strokeWidth={1.8} aria-hidden />
              </IconButton>
            </div>
            {agent.chats.map((chat) => (
              <span
                key={chat.title}
                className={cn(
                  'flex h-[34px] w-full shrink-0 items-center justify-between gap-2 rounded-md pl-[38px] pr-2.5 transition-colors duration-200',
                  chat.current ? 'bg-hover text-fg' : 'text-fg-secondary',
                )}
              >
                <span className="truncate">{chat.title}</span>
                {chat.awaitsApproval && !chat.current && (
                  <span className="shrink-0 text-sm font-medium text-student">Approve</span>
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="flex-1" />
      <span className={navRow}>
        <Settings size={17} strokeWidth={1.6} aria-hidden />
        Settings
      </span>
    </nav>
  );
}

/** The bar over a chat: its title, and that the agent is running on this computer. */
export function ChatHeader({ title, className }: { title: ReactNode; className?: string }) {
  return (
    <header
      className={cn(
        'flex min-h-14 shrink-0 items-center justify-between gap-3 py-2 pl-7 pr-5',
        'narrow:flex-col narrow:items-start narrow:gap-1.5 narrow:px-4 narrow:py-3',
        className,
      )}
    >
      <h3 className="m-0 min-w-0 max-w-full truncate text-md font-medium">{title}</h3>
      <Badge icon={<Laptop size={14} strokeWidth={1.6} aria-hidden />}>
        Running on this computer
      </Badge>
    </header>
  );
}

const modeButton =
  'flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-line-control px-3 text-sm text-fg-secondary [&_svg]:shrink-0';

/** The composer under a chat, with the write setting beside it. */
export function ChatComposer({
  agent,
  placeholder,
  version,
  className,
}: {
  agent: string;
  placeholder?: string;
  /** The version answering, under the box. */
  version?: number;
  className?: string;
}) {
  return (
    <div className={cn('shrink-0 px-8 pb-2.5 narrow:px-4', className)}>
      <Composer
        className="mx-auto"
        label={`Message ${agent}`}
        placeholder={placeholder ?? `Ask ${agent}`}
        value=""
        onValueChange={noop}
        onSubmit={noop}
        leading={
          <span className={modeButton}>
            <Lock size={14} strokeWidth={1.8} aria-hidden />
            Saving files: Ask first
            <ChevronDown size={13} strokeWidth={1.8} aria-hidden />
          </span>
        }
      />
      <ChatStatusBar {...(version === undefined ? {} : { version })} />
    </div>
  );
}

/** The quiet line under the composer: the version answering, and the model it runs on. */
export function ChatStatusBar({
  version = 2,
  className,
}: {
  version?: number;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'mx-auto mb-0 mt-2.5 flex max-w-[720px] flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-fg-muted',
        className,
      )}
    >
      <span className="flex items-center gap-1.5">
        <Layers size={13} strokeWidth={1.8} aria-hidden />
        Version {version}
      </span>
      <span className="flex items-center gap-1.5">
        <HardDrive size={13} strokeWidth={1.8} aria-hidden />
        Glimmer
      </span>
    </p>
  );
}
