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
   * unchosen card loses the mark that invites a click.
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
        'group flex flex-col items-start gap-1.5 rounded-2xl border border-line-control bg-card',
        'px-[22px] py-5 text-left transition-colors duration-150 hover:border-fg-ghost',
        'data-[state=checked]:border-fg data-[state=checked]:bg-field',
        'disabled:pointer-events-none',
        unavailable ? 'disabled:border-line-card' : 'disabled:opacity-40',
        className,
      )}
    >
      <span
        className={cn(
          'flex w-full items-center justify-between gap-3 text-lg font-medium',
          unavailable && 'text-fg-muted',
        )}
      >
        {title}
        <span
          aria-hidden
          className={cn(
            'size-[18px] shrink-0 rounded-full border-[1.5px] border-fg-ghost transition-[border] duration-150',
            'group-data-[state=checked]:border-[5px] group-data-[state=checked]:border-fg',
            unavailable && 'group-data-[state=unchecked]:invisible',
          )}
        />
      </span>
      {children && <span className="flex flex-col gap-1.5 text-fg-secondary">{children}</span>}
    </RadioGroup.Item>
  );
}
