import { useId } from 'react';
import { motion } from 'motion/react';
import { ToggleGroup } from 'radix-ui';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
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
      className={cn('inline-flex shrink-0 rounded-full bg-field p-[3px] shadow-edge', className)}
    >
      {options.map((option) => (
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
          <span className="relative">{option.label}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
