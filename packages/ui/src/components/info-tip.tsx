import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { IconButton } from './icon-button';
import { Tooltip } from './tooltip';

export interface InfoTipProps {
  /** What the tip explains, for its accessible name: "About {about}". */
  about: string;
  /** The explanation: one sentence at most. Longer belongs in a closed Disclosure. */
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

/** An info icon beside a word, with the one sentence that explains it in a tooltip. */
export function InfoTip({ about, children, side = 'top', className }: InfoTipProps) {
  return (
    <Tooltip content={<span className="block max-w-72 text-pretty">{children}</span>} side={side}>
      <IconButton label={`About ${about}`} size="xs" className={className}>
        <Info size={16} strokeWidth={1.8} aria-hidden />
      </IconButton>
    </Tooltip>
  );
}
