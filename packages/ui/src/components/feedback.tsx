import type { ReactNode } from 'react';
import { CircleAlert, RotateCw } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './button';

export interface SkeletonProps {
  className?: string;
  /** Pill and circle shapes; the default is a softly rounded block. */
  shape?: 'block' | 'pill' | 'circle';
}

/** A placeholder for content that is loading. Size it with `className`. */
export function Skeleton({ className, shape = 'block' }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn(
        'block animate-skeleton bg-hover',
        shape === 'block' && 'rounded-sm',
        shape !== 'block' && 'rounded-full',
        className,
      )}
    />
  );
}

export interface EmptyStateProps {
  /** A 20px Lucide icon, or a mark such as an AgentAvatar. */
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  /** Buttons under the description. */
  actions?: ReactNode;
  /** Wraps the icon in the standard tile. Turn off for marks that bring their own. */
  iconTile?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  actions,
  iconTile = true,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex animate-rise flex-col items-center justify-center gap-5 px-6 text-center',
        className,
      )}
    >
      {iconTile ? (
        <span className="flex size-12 items-center justify-center rounded-xl bg-selected text-fg-secondary [&_svg]:size-5">
          {icon}
        </span>
      ) : (
        icon
      )}
      <div className="flex max-w-[440px] flex-col gap-2">
        <h2 className="m-0 text-2xl font-medium tracking-tight text-balance">{title}</h2>
        {description && <p className="m-0 text-md text-fg-secondary text-pretty">{description}</p>}
      </div>
      {actions && <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title: string;
  /** The error's own message, written for the person using the app. */
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Another way out, such as going back. */
  secondaryAction?: ReactNode;
  /** `inline` fits inside a row or a sidebar section. */
  layout?: 'block' | 'inline';
  className?: string;
}

export function ErrorState({
  title,
  message,
  onRetry,
  retryLabel = 'Try again',
  secondaryAction,
  layout = 'block',
  className,
}: ErrorStateProps) {
  if (layout === 'inline') {
    return (
      <div role="alert" className={cn('flex items-start gap-2.5 text-sm', className)}>
        <CircleAlert size={14} className="mt-[3px] shrink-0 text-danger" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-fg-soft">{title}</span>
          {message && <span className="text-fg-muted text-pretty">{message}</span>}
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 self-start rounded-xs text-fg-secondary transition-colors duration-150 hover:text-fg"
            >
              <RotateCw size={12} aria-hidden />
              {retryLabel}
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className={cn(
        'flex animate-rise flex-col items-center justify-center gap-5 px-6 text-center',
        className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-xl bg-danger-tint text-danger">
        <CircleAlert size={20} aria-hidden />
      </span>
      <div className="flex max-w-[460px] flex-col gap-2">
        <h2 className="m-0 text-2xl font-medium tracking-tight text-balance">{title}</h2>
        {message && <p className="m-0 text-md text-fg-secondary text-pretty">{message}</p>}
      </div>
      {(onRetry || secondaryAction) && (
        <div className="mt-1 flex flex-wrap justify-center gap-2">
          {onRetry && (
            <Button variant="secondary" size="md" onClick={onRetry}>
              <RotateCw size={14} aria-hidden />
              {retryLabel}
            </Button>
          )}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
