import type { ComponentProps, ReactNode } from 'react';
import { cn } from '../lib/cn';

const field =
  'w-full rounded-control bg-field px-3.5 text-ui text-fg shadow-edge-strong ' +
  'transition-shadow duration-150 ' +
  'disabled:cursor-default disabled:opacity-40 ' +
  'aria-[invalid=true]:inset-ring-1 aria-[invalid=true]:inset-ring-danger';

export type InputProps = ComponentProps<'input'>;

export function Input({ className, type, ...props }: InputProps) {
  return <input type={type ?? 'text'} className={cn(field, 'h-10', className)} {...props} />;
}

export interface TextareaProps extends ComponentProps<'textarea'> {
  /**
   * `bare` drops the edge and background, for a textarea inside a composer; the composer
   * shows focus on its container instead.
   */
  variant?: 'field' | 'bare';
}

export interface FieldProps {
  label: string;
  /** The id of the control the label names. */
  htmlFor: string;
  /** A word after the label, such as "Optional". */
  hint?: string;
  /** The control, and anything that belongs under it. */
  children: ReactNode;
  className?: string;
}

/** A form control with its label above it, for a form laid out in a column. */
export function Field({ label, htmlFor, hint, children, className }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={htmlFor} className="flex items-baseline gap-2 text-ui font-medium">
        {label}
        {hint && <span className="text-small font-normal">{hint}</span>}
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
