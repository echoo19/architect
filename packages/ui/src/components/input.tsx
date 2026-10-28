import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

const field =
  'w-full rounded-md border border-line-control bg-well px-3 text-base text-fg ' +
  'transition-colors duration-150 hover:border-line-strong ' +
  'disabled:cursor-default disabled:opacity-40 aria-[invalid=true]:border-danger';

export type InputProps = ComponentProps<'input'>;

export function Input({ className, type, ...props }: InputProps) {
  return <input type={type ?? 'text'} className={cn(field, 'h-[38px]', className)} {...props} />;
}

export interface TextareaProps extends ComponentProps<'textarea'> {
  /**
   * `bare` drops the border and background, for a textarea inside a composer; the composer
   * shows focus on its container instead.
   */
  variant?: 'field' | 'bare';
}

export interface FieldProps {
  label: string;
  /** The id of the control the label names. */
  htmlFor: string;
  /** A word after the label in a quieter tone, such as "Optional". */
  hint?: string;
  /** The control, and anything that belongs under it. */
  children: ReactNode;
  className?: string;
}

/** A form control with its label above it, for a form laid out in a column. */
export function Field({ label, htmlFor, hint, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-2 text-fg">
        {label}
        {hint && <span className="text-sm text-fg-muted">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

export function Textarea({ variant = 'field', className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        variant === 'field'
          ? cn(field, 'min-h-24 resize-y py-2.5 leading-normal')
          : 'w-full resize-none border-0 bg-transparent p-0 text-fg focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  );
}
