import { Lock } from 'lucide-react';
import { Switch as RadixSwitch } from 'radix-ui';
import { cn } from '../lib/cn';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /**
   * Can't be moved. A switch that is off fades like any control that is unavailable. One that is
   * on keeps its colors and shows a padlock on its knob, so it still reads as on, held there.
   */
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
        'disabled:cursor-default disabled:opacity-40 disabled:data-[state=checked]:opacity-100',
        className,
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          'flex size-4 translate-x-[3px] items-center justify-center rounded-full bg-switch-knob-off',
          'transition-[translate,background-color] duration-[180ms] ease-out-soft',
          'data-[state=checked]:translate-x-[19px] data-[state=checked]:bg-on-primary',
        )}
      >
        {checked && disabled && (
          <Lock size={9} strokeWidth={2.6} aria-hidden className="text-primary" />
        )}
      </RadixSwitch.Thumb>
    </RadixSwitch.Root>
  );
}
