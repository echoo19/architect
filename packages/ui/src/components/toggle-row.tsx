import { useId, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Switch } from './switch';

export interface ToggleRowProps {
  label: string;
  /** What the setting holds or is measured in, at the row's right: "Text", "USD", "Rounds". */
  type?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Held where it is. A switch that is on shows a padlock, so it still reads as on. */
  disabled?: boolean;
  className?: string;
}

/**
 * One switch in a list of them, as in an inspector: the switch and its label at the left, the
 * kind of thing it governs at the right. Clicking the label flips the switch too.
 */
export function ToggleRow({
  label,
  type,
  checked,
  onCheckedChange,
  disabled,
  className,
}: ToggleRowProps) {
  const id = useId();
  return (
    <div className={cn('flex min-h-10 items-center gap-3 text-ui', className)}>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <label
        htmlFor={id}
        className={cn('min-w-0 flex-1 truncate font-medium', !disabled && 'cursor-pointer')}
      >
        {label}
      </label>
      {type !== undefined && <span className="shrink-0 text-small tabular-nums">{type}</span>}
    </div>
  );
}
