import { useId, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { cn } from '../lib/cn';
import { IconButton } from './icon-button';
import { Textarea } from './input';

export interface ComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: (text: string) => void;
  /** Accessible name of the text field, e.g. "Describe the job". */
  label: string;
  placeholder?: string;
  /** `hero` is the large Describe box; `chat` sits under a conversation. */
  size?: 'hero' | 'chat';
  /** Controls on the left of the bottom row, such as an attach button. */
  leading?: ReactNode;
  /** Text or controls just left of the send button, such as the agent's version. */
  trailing?: ReactNode;
  /** While a reply is running the send button becomes a stop button. */
  busy?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

const shells = {
  hero: 'max-w-[680px] gap-2 pb-3.5 pl-[22px] pr-3.5 pt-[18px]',
  chat: 'max-w-[720px] gap-1 pb-2.5 pl-[18px] pr-2.5 pt-4',
} as const;

const fields = {
  hero: 'min-h-[74px] max-h-[240px] pr-2 text-body',
  chat: 'min-h-7 max-h-[200px] pr-2 text-body',
} as const;

export function Composer({
  value,
  onValueChange,
  onSubmit,
  label,
  placeholder,
  size = 'chat',
  leading,
  trailing,
  busy = false,
  onStop,
  disabled = false,
  autoFocus,
  className,
}: ComposerProps) {
  const id = useId();
  const canSend = value.trim().length > 0 && !disabled;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSend && !busy) onSubmit(value.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  const buttonSize = size === 'hero' ? 'lg' : 'md';
  return (
    <form
      onSubmit={submit}
      className={cn(
        'flex w-full flex-col rounded-card bg-raised shadow-edge-strong transition-shadow duration-150',
        'focus-within:inset-ring-1 focus-within:inset-ring-ring',
        shells[size],
        className,
      )}
    >
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Textarea
        id={id}
        variant="bare"
        rows={size === 'hero' ? 3 : 1}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        className={cn('field-sizing-content', fields[size])}
      />
      <div className="flex items-center justify-between gap-2">
        <div className={cn('flex items-center gap-0.5', size === 'hero' ? '-ml-2.5' : '-ml-2')}>
          {leading}
        </div>
        <div className="flex items-center gap-2.5">
          {trailing}
          {busy ? (
            <IconButton
              label="Stop"
              variant="primary"
              shape="round"
              size={buttonSize}
              onClick={onStop}
            >
              <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden />
            </IconButton>
          ) : (
            <IconButton
              type="submit"
              label="Send"
              variant={canSend ? 'primary' : 'muted'}
              shape="round"
              size={buttonSize}
              aria-disabled={!canSend}
            >
              <ArrowUp size={size === 'hero' ? 18 : 16} strokeWidth={2} aria-hidden />
            </IconButton>
          )}
        </div>
      </div>
    </form>
  );
}
