import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/cn';
import { IconButton } from './icon-button';

interface StepListState {
  current: number;
  select(index: number, focus: boolean): void;
  register(index: number, button: HTMLButtonElement | null): void;
}

const StepListContext = createContext<StepListState | null>(null);

function useStepList(): StepListState {
  const state = useContext(StepListContext);
  if (!state) throw new Error('A StepListItem belongs inside a StepList.');
  return state;
}

/** The nearest ancestor that scrolls vertically, such as a drawer's body. */
function scroller(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') return parent;
  }
  return null;
}

/**
 * Brings a step into its scroller's view: to the middle, or just into view. Only the scroller
 * moves, never a container that clips without scrolling, such as a drawer's frame.
 */
function reveal(element: HTMLElement, middle: boolean): void {
  const box = scroller(element);
  if (!box) return;
  const view = box.getBoundingClientRect();
  const item = element.getBoundingClientRect();
  if (middle) {
    box.scrollTop += item.top + item.height / 2 - (view.top + view.height / 2);
  } else if (item.top < view.top) {
    box.scrollTop += item.top - view.top;
  } else if (item.bottom > view.bottom) {
    box.scrollTop += item.bottom - view.bottom;
  }
}

/** The keys that move through the steps, and where each one goes. */
function moveFor(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowDown':
    case 'j':
      return Math.min(count - 1, current + 1);
    case 'ArrowUp':
    case 'k':
      return Math.max(0, current - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

export interface StepListProps {
  'aria-label': string;
  /** How many steps the list holds. */
  count: number;
  /** The step shown in full. */
  current: number;
  onCurrentChange: (index: number) => void;
  /**
   * Whether a list that opens at a later step scrolls it to the middle, as when it opens at the
   * step a finding names. Off where the content above the list should stay in view first.
   */
  revealOnOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Steps a person goes through one at a time, such as an agent's tool calls: every step shows
 * its line, the current one shows everything under it. Up and Down (or K and J), Home and End move
 * through them from the keyboard, a click picks one, and the current step is kept in view.
 */
export function StepList({
  count,
  current,
  onCurrentChange,
  revealOnOpen = true,
  children,
  className,
  ...props
}: StepListProps) {
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const focusOnMove = useRef(false);
  const shown = useRef(false);

  useEffect(() => {
    const button = buttons.current.get(current);
    if (!button) return;
    // A list that opens at a later step brings it to the middle; after that, only into view.
    if (shown.current) reveal(button, false);
    else if (current > 0 && revealOnOpen) reveal(button, true);
    shown.current = true;
    if (focusOnMove.current) {
      focusOnMove.current = false;
      button.focus({ preventScroll: true });
    }
  }, [current, revealOnOpen]);

  const select = useCallback(
    (index: number, focus: boolean) => {
      focusOnMove.current = focus;
      if (index !== current) onCurrentChange(index);
      else if (focus) buttons.current.get(index)?.focus();
    },
    [current, onCurrentChange],
  );

  const state = useMemo<StepListState>(
    () => ({
      current,
      select,
      register: (index, button) => {
        if (button) buttons.current.set(index, button);
        else buttons.current.delete(index);
      },
    }),
    [current, select],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLOListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = moveFor(event.key, current, count);
    if (target === null) return;
    event.preventDefault();
    select(target, true);
  };

  return (
    <StepListContext.Provider value={state}>
      <ol
        aria-label={props['aria-label']}
        onKeyDown={onKeyDown}
        className={cn('m-0 flex list-none flex-col gap-0.5 p-0', className)}
      >
        {children}
      </ol>
    </StepListContext.Provider>
  );
}

export type StepTone = 'default' | 'mentor' | 'muted';

export interface StepListItemProps {
  index: number;
  /** The step's line, always shown. */
  line: ReactNode;
  /** At the start of the line, such as the step's number. */
  lead?: ReactNode;
  /** Above the step, outside it: a marker such as where a correction began. */
  before?: ReactNode;
  /**
   * `mentor` for a step the mentor took as the agent, with the mentor's color along its edge;
   * `muted` for one replayed as it was, with a plain hairline along its edge.
   */
  tone?: StepTone;
  /** What the step showed, under its line while it is the current step. */
  children?: ReactNode;
}

export function StepListItem({
  index,
  line,
  lead,
  before,
  tone = 'default',
  children,
}: StepListItemProps) {
  const { current, select, register } = useStepList();
  const isCurrent = index === current;
  return (
    <li className="flex min-w-0 flex-col">
      {before}
      <div
        className={cn(
          'flex min-w-0 flex-col rounded-control border-l-2 transition-colors duration-150',
          tone === 'mentor' && 'border-mentor',
          tone === 'muted' && 'border-line-strong',
          tone === 'default' && 'border-transparent',
          isCurrent && 'bg-selected',
        )}
      >
        <button
          ref={(button) => register(index, button)}
          type="button"
          tabIndex={isCurrent ? 0 : -1}
          aria-current={isCurrent ? 'step' : undefined}
          onClick={() => select(index, false)}
          className={cn(
            'flex min-h-10 w-full min-w-0 items-start gap-3 rounded-control px-3 py-2 text-left text-small',
            !isCurrent && 'hover:bg-hover',
          )}
        >
          {lead}
          <span className="flex min-w-0 flex-1 flex-col gap-1">{line}</span>
        </button>
        {isCurrent && children && (
          <div className="flex min-w-0 flex-col gap-3 pb-3.5 pl-12 pr-3">{children}</div>
        )}
      </div>
    </li>
  );
}

export interface StepListNavProps {
  count: number;
  current: number;
  onCurrentChange: (index: number) => void;
  className?: string;
}

/** "3 of 9" with buttons to the step before and after, for a StepList's heading. */
export function StepListNav({ count, current, onCurrentChange, className }: StepListNavProps) {
  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      <span className="mr-1.5 text-small tabular-nums">
        Step {count === 0 ? 0 : current + 1} of {count}
      </span>
      <IconButton
        label="Step before"
        title="Step before (Up or K in the list)"
        size="xs"
        disabled={current <= 0}
        onClick={() => onCurrentChange(current - 1)}
      >
        <ChevronUp size={15} strokeWidth={1.8} aria-hidden />
      </IconButton>
      <IconButton
        label="Step after"
        title="Step after (Down or J in the list)"
        size="xs"
        disabled={current >= count - 1}
        onClick={() => onCurrentChange(current + 1)}
      >
        <ChevronDown size={15} strokeWidth={1.8} aria-hidden />
      </IconButton>
    </div>
  );
}
