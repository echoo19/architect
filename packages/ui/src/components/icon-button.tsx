import type { ComponentProps } from 'react';
import { cn } from '../lib/cn';

export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'muted';
export type IconButtonSize = 'lg' | 'md' | 'sm' | 'xs';

const variants: Record<IconButtonVariant, string> = {
  ghost: 'text-fg-secondary hover:bg-hover hover:text-fg',
  secondary: 'border border-line-control text-fg hover:bg-hover',
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  /** A send button with nothing to send yet. */
  muted: 'bg-line-control text-fg-muted',
};

const sizes: Record<IconButtonSize, string> = {
  lg: 'size-10',
  md: 'size-9',
  sm: 'size-8',
  xs: 'size-[30px]',
};

const squareRadius: Record<IconButtonSize, string> = {
  lg: 'rounded-md',
  md: 'rounded-md',
  sm: 'rounded-sm',
  xs: 'rounded-sm',
};

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'aria-label'> {
  /** Accessible name. Icon-only buttons always need one. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  shape?: 'square' | 'round';
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'lg',
  shape = 'square',
  className,
  type,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center transition-colors duration-150',
        'disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
        sizes[size],
        shape === 'round' ? 'rounded-full' : squareRadius[size],
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
