import { useState } from 'react';
import { Button, Dialog, DialogClose, DialogContent, DialogFooter } from '@architect/ui';
import { architect } from '../../api/client';
import { attempt } from '../../lib/notify';

/** What stopping does at this point of an improvement, from what is known of it. */
function stopOutcome(writing: boolean, kept: boolean | null): string {
  if (writing) {
    return "Its new version isn't written yet, so none is made, and its lessons go back to the queue.";
  }
  if (kept === true) {
    return 'It stops after the step in progress, and the changes it kept become a new version for you to review.';
  }
  if (kept === false) {
    return "It stops after the step in progress. It hasn't found a change that helps yet, so it makes no version, and its lessons stay in the queue.";
  }
  return 'It stops after the step in progress. A change it already kept becomes a new version for you to review.';
}

/**
 * Asks before an improvement stops, and says what comes of it. A stop always ends it, even
 * while it writes its version.
 */
export function StopImprovementDialog({
  open,
  runId,
  writing,
  kept,
  onClose,
}: {
  open: boolean;
  runId: string;
  /** It has finished its rounds and is writing its version. */
  writing: boolean;
  /** Whether it kept a change, when that is known. */
  kept: boolean | null;
  onClose: () => void;
}) {
  const [stopping, setStopping] = useState(false);
  const stop = async () => {
    setStopping(true);
    await attempt("Couldn't stop improving", () => architect().runs.stop(runId));
    setStopping(false);
    onClose();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent title="Stop improving?" description={stopOutcome(writing, kept)}>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="md">Keep improving</Button>
          </DialogClose>
          <Button size="md" variant="danger" loading={stopping} onClick={() => void stop()}>
            Stop improving
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
