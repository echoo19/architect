import type { ComponentProps } from 'react';
import { Slot } from 'radix-ui';
import { cn } from '../lib/cn';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'lg' | 'md' | 'sm' | 'xs';

const base =
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap ' +
  'transition-[background-color,border-color,color,opacity] duration-150 ' +
  'disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary font-medium text-on-primary hover:bg-primary-hover',
  secondary: 'border border-line-control text-fg hover:bg-hover',
  ghost: 'text-fg-secondary hover:bg-hover hover:text-fg',
  danger: 'border border-danger-line text-danger hover:bg-danger-tint',
};

const sizes: Record<ButtonSize, string> = {
  lg: 'h-11 rounded-lg px-[18px] text-base',
  md: 'h-10 rounded-md px-3.5 text-base',
  sm: 'h-9 rounded-md px-3 text-sm',
  xs: 'h-[34px] rounded-md px-3.5 text-sm',
};

/** Primary buttons sit a little wider than outlined ones, as in the design. */
const primaryPadding: Record<ButtonSize, string> = {
  lg: 'px-5',
  md: 'px-4',
  sm: 'px-3.5',
  xs: 'px-3.5',
};

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element (for example a link) with button styles. */
  asChild?: boolean;
  /** Shows a spinner in place of the leading icon and disables the button. */
  loading?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'lg',
  asChild = false,
  loading = false,
  disabled,
  className,
  children,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(
    base,
    sizes[size],
    variants[variant],
    variant === 'primary' && primaryPadding[size],
    className,
  );
  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner size={14} />}
      {children}
    </button>
  );
}
