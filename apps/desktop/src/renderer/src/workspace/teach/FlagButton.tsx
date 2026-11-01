import { IconButton, Tooltip } from '@architect/ui';
import { Flag } from 'lucide-react';
import { useTeachingOverview } from '../../api/teaching';

/**
 * The flag beside Copy under a reply, or under a teammate's answer in a team reply: opens Teach
 * this for that answer. For an agent that can't be taught here, it is held, and its tooltip says
 * why.
 */
export function FlagButton({
  graduateId,
  onFlag,
  label = 'Flag for teaching',
}: {
  /** The agent the flag would teach. */
  graduateId: string;
  onFlag: () => void;
  label?: string;
}) {
  const unavailable = useTeachingOverview(graduateId).data?.unavailable;
  const button = (
    <IconButton
      label={label}
      size="sm"
      className="text-fg"
      disabled={unavailable !== undefined}
      onClick={onFlag}
    >
      <Flag size={15} strokeWidth={1.7} aria-hidden />
    </IconButton>
  );
  if (!unavailable) {
    return (
      <Tooltip content={label} side="bottom">
        {button}
      </Tooltip>
    );
  }
  // A disabled control takes no pointer, so why it is held hangs on the span around it.
  return (
    <Tooltip content={unavailable.message} side="bottom">
      <span tabIndex={0} className="inline-flex rounded-control">
        {button}
      </span>
    </Tooltip>
  );
}
