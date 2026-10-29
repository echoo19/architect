import { Button } from '@architect/ui';
import { CircleAlert, Settings2 } from 'lucide-react';

/** What else the person can do when training where they chose won't get to teach. */
export type Alternative =
  /** The other place can train in the time allowed, and is one click away. */
  | { kind: 'switch'; label: string; onSwitch: () => void }
  /** The other place isn't set up, and what it needs is said. */
  | { kind: 'missing'; text: string; onSetUp?: (() => void) | undefined };

interface WontTeachProps {
  title: string;
  body: string;
  /** Opens the training time limit. */
  onRaiseLimit: () => void;
  alternative: Alternative | null;
}

/**
 * Said beside the choice, where it is made: training in the place chosen would run out of time
 * before the teacher changed anything. Start training waits until it is put right, and the two
 * ways of doing so are here: allow more time, or train in the other place.
 */
export function WontTeach({ title, body, onRaiseLimit, alternative }: WontTeachProps) {
  return (
    <div
      role="status"
      className="flex items-start gap-3.5 rounded-2xl border border-danger-line bg-danger-tint px-5 py-4"
    >
      <CircleAlert size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-3.5">
        <div className="flex flex-col gap-1">
          <span className="font-medium">{title}</span>
          <span className="max-w-[640px] text-fg-secondary text-pretty">{body}</span>
          {alternative?.kind === 'missing' && (
            <span className="max-w-[640px] text-fg-secondary text-pretty">{alternative.text}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onRaiseLimit}>
            Allow more time
          </Button>
          {alternative?.kind === 'switch' && (
            <Button size="sm" onClick={alternative.onSwitch}>
              {alternative.label}
            </Button>
          )}
          {alternative?.kind === 'missing' && alternative.onSetUp && (
            <Button size="sm" onClick={alternative.onSetUp}>
              <Settings2 size={14} aria-hidden />
              Set up online training
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
