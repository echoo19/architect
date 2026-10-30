import type { ReactNode } from 'react';
import { Check, File, X } from 'lucide-react';
import { cn } from '../lib/cn';

export interface FileChipProps {
  /** The file's name, without its folder. */
  name: string;
  /** A 14px icon in place of the plain file mark, for a file with a role of its own. */
  icon?: ReactNode;
  /** What the file is, read out after its name when the icon marks it: "example tasks". */
  kind?: string | undefined;
  /** Shows a remove button when set. */
  onRemove?: () => void;
  className?: string;
}

export interface ToggleChipProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  /** A 14px icon before the text. */
  icon?: ReactNode;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * A chip that is on or off, such as one file in a set to choose from. When on, a check takes
 * the icon's place.
 */
export function ToggleChip({
  pressed,
  onPressedChange,
  icon,
  children,
  disabled,
  className,
}: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex h-8 max-w-full items-center gap-2 rounded-full px-3.5 text-small shadow-edge-strong',
        'transition-colors duration-150 disabled:opacity-40 [&_svg]:shrink-0',
        pressed ? 'bg-selected font-medium' : 'hover:bg-hover',
        className,
      )}
    >
      {pressed ? (
        <Check size={14} strokeWidth={2.2} aria-hidden />
      ) : (
        icon && <span aria-hidden>{icon}</span>
      )}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** An attached file, as under a message or in a composer. */
export function FileChip({ name, icon, kind, onRemove, className }: FileChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-hover pl-3.5 text-small',
        onRemove ? 'pr-1' : 'pr-3.5',
        className,
      )}
    >
      <span className="flex shrink-0" aria-hidden>
        {icon ?? <File size={14} strokeWidth={1.6} />}
      </span>
      <span className="min-w-0 truncate">
        {name}
        {kind && <span className="sr-only">, {kind}</span>}
      </span>
      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          onClick={onRemove}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-150 hover:bg-selected"
        >
          <X size={13} strokeWidth={1.8} aria-hidden />
        </button>
      )}
    </span>
  );
}
