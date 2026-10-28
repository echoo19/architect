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
    if (shown.current) button.scrollIntoView({ block: 'nearest' });
    else if (current > 0) button.scrollIntoView({ block: 'center' });
    shown.current = true;
    if (focusOnMove.current) {
      focusOnMove.current = false;
      button.focus({ preventScroll: true });
    }
  }, [current]);

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
  /** `mentor` for a step the mentor took as the agent, `muted` for one replayed as it was. */
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
          'flex min-w-0 flex-col rounded-lg border-l-2 transition-colors duration-150',
          tone === 'mentor' ? 'border-mentor' : 'border-transparent',
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
            'flex min-h-9 w-full min-w-0 items-start gap-3 rounded-lg px-3 py-2 text-left text-sm',
            !isCurrent && 'hover:bg-row-hover',
            tone === 'muted' && !isCurrent ? 'text-fg-muted' : 'text-fg',
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
      <span className="mr-1.5 font-mono text-sm tabular-nums text-fg-muted">
        {count === 0 ? 0 : current + 1} of {count}
      </span>
      <IconButton
        label="Step before"
        size="xs"
        disabled={current <= 0}
        onClick={() => onCurrentChange(current - 1)}
      >
        <ChevronUp size={15} strokeWidth={1.8} aria-hidden />
      </IconButton>
      <IconButton
        label="Step after"
        size="xs"
        disabled={current >= count - 1}
        onClick={() => onCurrentChange(current + 1)}
      >
        <ChevronDown size={15} strokeWidth={1.8} aria-hidden />
      </IconButton>
    </div>
  );
}
