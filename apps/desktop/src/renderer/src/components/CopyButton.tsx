import { useEffect, useState } from 'react';
import { cn, IconButton, Tooltip } from '@architect/ui';
import { Check, Copy } from 'lucide-react';
import { attempt } from '../lib/notify';

export interface CopyButtonProps {
  text: string;
  /** What is copied, for the button's name: "Copy" by default. */
  label?: string;
  className?: string;
}

/** Copies text to the clipboard and shows a check for a moment. */
export function CopyButton({ text, label = 'Copy', className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    const done = await attempt("Couldn't copy that", async () => {
      await navigator.clipboard.writeText(text);
      return true;
    });
    if (done) setCopied(true);
  };

  const name = copied ? 'Copied' : label;
  return (
    <Tooltip content={name} side="bottom">
      <IconButton
        label={name}
        size="sm"
        className={cn('text-fg', className)}
        onClick={() => void copy()}
      >
        {copied ? (
          <Check size={15} strokeWidth={2} aria-hidden />
        ) : (
          <Copy size={15} strokeWidth={1.7} aria-hidden />
        )}
      </IconButton>
    </Tooltip>
  );
}
