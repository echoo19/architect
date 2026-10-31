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
  X,
} from 'lucide-react';
import { SPECIALISTS } from './data';
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
}

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
      <div style={{ opacity: state.agents }}>
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
          style={{ opacity: outQuart(span(state.chat, 0.4, 0.6)) }}
        >
          Vito missed question 6
        </div>
      </div>
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

/** A row's leading mark, as the Lab draws it: an icon on a quiet tile. */
export function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-control bg-selected [&_svg]:size-4',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A card as the app draws one, without the library card's own entrance (the film moves it). */
export function Panel({
  title,
  action,
  children,
  className,
  bodyClass,
  frame,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  /** A name the camera can frame this card by. */
  frame?: string;
}) {
  return (
    <section
      data-frame={frame}
      className={cn('flex min-w-0 flex-col rounded-card bg-card shadow-edge', className)}
    >
      <div className="flex min-h-14 items-center gap-2.5 pl-6 pr-4 pt-1">
        <h2 className="m-0 min-w-0 flex-1 truncate font-display text-body font-semibold">
          {title}
        </h2>
        {action}
      </div>
      <div className={cn('flex min-h-0 flex-1 flex-col', bodyClass)}>{children}</div>
    </section>
  );
}

/** A hairline row inside a flush card. */
export function Row({
  icon,
  title,
  detail,
  end,
  className,
  style,
  selected,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  end?: ReactNode;
  className?: string;
  style?: CSSProperties;
  selected?: number;
}) {
  return (
    <div
      className={cn(
        'relative flex min-h-14 w-full items-center gap-3 border-t border-line px-6 py-2.5 text-ui',
        className,
      )}
      style={style}
    >
      {selected !== undefined && selected > 0 && (
        <span aria-hidden className="absolute inset-0 bg-selected" style={{ opacity: selected }} />
      )}
      {icon && <span className="relative flex shrink-0 items-center">{icon}</span>}
      <span className="relative flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{title}</span>
        {detail && <span className="truncate text-small">{detail}</span>}
      </span>
      {end && <span className="relative flex shrink-0 items-center gap-2 tabular-nums">{end}</span>}
    </div>
  );
}
