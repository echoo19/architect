import { IconButton, Tooltip } from '@architect/ui';
import { Flag } from 'lucide-react';

/**
 * The flag beside Copy under a reply, or under a teammate's answer in a team reply: opens Teach
 * this for that answer.
 */
export function FlagButton({
  onFlag,
  label = 'Flag for teaching',
}: {
  onFlag: () => void;
  label?: string;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <IconButton label={label} size="sm" className="text-fg" onClick={onFlag}>
        <Flag size={15} strokeWidth={1.7} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}
