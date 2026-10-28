import type { ReactNode } from 'react';
import { File, X } from 'lucide-react';
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

/** An attached file, as under a message or in a composer. */
export function FileChip({ name, icon, kind, onRemove, className }: FileChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-line-control bg-card',
        'pl-3 text-sm text-fg-secondary',
        onRemove ? 'pr-1' : 'pr-3',
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
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-fg-muted transition-colors duration-150 hover:bg-hover hover:text-fg"
        >
          <X size={13} strokeWidth={1.8} aria-hidden />
        </button>
      )}
    </span>
  );
}
