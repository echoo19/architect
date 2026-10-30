import type { ReactNode } from 'react';
import { RadioGroup } from 'radix-ui';
import { cn } from '../lib/cn';

export interface RadioCardGroupProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  'aria-label': string;
  children: ReactNode;
  className?: string;
}

/** A row of selectable cards, like "Where should it train?" on the Define screen. */
export function RadioCardGroup<T extends string>({
  value,
  onValueChange,
  children,
  className,
  ...props
}: RadioCardGroupProps<T>) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => onValueChange(next as T)}
      aria-label={props['aria-label']}
      className={cn(
        'grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3',
        className,
      )}
    >
      {children}
    </RadioGroup.Root>
  );
}

export interface RadioCardProps {
  value: string;
  title: string;
  /** Supporting lines under the title, such as time and where the data goes. */
  children?: ReactNode;
  /** Locked for now, such as while a test runs: the whole card fades. */
  disabled?: boolean;
  /**
   * Can't be chosen, and its lines say why: they stay readable, the title goes quiet, and an
   * unchosen card loses the mark that invites a click. A card that is chosen keeps its title as
   * it was: it is the one in use, and whatever is wrong with it is said beside the choice.
   */
  unavailable?: boolean;
  className?: string;
}

export function RadioCard({
  value,
  title,
  children,
  disabled,
  unavailable,
  className,
}: RadioCardProps) {
  return (
    <RadioGroup.Item
      value={value}
      disabled={disabled || unavailable}
      className={cn(
        'group flex flex-col items-start gap-1.5 rounded-card bg-card shadow-edge-strong',
        'px-6 py-5 text-left transition-[background-color,box-shadow] duration-150 hover:bg-hover',
        'data-[state=checked]:inset-ring-1 data-[state=checked]:inset-ring-fg',
        'disabled:pointer-events-none',
        !unavailable && 'disabled:opacity-40',
        className,
      )}
    >
      <span
        className={cn(
          'flex w-full items-center justify-between gap-3 text-body font-medium',
          unavailable && 'group-data-[state=unchecked]:text-fg-dim',
        )}
      >
        {title}
        <span
          aria-hidden
          className={cn(
            'size-5 shrink-0 rounded-full border-[1.5px] border-line-strong transition-[border] duration-150',
            'group-data-[state=checked]:border-[6px] group-data-[state=checked]:border-fg',
            unavailable && 'group-data-[state=unchecked]:invisible',
          )}
        />
      </span>
      {children && <span className="flex flex-col gap-1.5 text-ui">{children}</span>}
    </RadioGroup.Item>
  );
}
