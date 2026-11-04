import { useId, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ToggleGroup } from 'radix-ui';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';
import { Tooltip } from './tooltip';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** What the choice means, in a sentence, shown on hover or focus of the segment. */
  hint?: string;
  /** A small badge after the label, such as one that marks the choice experimental. */
  badge?: ReactNode;
}

export interface SegmentedProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  'aria-label': string;
  disabled?: boolean;
  className?: string;
}

/** A small set of mutually exclusive choices, such as Ask, Allow, Never. */
export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  disabled,
  className,
  ...props
}: SegmentedProps<T>) {
  // One indicator per control, so two of them on a screen never trade places.
  const indicator = useId();
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      // Radix lets a single group be emptied by clicking the active item; keep one chosen.
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onValueChange(option.value);
      }}
      disabled={disabled}
      aria-label={props['aria-label']}
      className={cn('inline-flex shrink-0 rounded-full bg-field p-1 shadow-edge', className)}
    >
      {options.map((option) => {
        const item = (
          <ToggleGroup.Item
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className={cn(
              'relative h-8 rounded-full px-3.5 text-small font-medium transition-colors duration-150',
              'hover:bg-hover disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            {option.value === value && (
              <motion.span
                layoutId={indicator}
                transition={springs.snappy}
                aria-hidden
                className="absolute inset-0 rounded-full bg-raised shadow-edge-strong"
              />
            )}
            <span className="relative flex items-center gap-2">
              {option.label}
              {option.badge}
            </span>
          </ToggleGroup.Item>
        );
        return option.hint ? (
          <Tooltip key={option.value} content={option.hint} side="bottom">
            {item}
          </Tooltip>
        ) : (
          item
        );
      })}
    </ToggleGroup.Root>
  );
}
