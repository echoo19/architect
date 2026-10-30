import { Check, ChevronDown } from 'lucide-react';
import { Select as RadixSelect } from 'radix-ui';
import { cn } from '../lib/cn';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  'aria-label': string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  ...props
}: SelectProps<T>) {
  return (
    <RadixSelect.Root
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onValueChange(option.value);
      }}
      disabled={disabled}
    >
      <RadixSelect.Trigger
        aria-label={props['aria-label']}
        className={cn(
          'inline-flex h-10 min-w-40 items-center justify-between gap-2 rounded-control',
          'bg-field pl-3.5 pr-3 text-ui text-fg shadow-edge-strong transition-shadow duration-150',
          'disabled:opacity-40 data-[placeholder]:text-fg-dim',
          className,
        )}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown size={16} aria-hidden />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={6}
          className={cn(
            'z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)]',
            'origin-[var(--radix-select-content-transform-origin)] overflow-hidden rounded-control bg-raised p-1 shadow-float',
            'data-[state=closed]:animate-fade-out data-[state=open]:animate-pop',
          )}
        >
          <RadixSelect.Viewport>
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={cn(
                  'relative flex h-9 select-none items-center rounded-mark pl-2.5 pr-8 text-ui',
                  'text-fg outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-hover',
                )}
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="absolute right-2.5 inline-flex">
                  <Check size={14} strokeWidth={2.2} aria-hidden />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
