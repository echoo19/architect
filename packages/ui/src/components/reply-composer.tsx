import { useId, type FormEvent, type ReactNode, type Ref } from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '../lib/cn';
import { IconButton } from './icon-button';

export interface ReplyComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (text: string) => void;
  /** Accessible name of the field, e.g. "Reply". */
  label: string;
  placeholder?: string;
  /** Controls left of the field, such as an attach button. */
  leading?: ReactNode;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
}

/** A one-line reply box under a short conversation, like the mentor's clarifying questions. */
export function ReplyComposer({
  value,
  onValueChange,
  onSubmit,
  label,
  placeholder,
  leading,
  disabled = false,
  inputRef,
  className,
}: ReplyComposerProps) {
  const id = useId();
  const canSend = value.trim().length > 0 && !disabled;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSend) onSubmit(value.trim());
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        'flex w-full max-w-[720px] items-center gap-2 rounded-3xl border border-line-control bg-field p-2',
        'transition-colors duration-150 focus-within:border-fg-faint',
        className,
      )}
    >
      {leading}
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        ref={inputRef}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        className={cn(
          'h-10 min-w-0 flex-1 border-0 bg-transparent text-md text-fg focus-visible:outline-none',
          !leading && 'pl-2.5',
          'disabled:opacity-60',
        )}
      />
      <IconButton
        type="submit"
        label="Send"
        variant={canSend ? 'primary' : 'muted'}
        shape="round"
        aria-disabled={!canSend}
      >
        <ArrowUp size={18} strokeWidth={2} aria-hidden />
      </IconButton>
    </form>
  );
}
