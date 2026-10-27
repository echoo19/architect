import { Switch as RadixSwitch } from 'radix-ui';
import { cn } from '../lib/cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  className,
  ...aria
}: SwitchProps) {
  return (
    <RadixSwitch.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      {...aria}
      className={cn(
        'relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full bg-switch-off',
        'transition-colors duration-150 data-[state=checked]:bg-primary',
        'disabled:cursor-default disabled:opacity-40',
        className,
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          'block size-4 translate-x-[3px] rounded-full bg-switch-knob-off',
          'transition-[translate,background-color] duration-[180ms] ease-out-soft',
          'data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-on-primary',
        )}
      />
    </RadixSwitch.Root>
  );
}
