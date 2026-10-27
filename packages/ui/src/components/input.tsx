import type { ComponentProps } from 'react';
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
