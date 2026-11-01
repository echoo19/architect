import type { CSSProperties, ReactNode } from 'react';
import { AgentAvatar, cn, LogoMark, NavItem } from '@architect/ui';
import {
  Boxes,
  Check,
  Cpu,
  Ellipsis,
  FlaskConical,
  LayoutGrid,
  Library,
  Plus,
  Settings,
  Users,
  X,
} from 'lucide-react';
import { SPECIALISTS, TEAM } from './data';
import { mix, outQuart, span } from './time';

/**
 * Architect Lab's window, rebuilt from the app's shell (apps/desktop shell/Sidebar.tsx,
 * PlacePage.tsx, FlowShell.tsx) with the product's own parts. Rows sit at fixed heights so the
 * film can measure where a selection or a hand-off lands.
 */

export const WINDOW = { width: 1150, height: 640 } as const;
export const SIDEBAR = 240;

const noop = () => undefined;

export const PLACES = [
  { id: 'lab', label: 'Lab', Icon: LayoutGrid },
  { id: 'fields', label: 'Fields', Icon: Library },
  { id: 'experiments', label: 'Experiments', Icon: FlaskConical },
  { id: 'models', label: 'Models', Icon: Boxes },
  { id: 'compute', label: 'Compute', Icon: Cpu },
] as const;

/** Where the sidebar's rows sit, from the window's top. */
export const ROW = {
  place: (index: number) => 64 + index * 42,
  newAgent: 300,
  agent: (index: number) => 348 + index * 42,
  height: 40,
};

/** The agent whose chat opens in the film, and the height its chat row takes once it is there. */
export const CHAT_AGENT = 2;
const CHAT_ROW = 36;

export interface SidebarState {
  /** The selected fill: its top, and how much of it shows. */
  fillTop: number;
  fillHeight: number;
  fill: number;
  /** How far the chat row under the academy desk has opened, from 0 to 1. */
  chat: number;
  /** The agents' rows are drawn by the hand-off until it lands. */
  agents: number;
  /** The rest of the sidebar's contents. */
  rest: number;
  /**
   * How far the agents' list has scrolled down to the team under them, from 0 to 1. Left out,
   * the list holds only the agents, as the walkthrough's Lab has them.
   */
  team?: number;
}

/** Where the list starts, under New agent, and where it ends, over Settings. */
const LIST = { top: 342, bottom: 572 } as const;

/** How far the list scrolls to bring the team's agents up to the first agent's row. */
export const TEAM_SCROLL = ROW.agent(SPECIALISTS.length) + CHAT_ROW - ROW.agent(0);

/** The team's rows once the list has scrolled to them: its two agents, the team, its chat. */
export const TEAM_ROW = {
  agent: (index: number) => ROW.agent(index),
  team: ROW.agent(2) + 10,
  chat: ROW.agent(2) + 10 + ROW.height,
  chatHeight: CHAT_ROW,
} as const;

export function Sidebar({ state, style }: { state: SidebarState; style?: CSSProperties }) {
  const chatOpen = state.chat * CHAT_ROW;
  return (
    <aside className="absolute inset-y-0 left-0 bg-ground" style={{ width: SIDEBAR, ...style }}>
      <div
        aria-hidden
        className="absolute inset-y-0 right-0 w-px bg-line"
        style={{ opacity: state.rest }}
      />
      <div
        aria-hidden
        className="absolute left-3 right-3 rounded-control bg-selected"
        style={{ top: state.fillTop, height: state.fillHeight, opacity: state.fill }}
      />
      <div style={{ opacity: state.rest }}>
        <div className="absolute left-5 top-5 flex items-center gap-2.5">
          <LogoMark size={20} />
          <span className="text-body font-semibold">Architect Lab</span>
        </div>
        {PLACES.map(({ id, label, Icon }, index) => (
          <div key={id} className="absolute left-3 right-3" style={{ top: ROW.place(index) }}>
            <NavItem icon={<Icon size={16} strokeWidth={1.8} aria-hidden />} onClick={noop}>
              {label}
            </NavItem>
          </div>
        ))}
        <div className="absolute left-3 right-3 border-t border-line" style={{ top: 284 }} />
        <div
          className="absolute left-3 right-3 flex h-10 items-center gap-2.5 px-2.5"
          style={{ top: ROW.newAgent }}
        >
          <Plus size={16} strokeWidth={1.8} aria-hidden />
          <span className="flex-1">New agent</span>
          <Ellipsis size={16} strokeWidth={1.8} aria-hidden />
        </div>
      </div>
      {state.team === undefined ? (
        <Agents chatOpen={chatOpen} chat={state.chat} shown={state.agents} />
      ) : (
        <div
          className="absolute inset-x-0 overflow-hidden"
          style={{ top: LIST.top, height: LIST.bottom - LIST.top }}
        >
          <div
            className="absolute inset-x-0"
            style={{ top: -LIST.top, transform: `translateY(${-state.team * TEAM_SCROLL}px)` }}
          >
            <Agents chatOpen={chatOpen} chat={state.chat} shown={state.agents} />
            <TeamRows top={TEAM_SCROLL} shown={Math.min(1, state.team * 3)} />
          </div>
        </div>
      )}
      <div style={{ opacity: state.rest }}>
        <div className="absolute bottom-[68px] left-3 right-3 border-t border-line" />
        <div className="absolute bottom-[16px] left-3 right-3 flex h-10 items-center gap-2.5 px-2.5">
          <Settings size={16} strokeWidth={1.8} aria-hidden />
          Settings
        </div>
      </div>
    </aside>
  );
}

