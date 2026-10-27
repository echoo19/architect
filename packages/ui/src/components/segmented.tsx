import { ToggleGroup } from 'radix-ui';
import { cn } from '../lib/cn';

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
      className={cn('inline-flex shrink-0 rounded-md bg-hover p-[3px]', className)}
    >
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className={cn(
            'h-[30px] rounded-sm px-3 text-sm text-fg-secondary transition-colors duration-150',
            'hover:text-fg disabled:pointer-events-none disabled:opacity-40',
            'data-[state=on]:bg-segment-active data-[state=on]:text-fg data-[state=on]:shadow-segment',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
