import type { ComponentProps } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/cn';
import { PRESS_SCALE, springs } from '../motion/springs';

export type IconButtonVariant = 'ghost' | 'secondary' | 'primary' | 'muted';
export type IconButtonSize = 'lg' | 'md' | 'sm' | 'xs';

const variants: Record<IconButtonVariant, string> = {
  ghost: 'text-fg hover:bg-hover',
  secondary: 'text-fg shadow-edge-strong hover:bg-hover',
  primary: 'bg-primary text-on-primary hover:bg-primary/90',
  /** A send button with nothing to send yet. */
  muted: 'bg-selected text-fg-dim',
};

const sizes: Record<IconButtonSize, string> = {
  lg: 'size-10',
  md: 'size-9',
  sm: 'size-8',
  xs: 'size-7',
};

const squareRadius: Record<IconButtonSize, string> = {
  lg: 'rounded-control',
  md: 'rounded-control',
  sm: 'rounded-mark',
  xs: 'rounded-mark',
};

/** The events React and Motion both name, with different arguments: Motion's own are not used. */
type Conflicting = 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart';

export interface IconButtonProps extends Omit<
  ComponentProps<'button'>,
  'aria-label' | Conflicting
> {
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
    <motion.button
      type={type ?? 'button'}
      aria-label={label}
      whileTap={{ scale: PRESS_SCALE }}
      transition={springs.snappy}
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
    </motion.button>
  );
}
