import type { ComponentProps } from 'react';
import { motion } from 'motion/react';
import { Slot } from 'radix-ui';
import { cn } from '../lib/cn';
import { PRESS_SCALE, springs } from '../motion/springs';
import { Spinner } from './spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'lg' | 'md' | 'sm' | 'xs';

const base =
  'inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap ' +
  'rounded-control font-medium transition-[background-color,box-shadow,color,opacity] duration-150 ' +
  'disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary/90',
  secondary: 'text-fg shadow-edge-strong hover:bg-hover',
  ghost: 'text-fg hover:bg-hover',
  danger: 'text-danger inset-ring-1 inset-ring-danger/40 hover:bg-danger-soft',
};

const sizes: Record<ButtonSize, string> = {
  lg: 'h-11 px-5 text-ui',
  md: 'h-10 px-4 text-ui',
  sm: 'h-9 px-3.5 text-small',
  xs: 'h-8 px-3 text-small',
};

/** The events React and Motion both name, with different arguments: Motion's own are not used. */
type Conflicting = 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart';

export interface ButtonProps extends Omit<ComponentProps<'button'>, Conflicting> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element (for example a link) with button styles. */
  asChild?: boolean;
  /** Shows a spinner in place of the leading icon and disables the button. */
  loading?: boolean;
}

const press = { whileTap: { scale: PRESS_SCALE }, transition: springs.snappy } as const;
const MotionSlot = motion.create(Slot.Root);

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
  const classes = cn(base, sizes[size], variants[variant], className);
  if (asChild) {
    return (
      <MotionSlot className={classes} {...press} {...props}>
        {children}
      </MotionSlot>
    );
  }
  return (
    <motion.button
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...press}
      {...props}
    >
      {loading && <Spinner size={14} />}
      {children}
    </motion.button>
  );
}
