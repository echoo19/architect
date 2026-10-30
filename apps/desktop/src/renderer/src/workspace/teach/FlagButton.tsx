import { IconButton, Tooltip } from '@architect/ui';
import { Flag } from 'lucide-react';

/** The flag beside Copy under a reply: opens Teach this for that reply. */
export function FlagButton({ onFlag }: { onFlag: () => void }) {
  return (
    <Tooltip content="Flag for teaching" side="bottom">
      <IconButton label="Flag for teaching" size="sm" className="text-fg" onClick={onFlag}>
        <Flag size={15} strokeWidth={1.7} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}
