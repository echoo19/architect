import { useState, type ReactNode } from 'react';
import { Button, Dialog, DialogClose, DialogContent, DialogFooter } from '@architect/ui';

export interface ConfirmLine {
  icon: ReactNode;
  text: ReactNode;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What happens, a short line each, with an icon. */
  lines: readonly ConfirmLine[];
  confirm: string;
  tone?: 'primary' | 'danger';
  /** Runs the action; the dialog closes once it resolves true. */
  onConfirm: () => Promise<boolean>;
}

/** A question before something that can't be taken back: what it does, then the one button. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  lines,
  confirm,
  tone = 'primary',
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const done = await onConfirm();
    setBusy(false);
    if (done) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}>
        <ul className="m-0 flex list-none flex-col gap-3 px-6 pt-4">
          {lines.map((line, index) => (
            <li key={index} className="flex items-start gap-3 text-ui text-pretty">
              <span className="mt-0.5 flex shrink-0 [&_svg]:size-[15px]">{line.icon}</span>
              <span>{line.text}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="md">Cancel</Button>
          </DialogClose>
          <Button variant={tone} size="md" loading={busy} onClick={() => void run()}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
