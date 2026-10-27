import { useId, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Checkbox as RadixCheckbox } from 'radix-ui';
import { cn } from '../lib/cn';

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label next to the box. Without one, pass an aria-label. */
  label?: ReactNode;
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
  ...aria
}: CheckboxProps) {
  const id = useId();
  const box = (
    <RadixCheckbox.Root
      id={id}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      disabled={disabled}
      {...aria}
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-xs border',
        'border-line-control bg-well text-on-primary transition-colors duration-150',
        'hover:border-line-strong data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        'disabled:opacity-40',
        !label && className,
      )}
    >
      <RadixCheckbox.Indicator>
        <Check size={12} strokeWidth={2.6} aria-hidden />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
  if (!label) return box;
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {box}
      <label htmlFor={id} className={cn('select-none', disabled && 'opacity-40')}>
        {label}
      </label>
    </span>
  );
}