/** The Lab's agents in the sidebar, and the chat open under the academy desk. */
function Agents({ chatOpen, chat, shown }: { chatOpen: number; chat: number; shown: number }) {
  return (
    <>
      <div style={{ opacity: shown }}>
        {SPECIALISTS.map((agent, index) => (
          <div
            key={agent.name}
            className="absolute left-3 right-3"
            style={{ top: ROW.agent(index) + (index > CHAT_AGENT ? chatOpen : 0) }}
          >
            <AgentRow name={agent.name} />
          </div>
        ))}
      </div>
      <div
        className="absolute left-3 right-3 overflow-hidden"
        style={{ top: ROW.agent(CHAT_AGENT) + ROW.height, height: chatOpen }}
      >
        <div
          className="flex h-9 items-center truncate pl-11 pr-2.5"
          style={{ opacity: outQuart(span(chat, 0.4, 0.6)) }}
        >
          Vito missed question 6
        </div>
      </div>
    </>
  );
}

/** The team's agents, the team and its chat, `top` pixels under where the agents start. */
function TeamRows({ top, shown }: { top: number; shown: number }) {
  return (
    <div style={{ opacity: shown }}>
      {[TEAM.lead, TEAM.teammate].map((name, index) => (
        <div
          key={name}
          className="absolute left-3 right-3"
          style={{ top: top + TEAM_ROW.agent(index) }}
        >
          <AgentRow name={name} />
        </div>
      ))}
      <div
        className="absolute left-3 right-3 flex h-10 items-center gap-2.5 px-2.5"
        style={{ top: top + TEAM_ROW.team }}
      >
        <span className="flex size-5 shrink-0 items-center justify-center">
          <Users size={16} strokeWidth={1.8} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{TEAM.name}</span>
      </div>
      <div
        className="absolute left-3 right-3 flex h-9 items-center pl-11 pr-2.5"
        style={{ top: top + TEAM_ROW.chat }}
      >
        <span className="min-w-0 truncate">{TEAM.chat}</span>
      </div>
    </div>
  );
}

/** An agent's row in the sidebar: its mark and its name. The hand-off lands on exactly this. */
export function AgentRow({ name }: { name: string }) {
  return (
    <div className="flex h-10 items-center gap-2.5 px-2.5">
      <AgentAvatar name={name} />
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
    </div>
  );
}

const STEPS = ['Describe', 'Define', 'Train', 'Results'] as const;

/** The guided flow's bar: close, the job's name, and the stepper with its pill on the current step. */
export function FlowHeader({
  title,
  step,
  style,
}: {
  title: string;
  /** The current step, as a position that may lie between two steps while the pill slides. */
  step: number;
  style?: CSSProperties;
}) {
  const pillLeft = mix(stepLeft(Math.floor(step)), stepLeft(Math.ceil(step)), step % 1);
  return (
    <header
      className="absolute inset-x-0 top-0 flex h-14 items-center border-b border-line bg-ground"
      style={style}
    >
      <span className="ml-6 flex items-center gap-4">
        <X size={18} strokeWidth={1.8} aria-hidden />
        <span className="font-medium">{title}</span>
      </span>
      <div
        className="absolute left-1/2 top-1/2 h-9 -translate-x-1/2 -translate-y-1/2"
        style={{ width: 420 }}
      >
        <span
          aria-hidden
          className="absolute top-0 h-9 rounded-full bg-selected"
          style={{ left: pillLeft, width: 100 }}
        />
        {STEPS.map((name, index) => (
          <span
            key={name}
            className="absolute top-0 flex h-9 items-center justify-center gap-1.5 text-ui"
            style={{ left: stepLeft(index), width: 100 }}
          >
            {index < step - 0.5 && <Check size={14} strokeWidth={2} aria-hidden />}
            {name}
          </span>
        ))}
      </div>
    </header>
  );
}

const stepLeft = (index: number) => index * 105;

/** A place's page: the drag strip, the title row and the column the page's content sits in. */
export function PlacePage({
  title,
  status,
  action,
  children,
  className,
}: {
  title: ReactNode;
  status?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-7 px-10 pt-12', className)}>
      <div className="flex min-h-12 items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="m-0 truncate font-display text-title font-semibold">{title}</h1>
          {status}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
