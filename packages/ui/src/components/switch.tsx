import { motion } from 'motion/react';
import { Lock } from 'lucide-react';
import { Switch as RadixSwitch } from 'radix-ui';
import { cn } from '../lib/cn';
import { springs } from '../motion/springs';

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

/** How far the knob travels: the track's width less the knob and the gap on both sides. */
const KNOB_TRAVEL = 18;

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
        'relative inline-flex h-6 w-[42px] shrink-0 items-center rounded-full bg-line-strong',
        'transition-colors duration-150 data-[state=checked]:bg-primary',
        'disabled:cursor-default disabled:opacity-40 disabled:data-[state=checked]:opacity-100',
        className,
      )}
    >
      <RadixSwitch.Thumb asChild>
        <motion.span
          initial={false}
          animate={{ x: checked ? KNOB_TRAVEL : 0 }}
          transition={springs.snappy}
          className={cn(
            'ml-[3px] flex size-[18px] items-center justify-center rounded-full bg-fg',
            'transition-colors duration-150 data-[state=checked]:bg-on-primary',
          )}
        >
          {checked && disabled && (
            <Lock size={10} strokeWidth={2.6} aria-hidden className="text-primary" />
          )}
        </motion.span>
      </RadixSwitch.Thumb>
    </RadixSwitch.Root>
  );
}
